import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectIntent, replyFor, scriptEvents } from "../src/demo/demo-script.js";
import { seedActions } from "../src/demo/demo-data.js";

/**
 * Static guard for the demo boundary. The demo must stay unable to reach real services, so its
 * source may import only shared contracts, Nest, and a short allowlist of app internals.
 * Adding an import of the gateway, integrations, MCP, voice providers, Prisma or tasks fails here.
 */
const DEMO_DIR = path.resolve(import.meta.dirname, "../src/demo");
const ALLOWED = new Set([
  "@nestjs/common",
  "@personalos/contracts",
  "express",
  "../audit/audit.service.js",
  "../auth/auth.decorators.js",
  "../common/errors.js",
  "../common/uuid.js",
  "../common/zod-validation.pipe.js",
]);

describe("demo boundary (static)", () => {
  const files = fs.readdirSync(DEMO_DIR).filter((f) => f.endsWith(".ts"));

  it.each(files)("%s imports nothing outside the allowlist", (file) => {
    const src = fs.readFileSync(path.join(DEMO_DIR, file), "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!).filter((s) => !s.startsWith("./"));
    expect(imports.filter((s) => !ALLOWED.has(s))).toEqual([]);
  });

  it.each(files)("%s makes no network or process calls", (file) => {
    const src = fs.readFileSync(path.join(DEMO_DIR, file), "utf8");
    expect(src).not.toMatch(/\bfetch\s*\(|node:(http|https|net|child_process)|WebSocket|process\.env/);
  });
});

describe("demo script", () => {
  it("routes requests (English and Tamil) to scripted intents", () => {
    expect(detectIntent("Give me my morning briefing")).toBe("briefing");
    expect(detectIntent("What meetings do I have tomorrow?")).toBe("tomorrow");
    expect(detectIntent("Order lunch for the team")).toBe("lunch");
    expect(detectIntent("What follow-ups are pending?")).toBe("followups");
    expect(detectIntent("Which payments are due?")).toBe("payments");
    expect(detectIntent("மதிய உணவு ஆர்டர் செய்")).toBe("lunch");
    expect(detectIntent("Write me a poem")).toBe("help");
  });

  it("produces well-formed event timelines that end in SUCCEEDED with the full text", () => {
    const reply = replyFor("lunch", seedActions(new Date()));
    const events = scriptEvents("t1", reply);
    const times = events.map((e) => e.atMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(events.at(-2)?.event).toEqual({ type: "assistant.final", text: reply.text });
    expect(events.at(-1)?.event).toEqual({ type: "task.status", status: "SUCCEEDED" });
    const texts = events.filter((e) => e.event.type === "assistant.text").map((e) => (e.event as { text: string }).text);
    expect(texts.at(-1)).toBe(reply.text);
    expect(texts.every((t, i) => i === 0 || t.startsWith(texts[i - 1]!))).toBe(true); // cumulative snapshots
  });

  it("never offers a fallback that pretends to answer from real data", () => {
    expect(replyFor("help", []).text).toMatch(/sample data/);
    expect(replyFor("help", []).sources).toEqual([]);
  });
});
