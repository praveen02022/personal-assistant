import type { RunWaitResult, SessionHistory } from "../gateway/gateway.port.js";

/**
 * Decides the fate of a task we believed was RUNNING after we lost sight of it
 * (gateway reconnect, API restart, or stale-task sweep). Pure: inputs are what the
 * Gateway reports now; output is an action. See spike F4: OpenClaw resumes an
 * interrupted turn under a NEW runId, so the original runId cannot be trusted alone.
 */
export type ReconcileInput = {
  knownRunIds: string[];
  taskStartedAt: Date;
  history: SessionHistory;
  /** agent.wait on the latest known runId; null if not queried. */
  wait: RunWaitResult | null;
};

export type ReconcileDecision =
  | { action: "keep-running"; reason: string }
  | { action: "adopt-run"; runId: string }
  | { action: "settle"; status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT"; errorCode: string | null; finalText: string | null }
  | { action: "query-wait" };

export function decideReconciliation({ knownRunIds, taskStartedAt, history, wait }: ReconcileInput): ReconcileDecision {
  const known = new Set(knownRunIds);

  if (history.activeRunIds?.some((id) => known.has(id))) return { action: "keep-running", reason: "known run active" };
  if (history.inFlightRunId && known.has(history.inFlightRunId)) return { action: "keep-running", reason: "known run in flight" };
  // Restart recovery: the session is working on a run we have never seen.
  if (history.inFlightRunId && !known.has(history.inFlightRunId)) return { action: "adopt-run", runId: history.inFlightRunId };
  const unknownActive = history.activeRunIds?.find((id) => !known.has(id));
  if (unknownActive) return { action: "adopt-run", runId: unknownActive };
  if (history.hasActiveRun && history.activeRunIds === null) {
    return { action: "keep-running", reason: "session active, run ids unavailable" };
  }

  // Session is idle. Ask the runtime about our latest run before reading the transcript.
  if (!wait) return { action: "query-wait" };
  if (wait.status === "ok") return { action: "settle", status: "SUCCEEDED", errorCode: null, finalText: lastAssistantText(history, taskStartedAt) };
  if (wait.status === "error" && wait.stopReason === "rpc") return { action: "settle", status: "CANCELLED", errorCode: null, finalText: null };
  if (wait.status === "error") return { action: "settle", status: "FAILED", errorCode: "AGENT_ERROR", finalText: null };
  if (wait.status === "pending") return { action: "keep-running", reason: "queued in runtime" };

  // "timeout": the runtime no longer knows the run (e.g. it restarted). Use the transcript.
  const finalText = lastAssistantText(history, taskStartedAt);
  if (finalText !== null) return { action: "settle", status: "SUCCEEDED", errorCode: null, finalText };
  return { action: "settle", status: "FAILED", errorCode: "INTERRUPTED", finalText: null };
}

/** The assistant's answer for this task: a visible assistant row newer than the task, after its user turn. */
function lastAssistantText(history: SessionHistory, since: Date): string | null {
  const visible = history.messages.filter((m) => !m.internal);
  const last = visible.at(-1);
  if (!last || last.role !== "assistant" || last.timestamp < since.getTime()) return null;
  return last.text;
}
