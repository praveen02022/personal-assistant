/**
 * Step 0 integration spike: PersonalOS backend <-> OpenClaw Gateway 2026.10.9.
 *
 * Usage: node spike.ts <scenario> [...args]
 *   connect                        handshake + pairing; prints hello-ok summary
 *   introspect                     agents/models/tools catalog + effective tools for a session
 *   chat <conv> <message...>       create/resolve session, chat.send, stream until terminal
 *   abort <conv> <message...>      chat.send, then chat.abort after first assistant delta
 *   history <conv>                 chat.history for a session
 *   negative                       invalid/forbidden requests (error shapes)
 *
 * Every frame (req/res/event) is appended, redacted, to recordings/<scenario>.jsonl.
 * Secrets: gateway token from infra/openclaw/.env; device identity + device token
 * in <repo>/.secrets (0600). Nothing secret is written to recordings.
 */
import { GatewayClient } from "@openclaw/gateway-client";
import { execSync } from "node:child_process";
import { GATEWAY_CLIENT_CAPS, GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "@openclaw/gateway-protocol/client-info";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "../..");
const SECRETS = path.join(REPO, ".secrets");
const REC_DIR = path.join(import.meta.dirname, "recordings");
const GATEWAY_URL = process.env.GATEWAY_URL ?? "ws://127.0.0.1:18790";
const AGENT_ID = "personalos";

// ---------- secrets ----------
function readGatewayToken(): string {
  const env = fs.readFileSync(path.join(REPO, "infra/openclaw/.env"), "utf8");
  const m = env.match(/^OPENCLAW_GATEWAY_TOKEN=(.+)$/m);
  if (!m) throw new Error("OPENCLAW_GATEWAY_TOKEN missing");
  return m[1].trim();
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const b64url = (b: Buffer) => b.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");

type Identity = { deviceId: string; publicKeyPem: string; privateKeyPem: string };
function loadOrCreateIdentity(): Identity {
  const file = path.join(SECRETS, "spike-device-identity.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const deviceId = crypto.createHash("sha256").update(rawPublicKey(publicKeyPem)).digest("hex");
  const id = { deviceId, publicKeyPem, privateKeyPem };
  fs.mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(id), { mode: 0o600 });
  return id;
}
function rawPublicKey(pem: string): Buffer {
  const spki = crypto.createPublicKey(pem).export({ type: "spki", format: "der" });
  return spki.subarray(ED25519_SPKI_PREFIX.length);
}
const tokenFile = path.join(SECRETS, "spike-device-token.json");

// ---------- recording with redaction ----------
const SECRET_KEY = /token|secret|password|signature|publickey|privatekey|nonce|apikey|authorization|cookie|recovery/i;
function redact(v: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key) && v != null && typeof v !== "object") return "<redacted>";
  if (Array.isArray(v)) return v.map((x) => redact(x, key));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, redact(x, k)]));
  }
  if (typeof v === "string" && v.length > 600) return v.slice(0, 600) + `…<+${v.length - 600} chars>`;
  return v;
}
let recFile = "";
const t0 = Date.now();
function rec(kind: string, data: unknown) {
  fs.appendFileSync(recFile, JSON.stringify({ dt: Date.now() - t0, kind, data: redact(data) }) + "\n");
}

