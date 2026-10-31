import type { ProgressPhase } from "@personalos/contracts";
import { messageText, type RunEvent } from "./gateway.port.js";

/**
 * Pure mapping from a Gateway event frame to a RunEvent (or null = not ours / not needed).
 * Shapes verified against recorded 2026.10.9 traffic (docs/spikes/0001, test/fixtures).
 */
const STATUS_PHASES: Record<string, ProgressPhase> = {
  preparing_workspace: "preparing",
  preparing_context: "preparing",
  starting_model: "thinking",
};

/** Orchestration wrappers (Tool Search / Code Mode). Their nested leaf calls are what users care about. */
const CONTROL_TOOLS = new Set(["tool_call", "tool_search", "tool_describe", "exec", "wait"]);

type Frame = { event: string; payload?: unknown };
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function normalizeGatewayEvent(frame: Frame): RunEvent | null {
  const p = frame.payload as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object") return null;
  const runId = str(p.runId);
  const sessionKey = str(p.sessionKey);
  if (!runId || !sessionKey) return null;

  if (frame.event === "chat") {
    switch (p.state) {
      case "status": {
        const phase = STATUS_PHASES[String(p.phase)];
        return phase ? { kind: "progress", runId, sessionKey, phase } : null;
      }
      case "delta":
        return { kind: "delta", runId, sessionKey, payload: { message: p.message, deltaText: p.deltaText, replace: p.replace } };
      case "final":
      case "aborted":
      case "error":
        return {
          kind: "terminal",
          runId,
          sessionKey,
          state: p.state,
          text: messageText(p.message),
          errorKind: str(p.errorKind),
          stopReason: str(p.stopReason),
        };
      default:
        return null;
    }
  }

  if (frame.event === "agent") {
    const data = (p.data ?? {}) as Record<string, unknown>;
    if (p.stream === "lifecycle") {
      if (data.phase === "start") return { kind: "lifecycle-start", runId, sessionKey };
      if (data.phase === "finishing") return { kind: "progress", runId, sessionKey, phase: "finishing" };
      return null;
    }
    // "item" carries display titles and completion status; "tool" carries raw args/results (never forwarded).
    if (p.stream === "item" && data.kind === "tool" && (data.phase === "start" || data.phase === "end")) {
      const name = str(data.name);
      const toolCallId = str(data.toolCallId);
      if (!name || !toolCallId || CONTROL_TOOLS.has(name)) return null;
      return {
        kind: "tool",
        runId,
        sessionKey,
        phase: data.phase,
        toolCallId,
        name,
        title: str(data.title) ?? name,
        ok: data.phase === "end" ? data.status === "completed" : null,
      };
    }
  }
  return null;
}
