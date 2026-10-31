import fs from "node:fs";
import path from "node:path";

/** Redacted Gateway traffic recorded by the Step 0 spike against OpenClaw 2026.10.9. */
export type RecordedFrame = { event: string; payload: unknown };

export function loadFrames(name: string): RecordedFrame[] {
  const file = path.join(import.meta.dirname, "..", "fixtures", `${name}.jsonl`);
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { kind: string; data: RecordedFrame })
    .filter((r) => r.kind === "event")
    .map((r) => r.data);
}
