import { describe, expect, it } from "vitest";
import { normalizeGatewayEvent } from "../src/gateway/event-normalizer.js";
import type { RunEvent } from "../src/gateway/gateway.port.js";
import { loadFrames } from "./helpers/fixtures.js";

const normalizeAll = (name: string) => loadFrames(name).map(normalizeGatewayEvent).filter((e): e is RunEvent => e !== null);

describe("normalizeGatewayEvent (recorded 2026.10.9 traffic)", () => {
  it("maps a plain answer to progress -> deltas -> final", () => {
    const events = normalizeAll("chat");
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("progress");
    expect(kinds).toContain("lifecycle-start");
    expect(kinds.filter((k) => k === "delta").length).toBeGreaterThan(0);
    expect(kinds.at(-1)).toBe("terminal");

    const phases = events.flatMap((e) => (e.kind === "progress" ? [e.phase] : []));
    expect(phases).toEqual(expect.arrayContaining(["preparing", "thinking", "finishing"]));

    const final = events.at(-1);
    expect(final).toMatchObject({ kind: "terminal", state: "final", stopReason: "stop" });
    expect(final?.kind === "terminal" && final.text.length).toBeGreaterThan(0);
    // All events of one run share runId and sessionKey.
    expect(new Set(events.map((e) => e.runId)).size).toBe(1);
  });

  it("emits leaf tool start/end with display titles, never raw args", () => {
    const tools = normalizeAll("chat-tools").filter((e): e is Extract<RunEvent, { kind: "tool" }> => e.kind === "tool");
    expect(tools.map((t) => [t.phase, t.name])).toEqual([
      ["start", "web_fetch"],
      ["end", "web_fetch"],
    ]);
    expect(tools[0]!.title).toMatch(/^Web Fetch from https:\/\/example\.com/);
    expect(tools[1]!.ok).toBe(true);
    expect(JSON.stringify(tools)).not.toContain("extractMode"); // args stay inside the gateway module
  });

  it("maps cancellation to an aborted terminal", () => {
    const terminal = normalizeAll("abort").find((e) => e.kind === "terminal");
    expect(terminal).toMatchObject({ state: "aborted", stopReason: "rpc" });
  });

  it("maps a run timeout to an error terminal with errorKind", () => {
    const terminal = normalizeAll("timeout").find((e) => e.kind === "terminal");
    expect(terminal).toMatchObject({ state: "error", errorKind: "timeout" });
  });

  it("drops orchestration wrapper tools and frames without run context", () => {
    const wrapper = { event: "agent", payload: { runId: "r", sessionKey: "s", stream: "item", data: { kind: "tool", phase: "start", name: "tool_call", toolCallId: "t" } } };
    expect(normalizeGatewayEvent(wrapper)).toBeNull();
    expect(normalizeGatewayEvent({ event: "tick", payload: { ts: 1 } })).toBeNull();
    expect(normalizeGatewayEvent({ event: "chat", payload: { state: "delta", deltaText: "x" } })).toBeNull();
  });
});