// ---------- client ----------
type Ev = { event: string; payload?: any; seq?: number };
function connect(onEvent: (e: Ev) => void): Promise<{ client: GatewayClient; hello: any }> {
  const identity = loadOrCreateIdentity();
  return new Promise((resolve, reject) => {
    const client = new GatewayClient({
      url: GATEWAY_URL,
      token: readGatewayToken(),
      clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientDisplayName: "PersonalOS API (spike)",
      clientVersion: "0.0.0-spike",
      mode: GATEWAY_CLIENT_MODES.BACKEND,
      platform: "node",
      deviceFamily: "server",
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      caps: [GATEWAY_CLIENT_CAPS.TOOL_EVENTS],
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      deviceIdentity: identity,
      hostDeps: {
        signDevicePayload: (pem, payload) => b64url(crypto.sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(pem))),
        publicKeyRawBase64UrlFromPem: (pem) => b64url(rawPublicKey(pem)),
        loadDeviceAuthToken: ({ deviceId, role }) => {
          if (!fs.existsSync(tokenFile)) return null;
          const all = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
          return all[`${deviceId}:${role}`] ?? null;
        },
        storeDeviceAuthToken: ({ deviceId, role, token, scopes }) => {
          const all = fs.existsSync(tokenFile) ? JSON.parse(fs.readFileSync(tokenFile, "utf8")) : {};
          all[`${deviceId}:${role}`] = { token, scopes };
          fs.writeFileSync(tokenFile, JSON.stringify(all), { mode: 0o600 });
          rec("host.deviceTokenStored", { deviceId, role, scopes });
        },
        clearDeviceAuthToken: ({ deviceId, role }) => {
          if (!fs.existsSync(tokenFile)) return;
          const all = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
          delete all[`${deviceId}:${role}`];
          fs.writeFileSync(tokenFile, JSON.stringify(all), { mode: 0o600 });
          rec("host.deviceTokenCleared", { deviceId, role });
        },
      },
      onEvent: (e) => {
        rec("event", e);
        onEvent(e as Ev);
      },
      onHelloOk: (hello) => {
        rec("hello-ok", hello);
        resolve({ client, hello });
      },
      onConnectError: (err: any) => {
        rec("connect-error", { message: err?.message, code: err?.code, details: err?.details ?? err?.gatewayCode });
        reject(err);
      },
      onReconnectPaused: (info) => rec("reconnect-paused", info),
      onClose: (code, reason) => rec("close", { code, reason }),
      onGap: (g) => rec("gap", g),
    });
    client.start();
  });
}

async function call<T = any>(client: GatewayClient, method: string, params: unknown, timeoutMs?: number): Promise<T> {
  rec("req", { method, params });
  try {
    const res = await client.request<T>(method, params, timeoutMs ? { timeoutMs } : undefined);
    rec("res", { method, ok: true, payload: res });
    return res;
  } catch (err: any) {
    const shape = { message: err?.message, code: err?.code ?? err?.gatewayCode, details: err?.details, name: err?.name };
    rec("res", { method, ok: false, error: shape });
    throw Object.assign(new Error(`${method} failed: ${err?.message}`), { shape });
  }
}

// Session key per PersonalOS conversation, generated server-side.
const sessionKeyFor = (conv: string) => `agent:${AGENT_ID}:personalos:${conv}`;

async function ensureSession(client: GatewayClient, conv: string) {
  const key = sessionKeyFor(conv);
  // Finding: sessions.describe returns { session: null } for unknown keys (no error).
  const existing = await call<any>(client, "sessions.describe", { key, agentId: AGENT_ID });
  if (existing?.session) return existing;
  return await call(client, "sessions.create", {
    key,
    agentId: AGENT_ID,
    label: `spike ${conv}`,
    permissionMode: "read-only",
    idempotencyKey: crypto.randomUUID(),
  });
}

// Follow one run until a terminal chat event; summarise the event stream.
function trackRun(abortAfterFirstDelta?: () => void) {
  const summary: Record<string, number> = {};
  let text = "";
  let runId: string | undefined;
  let aborted = false;
  const done = Promise.withResolvers<any>();
  const onEvent = (e: Ev) => {
    const p = e.payload ?? {};
    if (runId && p.runId && p.runId !== runId) return;
    const k = e.event === "agent" ? `agent:${p.stream}:${p.data?.phase ?? p.data?.type ?? "-"}` : e.event === "chat" ? `chat:${p.state}` : e.event;
    summary[k] = (summary[k] ?? 0) + 1;
    if (e.event === "agent" && p.stream === "tool") {
      console.log(`  [tool] ${p.data?.phase} ${p.data?.name ?? ""}`);
    }
    if (e.event === "chat" && p.state === "delta") {
      text = p.replace ? p.deltaText : text + p.deltaText;
      if (abortAfterFirstDelta && !aborted) {
        aborted = true;
        abortAfterFirstDelta();
      }
    }
    if (e.event === "chat" && ["final", "aborted", "error"].includes(p.state)) done.resolve({ state: p.state, payload: p });
  };
  return { onEvent, setRunId: (id: string) => (runId = id), done: done.promise, summary, text: () => text };
}

