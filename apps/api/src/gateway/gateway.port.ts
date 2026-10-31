import type { GatewayState, ProgressPhase } from "@personalos/contracts";
import type { Observable } from "rxjs";

/**
 * Normalised agent-run events. OpenClaw wire shapes stop at the gateway module;
 * everything downstream (tasks, SSE, tests) depends only on these types.
 */
export type RunEvent =
  | { kind: "progress"; runId: string; sessionKey: string; phase: ProgressPhase }
  | { kind: "lifecycle-start"; runId: string; sessionKey: string }
  | {
      kind: "tool";
      runId: string;
      sessionKey: string;
      phase: "start" | "end";
      toolCallId: string;
      name: string;
      title: string;
      ok: boolean | null;
    }
  /** Raw chat delta; merged into the run's message with the official merge helper. */
  | { kind: "delta"; runId: string; sessionKey: string; payload: { message?: unknown; deltaText?: unknown; replace?: unknown } }
  | {
      kind: "terminal";
      runId: string;
      sessionKey: string;
      state: "final" | "aborted" | "error";
      text: string;
      errorKind: string | null;
      stopReason: string | null;
    };

export type HistoryMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  runId: string | null;
  /** Runtime-injected rows (e.g. restart-recovery prompts); hidden from the UI. */
  internal: boolean;
};

export type SessionHistory = {
  exists: boolean;
  messages: HistoryMessage[];
  inFlightRunId: string | null;
  hasActiveRun: boolean;
  /** Exact active set when known; null = unknown (another owner is active). */
  activeRunIds: string[] | null;
};

export type RunWaitResult = {
  status: "ok" | "error" | "timeout" | "pending";
  stopReason: string | null;
  error: string | null;
};

/** DI token + contract for the agent runtime. Implemented by OpenClawGatewayService; faked in tests. */
export abstract class AgentGateway {
  abstract readonly state$: Observable<GatewayState>;
  /** Emits after every successful (re)handshake, including the first. Triggers reconciliation. */
  abstract readonly ready$: Observable<void>;
  abstract readonly events$: Observable<RunEvent>;
  abstract currentState(): GatewayState;
  abstract ensureSession(sessionKey: string, label: string): Promise<void>;
  abstract sendMessage(p: { sessionKey: string; message: string; idempotencyKey: string }): Promise<{ runId: string; status: string }>;
  abstract abort(p: { sessionKey: string; runId?: string }): Promise<{ aborted: boolean; runIds: string[] }>;
  abstract history(sessionKey: string, limit: number): Promise<SessionHistory>;
  abstract waitForRun(runId: string, timeoutMs: number): Promise<RunWaitResult>;
}

/** Extracts visible text from an OpenClaw message ({content: string | {type,text}[]}). */
export function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is { type: string; text: string } => !!p && typeof p === "object" && (p as { type?: unknown }).type === "text")
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("");
}
