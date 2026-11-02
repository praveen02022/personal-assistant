import { createHash } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { GatewayClient, GatewayClientRequestTimeoutError, isGatewayProtocolResponseError } from "@openclaw/gateway-client";
import { GATEWAY_CLIENT_CAPS, GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "@openclaw/gateway-protocol/client-info";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import type { GatewayState } from "@personalos/contracts";
import { BehaviorSubject, Subject } from "rxjs";
import { ENV, type Env } from "../config/env.js";
import { FileDeviceStore, publicKeyRawBase64Url, signPayload } from "./device-store.js";
import { normalizeGatewayEvent } from "./event-normalizer.js";
import {
  AgentGateway,
  GatewayAckUnknownError,
  GatewayNotSentError,
  GatewayRpcError,
  type HistoryMessage,
  messageText,
  type RunEvent,
  type RunWaitResult,
  type SessionHistory,
} from "./gateway.port.js";

export { GatewayRpcError };

const ROLE = "operator";
/** Least privilege: read + write. No admin, no approvals (until Phase 4), no pairing. */
const SCOPES = ["operator.read", "operator.write"];
const PAIRING_RETRY_MS = 10_000;
const PAUSED_RETRY_MS = 60_000;

@Injectable()
export class OpenClawGatewayService extends AgentGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("OpenClawGateway");
  private client: GatewayClient | null = null;
  private readonly ensuredSessions = new Set<string>();
  private lastPairingRequestId: string | null = null;
  private retryTimer: NodeJS.Timeout | undefined;
  private stopping = false;

  readonly state$ = new BehaviorSubject<GatewayState>("connecting");
  readonly ready$ = new Subject<void>();
  readonly events$ = new Subject<RunEvent>();

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
  }

  currentState(): GatewayState {
    return this.state$.value;
  }

  onModuleInit() {
    this.connect();
  }

  /** Builds a fresh client. Re-run after a paused reconnect (e.g. pairing approved later). */
  private connect() {
    if (this.stopping) return;
    const store = new FileDeviceStore(this.env.OPENCLAW_DEVICE_DIR);
    const identity = store.loadOrCreateIdentity();
    const hasDeviceToken = store.loadToken(identity.deviceId, ROLE) !== null;
    // After pairing, connect with the device token alone. The shared Gateway token is
    // only a bootstrap credential and does not need to be present at runtime afterwards.
    const sharedToken = hasDeviceToken ? undefined : this.env.gatewayToken;
    if (!hasDeviceToken && !sharedToken) {
      this.logger.error("No device token and no OPENCLAW_GATEWAY_TOKEN: cannot bootstrap pairing.");
      this.state$.next("down");
      return;
    }
    this.logger.log(`device ${identity.deviceId.slice(0, 12)}… connecting to ${this.env.OPENCLAW_GATEWAY_URL} (${hasDeviceToken ? "device token" : "bootstrap token"})`);

    this.client = new GatewayClient({
      url: this.env.OPENCLAW_GATEWAY_URL,
      ...(sharedToken ? { token: sharedToken } : {}),
      clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientDisplayName: "PersonalOS API",
      clientVersion: "0.1.0",
      mode: GATEWAY_CLIENT_MODES.BACKEND,
      platform: "node",
      deviceFamily: "server",
      role: ROLE,
      scopes: SCOPES,
      caps: [GATEWAY_CLIENT_CAPS.TOOL_EVENTS], // without this, tool events are silently not delivered
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      deviceIdentity: identity,
      hostDeps: {
        signDevicePayload: signPayload,
        publicKeyRawBase64UrlFromPem: publicKeyRawBase64Url,
        loadDeviceAuthToken: ({ deviceId, role }) => store.loadToken(deviceId, role),
        storeDeviceAuthToken: ({ deviceId, role, token, scopes, expectedToken }) => {
          store.storeToken(deviceId, role, { token, scopes }, expectedToken);
          this.logger.log(`device token stored (scopes: ${scopes.join(", ")})`);
        },
        clearDeviceAuthToken: ({ deviceId, role, expectedToken }) => store.clearToken(deviceId, role, expectedToken),
        logError: (m) => this.logger.error(m),
      },
      onHelloOk: (hello) => {
        this.logger.log(`connected: protocol ${hello.protocol}, gateway ${hello.server.version}`);
        this.lastPairingRequestId = null;
        this.state$.next("connected");
        this.ready$.next();
      },
      onConnectError: (err) => this.onConnectError(err),
      onClose: (code) => {
        if (this.state$.value === "connected") {
          this.logger.warn(`connection closed (${code}); reconnecting`);
          this.state$.next("reconnecting");
        }
      },
      onReconnectPaused: (info) => {
        // The client stops retrying on non-transient auth outcomes. Pairing is awaiting a human,
        // so poll with a fresh client; anything else needs operator attention.
        if (info.detailCode === "PAIRING_REQUIRED") {
          this.state$.next("pairing_required");
          this.scheduleReconnect(PAIRING_RETRY_MS);
        } else {
          this.logger.error(`reconnect paused: ${info.reason} (${info.detailCode ?? "no code"}); retrying in ${PAUSED_RETRY_MS / 1000}s`);
          this.state$.next("down");
          this.scheduleReconnect(PAUSED_RETRY_MS);
        }
      },
      onGap: (gap) => this.logger.warn(`event sequence gap (expected ${gap.expected}, got ${gap.received}); history will be reloaded`),
      onEvent: (frame) => {
        const ev = normalizeGatewayEvent(frame);
        if (ev) this.events$.next(ev);
      },
    });
    this.client.start();
  }

  private onConnectError(err: Error) {
    const details = (err as { details?: { code?: string; requestId?: string } }).details;
    if (details?.code === "PAIRING_REQUIRED") {
      this.state$.next("pairing_required");
      if (details.requestId !== this.lastPairingRequestId) {
        this.lastPairingRequestId = details.requestId ?? null;
        this.logger.warn(
          `Gateway pairing required. Review and approve on the Gateway host: ` +
            `infra/openclaw/oc.sh devices list && infra/openclaw/oc.sh devices approve ${details.requestId}`,
        );
      }
      return;
    }
    this.logger.warn(`connect failed: ${err.message}`);
    if (this.state$.value === "connected" || this.state$.value === "connecting") this.state$.next("reconnecting");
  }

  private scheduleReconnect(delayMs: number) {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      const old = this.client;
      this.client = null;
      void old?.stopAndWait({ timeoutMs: 1000 }).catch(() => undefined).finally(() => this.connect());
    }, delayMs);
    this.retryTimer.unref();
  }

  async onModuleDestroy() {
    this.stopping = true;
    clearTimeout(this.retryTimer);
    await this.client?.stopAndWait({ timeoutMs: 2000 }).catch(() => undefined);
    this.state$.complete();
    this.ready$.complete();
    this.events$.complete();
  }

  // ---------- RPC wrappers ----------

  private async request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    if (!this.client || this.state$.value !== "connected") throw new GatewayNotSentError(`state ${this.state$.value}`);
    try {
      return await this.client.request<T>(method, params, timeoutMs ? { timeoutMs } : undefined);
    } catch (err) {
      if (isGatewayProtocolResponseError(err)) {
        const e = err as Error & { gatewayCode?: string; code?: string };
        throw new GatewayRpcError(method, e.gatewayCode ?? e.code ?? null, e.message);
      }
      // The client tells us whether the frame was written before its local deadline expired.
      if (err instanceof GatewayClientRequestTimeoutError && !err.requestSent) throw new GatewayNotSentError(`${method} timed out before sending`);
      throw new GatewayAckUnknownError(method); // sent (or unknown), reply lost: outcome unknown
    }
  }

  /**
   * OpenClaw requires session labels to be unique ("label already in use"), and titles repeat
   * ("Good morning…"), so the label is derived from the session key, which is unique by construction.
   * The human-readable title stays in our database.
   */
  async ensureSession(sessionKey: string, _title: string): Promise<void> {
    if (this.ensuredSessions.has(sessionKey)) return;
    const label = `personalos ${sessionKey.split(":").at(-1)}`;
    const agentId = this.env.OPENCLAW_AGENT_ID;
    const found = await this.request<{ session: unknown }>("sessions.describe", { key: sessionKey, agentId });
    if (!found.session) {
      await this.request("sessions.create", {
        key: sessionKey,
        agentId,
        label,
        permissionMode: "read-only", // per-session layer on top of the Gateway tool policy
        // Deterministic: a retried create after a lost response is deduplicated by the Gateway.
        idempotencyKey: createHash("sha256").update(`create:${sessionKey}`).digest("hex").slice(0, 32),
      });
    }
    this.ensuredSessions.add(sessionKey);
  }

  sendMessage(p: { sessionKey: string; message: string; idempotencyKey: string }) {
    return this.request<{ runId: string; status: string }>("chat.send", { ...p, agentId: this.env.OPENCLAW_AGENT_ID });
  }

  abort(p: { sessionKey: string; runId?: string }) {
    return this.request<{ aborted: boolean; runIds: string[] }>("chat.abort", { ...p, agentId: this.env.OPENCLAW_AGENT_ID });
  }

  async history(sessionKey: string, limit: number): Promise<SessionHistory> {
    type Raw = {
      messages?: Array<Record<string, unknown>>;
      inFlightRun?: { runId?: string } | null;
      sessionInfo?: { hasActiveRun?: boolean; activeRunIds?: string[] };
    };
    let raw: Raw;
    try {
      raw = await this.request<Raw>("chat.history", { sessionKey, agentId: this.env.OPENCLAW_AGENT_ID, limit });
    } catch (err) {
      if (err instanceof GatewayRpcError && /unknown session/i.test(err.message)) {
        return { exists: false, messages: [], inFlightRunId: null, hasActiveRun: false, activeRunIds: [] };
      }
      throw err;
    }
    return {
      exists: true,
      messages: (raw.messages ?? []).flatMap((m, i) => toHistoryMessage(m, i)),
      inFlightRunId: raw.inFlightRun?.runId ?? null,
      hasActiveRun: raw.sessionInfo?.hasActiveRun ?? false,
      activeRunIds: raw.sessionInfo?.activeRunIds ?? null,
    };
  }

  async waitForRun(runId: string, timeoutMs: number): Promise<RunWaitResult> {
    const r = await this.request<{ status?: string; stopReason?: string; error?: string }>("agent.wait", { runId, timeoutMs }, timeoutMs + 5000);
    const status = r.status === "ok" || r.status === "error" || r.status === "pending" ? r.status : "timeout";
    return { status, stopReason: r.stopReason ?? null, error: r.error ?? null };
  }
}

function toHistoryMessage(m: Record<string, unknown>, index: number): HistoryMessage[] {
  const role = m.role;
  if (role !== "user" && role !== "assistant") return []; // tool results, system rows, etc.
  const meta = (m.__openclaw ?? {}) as { id?: string; runId?: string };
  const provenance = (m.provenance ?? {}) as { kind?: string };
  const text = messageText(m);
  if (!text.trim()) return [];
  return [
    {
      id: `${meta.id ?? "row"}:${index}`, // one stored record can project to several rows
      role,
      text,
      timestamp: typeof m.timestamp === "number" ? m.timestamp : 0,
      runId: meta.runId ?? null,
      internal: role === "user" && provenance.kind !== undefined && provenance.kind !== "external_user",
    },
  ];
}
