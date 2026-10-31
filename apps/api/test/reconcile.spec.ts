import { describe, expect, it } from "vitest";
import type { HistoryMessage, SessionHistory } from "../src/gateway/gateway.port.js";
import { decideReconciliation } from "../src/tasks/reconcile.js";

const started = new Date("2026-10-31T10:00:00Z");
const msg = (role: "user" | "assistant", at: Date, extra: Partial<HistoryMessage> = {}): HistoryMessage => ({
  id: `${role}-${at.getTime()}`,
  role,
  text: `${role} text`,
  timestamp: at.getTime(),
  runId: null,
  internal: false,
  ...extra,
});
const history = (h: Partial<SessionHistory>): SessionHistory => ({
  exists: true,
  messages: [],
  inFlightRunId: null,
  hasActiveRun: false,
  activeRunIds: [],
  ...h,
});
const after = (s: number) => new Date(started.getTime() + s * 1000);

describe("decideReconciliation", () => {
  it("keeps a task whose run is still active", () => {
    const d = decideReconciliation({ knownRunIds: ["r1"], taskStartedAt: started, history: history({ hasActiveRun: true, activeRunIds: ["r1"] }), wait: null });
    expect(d.action).toBe("keep-running");
  });

  it("adopts the restart-recovery run (new runId in flight)", () => {
    const d = decideReconciliation({ knownRunIds: ["r1"], taskStartedAt: started, history: history({ inFlightRunId: "r2", hasActiveRun: true }), wait: null });
    expect(d).toEqual({ action: "adopt-run", runId: "r2" });
  });

  it("asks the runtime before judging an idle session", () => {
    const d = decideReconciliation({ knownRunIds: ["r1"], taskStartedAt: started, history: history({}), wait: null });
    expect(d.action).toBe("query-wait");
  });

  it("settles SUCCEEDED with the answer when the run finished while we were away", () => {
    const h = history({ messages: [msg("user", after(1)), msg("assistant", after(5))] });
    const d = decideReconciliation({ knownRunIds: ["r1"], taskStartedAt: started, history: h, wait: { status: "ok", stopReason: "stop", error: null } });
    expect(d).toEqual({ action: "settle", status: "SUCCEEDED", errorCode: null, finalText: "assistant text" });
  });

  it("maps a cancelled run (error + stopReason rpc) to CANCELLED, not FAILED", () => {
    const d = decideReconciliation({ knownRunIds: ["r1"], taskStartedAt: started, history: history({}), wait: { status: "error", stopReason: "rpc", error: null } });
    expect(d).toMatchObject({ action: "settle", status: "CANCELLED" });
  });

  it("uses the transcript when the runtime forgot the run (gateway restarted)", () => {
    const h = history({ messages: [msg("user", after(1)), msg("user", after(2), { internal: true }), msg("assistant", after(9))] });
    const d = decideReconciliation({ knownRunIds: ["r1"], taskStartedAt: started, history: h, wait: { status: "timeout", stopReason: null, error: null } });
    expect(d).toMatchObject({ action: "settle", status: "SUCCEEDED" });
  });

  it("marks INTERRUPTED when the runtime forgot the run and no answer exists", () => {
    const h = history({ messages: [msg("assistant", new Date(started.getTime() - 60_000)), msg("user", after(1))] });
    const d = decideReconciliation({ knownRunIds: ["r1"], taskStartedAt: started, history: h, wait: { status: "timeout", stopReason: null, error: null } });
    expect(d).toEqual({ action: "settle", status: "FAILED", errorCode: "INTERRUPTED", finalText: null });
  });

  it("does not credit an answer older than the task", () => {
    const h = history({ messages: [msg("assistant", new Date(started.getTime() - 1000))] });
    const d = decideReconciliation({ knownRunIds: ["r1"], taskStartedAt: started, history: h, wait: { status: "timeout", stopReason: null, error: null } });
    expect(d).toMatchObject({ status: "FAILED", errorCode: "INTERRUPTED" });
  });
});