// ---------- scenarios ----------
async function main() {
  const [scenario = "connect", ...args] = process.argv.slice(2);
  fs.mkdirSync(REC_DIR, { recursive: true });
  recFile = path.join(REC_DIR, `${scenario}.jsonl`);
  fs.writeFileSync(recFile, "");

  let handler: (e: Ev) => void = () => {};
  const { client, hello } = await connect((e) => handler(e));
  console.log("hello-ok:", JSON.stringify({ protocol: hello.protocol, server: hello.server?.version, auth: { role: hello.auth?.role, scopes: hello.auth?.scopes, deviceTokenIssued: !!hello.auth?.deviceToken } }));

  try {
    if (scenario === "connect") {
      console.log("methods advertised:", hello.features?.methods?.length, "events:", hello.features?.events?.length);
    }

    if (scenario === "introspect") {
      const agents = await call(client, "agents.list", {});
      console.log("agents:", JSON.stringify(agents).slice(0, 400));
      const models = await call(client, "models.list", { view: "configured" });
      console.log("models (configured):", JSON.stringify(models).slice(0, 400));
      await ensureSession(client, "introspect");
      const eff = await call(client, "tools.effective", { sessionKey: sessionKeyFor("introspect"), agentId: AGENT_ID });
      console.log("effective tools:", JSON.stringify(eff, null, 1).slice(0, 3000));
      const cat = await call(client, "tools.catalog", { agentId: AGENT_ID });
      fs.writeFileSync(path.join(REC_DIR, "tools-catalog.json"), JSON.stringify(redact(cat), null, 1));
      console.log("catalog written: recordings/tools-catalog.json");
    }

    if (scenario === "chat" || scenario === "abort") {
      const [conv = "c1", ...words] = args;
      const message = words.join(" ") || "Say hello in one short sentence.";
      const sessionKey = sessionKeyFor(conv);
      await ensureSession(client, conv);
      const tr = trackRun(
        scenario === "abort"
          ? () => {
              console.log("  -> aborting after first delta");
              void call(client, "chat.abort", { sessionKey, agentId: AGENT_ID }).catch((e) => console.log("abort err", e.shape));
            }
          : undefined,
      );
      handler = tr.onEvent;
      const idem = crypto.randomUUID();
      const sent = await call<any>(client, "chat.send", { sessionKey, agentId: AGENT_ID, message, idempotencyKey: idem });
      console.log("chat.send ->", JSON.stringify(sent));
      if (sent?.runId) tr.setRunId(sent.runId);
      // Idempotency check: resend with the same key.
      const dup = await call<any>(client, "chat.send", { sessionKey, agentId: AGENT_ID, message, idempotencyKey: idem }).catch((e) => ({ error: e.shape }));
      console.log("duplicate chat.send (same idempotencyKey) ->", JSON.stringify(dup));
      const timeout = setTimeout(() => console.log("  ...still waiting (120s)"), 120_000);
      const terminal = await tr.done;
      clearTimeout(timeout);
      console.log("terminal:", terminal.state, terminal.payload.stopReason ?? "", terminal.payload.errorMessage ?? "");
      console.log("event summary:", JSON.stringify(tr.summary));
      console.log("assembled text:", JSON.stringify(tr.text().slice(0, 500)));
      if (sent?.runId) {
        const w = await call(client, "agent.wait", { runId: sent.runId, timeoutMs: 5_000 }).catch((e) => ({ error: e.shape }));
        console.log("agent.wait ->", JSON.stringify(w).slice(0, 400));
      }
    }

    if (scenario === "describe") {
      const [conv = "c1"] = args;
      const d = await call<any>(client, "sessions.describe", { key: sessionKeyFor(conv), agentId: AGENT_ID });
      const e = d?.session ?? {};
      console.log("session:", JSON.stringify({ key: e.key, sessionId: e.sessionId, agentRuntime: e.agentRuntime, runtime: e.runtime, harness: e.harness, permissionMode: e.permissionMode, modelProvider: e.modelProvider, model: e.model }));
      console.log("describe keys:", Object.keys(e).join(","));
    }

    if (scenario === "timeout") {
      // Run-level timeout: chat.send timeoutMs much shorter than the model needs.
      const sessionKey = sessionKeyFor("timeout1");
      await ensureSession(client, "timeout1");
      const tr = trackRun();
      handler = tr.onEvent;
      const sent = await call<any>(client, "chat.send", { sessionKey, agentId: AGENT_ID, message: "Write a 500-word story.", timeoutMs: 1500, idempotencyKey: crypto.randomUUID() });
      tr.setRunId(sent.runId);
      const t = await tr.done;
      console.log("terminal:", t.state, JSON.stringify({ stopReason: t.payload.stopReason, errorKind: t.payload.errorKind, errorMessage: t.payload.errorMessage }));
      const w = await call(client, "agent.wait", { runId: sent.runId, timeoutMs: 5000 });
      console.log("agent.wait ->", JSON.stringify(w).slice(0, 300));
    }

    if (scenario === "restart") {
      // Gateway restart mid-run: what does the client see, and what is the run's fate?
      const sessionKey = sessionKeyFor("restart1");
      await ensureSession(client, "restart1");
      let restarted = false;
      const reconnected = Promise.withResolvers<void>();
      handler = (e) => {
        const p = e.payload ?? {};
        if (e.event === "chat" && p.state === "delta" && !restarted) {
          restarted = true;
          console.log("  -> docker restart (mid-stream)");
          execSync("docker restart personalos-openclaw-gateway", { stdio: "ignore" });
        }
        if (e.event === "chat" && ["final", "aborted", "error"].includes(p.state)) console.log("  chat terminal after restart?", p.state, p.stopReason ?? "");
      };
      const origHello = (client as any).opts.onHelloOk;
      (client as any).opts.onHelloOk = (h: any) => { rec("hello-ok(reconnect)", { server: h.server }); console.log("  reconnected, bootId", h.server?.bootId); reconnected.resolve(); };
      const sent = await call<any>(client, "chat.send", { sessionKey, agentId: AGENT_ID, message: "Write a 600-word essay about monsoon season in Tamil Nadu.", idempotencyKey: crypto.randomUUID() });
      console.log("chat.send ->", JSON.stringify(sent));
      await reconnected.promise;
      void origHello;
      const w = await call<any>(client, "agent.wait", { runId: sent.runId, timeoutMs: 3000 }).catch((e) => ({ error: e.shape }));
      console.log("agent.wait after restart ->", JSON.stringify(w).slice(0, 400));
      const h = await call<any>(client, "chat.history", { sessionKey, agentId: AGENT_ID, limit: 10 });
      console.log("history after restart: messages=", h.messages?.length, "inFlightRun=", JSON.stringify(h.inFlightRun ?? null).slice(0, 200), "sessionInfo.hasActiveRun=", h.sessionInfo?.hasActiveRun, "activeRunIds=", JSON.stringify(h.sessionInfo?.activeRunIds));
      const last = h.messages?.at(-1);
      console.log("last message:", last?.role, JSON.stringify(last?.content).slice(0, 200), "stopReason=", last?.stopReason);
    }

    if (scenario === "history") {
      const [conv = "c1"] = args;
      const h = await call<any>(client, "chat.history", { sessionKey: sessionKeyFor(conv), agentId: AGENT_ID, limit: 20 });
      console.log("history:", JSON.stringify(redact(h), null, 1).slice(0, 4000));
    }

    if (scenario === "negative") {
      const tries: [string, unknown][] = [
        ["chat.send", { sessionKey: sessionKeyFor("neg"), agentId: AGENT_ID, message: "x" }], // missing idempotencyKey
        ["config.get", {}], // admin-only
        ["chat.send", { sessionKey: "agent:main:main", agentId: AGENT_ID, message: "x", idempotencyKey: crypto.randomUUID() }], // agent mismatch
        ["sessions.create", { key: sessionKeyFor("neg-full"), agentId: AGENT_ID, permissionMode: "full", idempotencyKey: crypto.randomUUID() }], // needs admin
        ["tools.invoke", { name: "exec", args: { command: "id" }, agentId: AGENT_ID }], // denied tool
        ["agent.wait", { runId: "does-not-exist", timeoutMs: 1000 }],
      ];
      for (const [m, p] of tries) {
        const r = await call(client, m, p).then((x) => ({ ok: true, x }), (e) => ({ ok: false, error: e.shape }));
        console.log(`${m}:`, JSON.stringify(r).slice(0, 500));
      }
    }
  } finally {
    await client.stopAndWait({ timeoutMs: 2000 }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("SPIKE FAILED:", err?.message, JSON.stringify(redact(err?.shape ?? err?.details ?? {})));
  process.exit(1);
});
