import type { TaskEvent } from "@personalos/contracts";
import { describe, expect, it } from "vitest";
import { initialTaskView, reduceTask } from "./task-stream";

const run = (events: TaskEvent[]) => events.reduce(reduceTask, initialTaskView);

describe("reduceTask", () => {
  it("builds progress steps only from runtime events, completing earlier steps", () => {
    const v = run([
      { type: "task.status", status: "RUNNING" },
      { type: "task.progress", phase: "preparing" },
      { type: "task.progress", phase: "thinking" },
      { type: "tool.started", toolCallId: "t1", tool: "web_fetch", label: "Web Fetch from https://example.com" },
    ]);
    expect(v.steps.map((s) => [s.label, s.state])).toEqual([
      ["Getting ready", "done"],
      ["Thinking", "done"],
      ["Web Fetch from https://example.com", "active"],
    ]);
  });

  it("marks a failed tool and keeps the answer text as snapshots", () => {
    const v = run([
      { type: "tool.started", toolCallId: "t1", tool: "web_fetch", label: "Fetch" },
      { type: "tool.finished", toolCallId: "t1", ok: false },
      { type: "assistant.text", text: "Hel" },
      { type: "assistant.text", text: "Hello" },
    ]);
    expect(v.steps[0]).toMatchObject({ state: "failed" });
    expect(v.text).toBe("Hello");
  });

  it("settles active steps as failed when the task fails, and keeps the error", () => {
    const v = run([
      { type: "task.progress", phase: "thinking" },
      { type: "task.error", code: "RUN_TIMEOUT", message: "Took too long", retryable: true },
      { type: "task.status", status: "TIMED_OUT" },
    ]);
    expect(v.status).toBe("TIMED_OUT");
    expect(v.steps[0]).toMatchObject({ state: "failed" });
    expect(v.error).toEqual({ code: "RUN_TIMEOUT", message: "Took too long", retryable: true });
  });

  it("final text wins over streamed snapshots", () => {
    const v = run([
      { type: "assistant.text", text: "partial" },
      { type: "assistant.final", text: "complete answer" },
      { type: "task.status", status: "SUCCEEDED" },
    ]);
    expect(v).toMatchObject({ text: "complete answer", final: "complete answer", status: "SUCCEEDED" });
  });
});
