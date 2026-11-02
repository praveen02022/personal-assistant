import type { GatewayState } from "@personalos/contracts";
import { BehaviorSubject, Subject } from "rxjs";
import {
  AgentGateway,
  GatewayAckUnknownError,
  GatewayNotSentError,
  GatewayRpcError,
  type RunEvent,
  type RunWaitResult,
  type SessionHistory,
} from "../../src/gateway/gateway.port.js";

type Script = (ctx: { runId: string; sessionKey: string; message: string; emit: (e: RunEvent) => void }) => void;

/** Scriptable in-memory AgentGateway. Mirrors runtime behaviour observed in the spike. */
export class FakeGateway extends AgentGateway {
  readonly state$ = new BehaviorSubject<GatewayState>("connected");
  readonly ready$ = new Subject<void>();
  readonly events$ = new Subject<RunEvent>();

  sent: Array<{ sessionKey: string; message: string; idempotencyKey: string }> = [];
  aborted: Array<{ sessionKey: string; runId?: string }> = [];
  sessions = new Set<string>();
  /** What each chat.send does next; default: a complete answer with one tool call. */
  script: Script = FakeGateway.answer("Hello from the fake runtime.");
  /** Per-session transcripts, like the real chat.history. Default: idle, empty. */
  historyBySession = new Map<string, SessionHistory>();
  waitResult: RunWaitResult = { status: "timeout", stopReason: null, error: null };
  /**
   * Next chat.send outcome: "ack-lost" = the run starts but the reply is lost (timeout after
   * the frame was written); "not-sent" = it never reached the Gateway.
   */
  sendFailure: "ack-lost" | "not-sent" | null = null;
  private activeRuns = new Map<string, string>(); // runId -> sessionKey

  currentState() {
    return this.state$.value;
  }

  emit(e: RunEvent) {
    if (e.kind === "terminal") this.activeRuns.delete(e.runId);
    this.events$.next(e);
  }

  /** Mirrors OpenClaw: session labels must be unique across sessions ("label already in use"). */
  private labels = new Map<string, string>();
  async ensureSession(sessionKey: string, title: string) {
    const label = `personalos ${sessionKey.split(":").at(-1)}`; // what the real adapter sends
    const owner = this.labels.get(label);
    if (owner && owner !== sessionKey) throw new GatewayRpcError("sessions.create", "INVALID_REQUEST", `label already in use: ${title}`);
    this.labels.set(label, sessionKey);
    this.sessions.add(sessionKey);
  }

  async sendMessage(p: { sessionKey: string; message: string; idempotencyKey: string }) {
    if (this.state$.value !== "connected") throw new GatewayNotSentError("not connected");
    const failure = this.sendFailure;
    this.sendFailure = null;
    if (failure === "not-sent") throw new GatewayNotSentError("simulated");
    const dup = this.sent.find((s) => s.idempotencyKey === p.idempotencyKey);
    this.sent.push(p);
    if (dup) return { runId: p.idempotencyKey, status: "in_flight" };
    const runId = p.idempotencyKey; // as in OpenClaw: runId === idempotencyKey
    this.activeRuns.set(runId, p.sessionKey);
    // Events arrive asynchronously, like the real Gateway (sometimes before chat.send resolves).
    setImmediate(() => this.script({ runId, sessionKey: p.sessionKey, message: p.message, emit: (e) => this.emit(e) }));
    if (failure === "ack-lost") throw new GatewayAckUnknownError("chat.send");
    return { runId, status: "started" };
  }

  async abort(p: { sessionKey: string; runId?: string }) {
    this.aborted.push(p);
    const runId = p.runId && this.activeRuns.has(p.runId) ? p.runId : undefined;
    if (!runId) return { aborted: false, runIds: [] };
    setImmediate(() => this.emit({ kind: "terminal", runId, sessionKey: p.sessionKey, state: "aborted", text: "", errorKind: null, stopReason: "rpc" }));
    return { aborted: true, runIds: [runId] };
  }

  async history(sessionKey: string) {
    return this.historyBySession.get(sessionKey) ?? { exists: true, messages: [], inFlightRunId: null, hasActiveRun: false, activeRunIds: [] };
  }

  async waitForRun() {
    return this.waitResult;
  }

  // ---------- scripts ----------

  static answer(text: string): Script {
    return ({ runId, sessionKey, emit }) => {
      emit({ kind: "progress", runId, sessionKey, phase: "preparing" });
      emit({ kind: "lifecycle-start", runId, sessionKey });
      emit({ kind: "progress", runId, sessionKey, phase: "thinking" });
      emit({ kind: "tool", runId, sessionKey, phase: "start", toolCallId: "call_1", name: "web_fetch", title: "Web Fetch from https://example.com", ok: null });
      emit({ kind: "tool", runId, sessionKey, phase: "end", toolCallId: "call_1", name: "web_fetch", title: "Web Fetch from https://example.com", ok: true });
      const half = text.slice(0, Math.ceil(text.length / 2));
      emit({ kind: "delta", runId, sessionKey, payload: { deltaText: half, message: { role: "assistant", content: [{ type: "text", text: half }] } } });
      emit({ kind: "delta", runId, sessionKey, payload: { deltaText: text.slice(half.length) } });
      // Spike F5: empty replace right before final.
      emit({ kind: "delta", runId, sessionKey, payload: { deltaText: "", replace: true, message: { role: "assistant", content: [{ type: "text", text: "" }] } } });
      emit({ kind: "terminal", runId, sessionKey, state: "final", text, errorKind: null, stopReason: "stop" });
    };
  }

  /** Starts and then stays running until aborted or driven by the test. */
  static hang(): Script {
    return ({ runId, sessionKey, emit }) => {
      emit({ kind: "lifecycle-start", runId, sessionKey });
      emit({ kind: "progress", runId, sessionKey, phase: "thinking" });
    };
  }
}
