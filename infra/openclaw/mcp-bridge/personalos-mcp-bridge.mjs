#!/usr/bin/env node
/**
 * stdio <-> Streamable HTTP bridge for the PersonalOS MCP server.
 *
 * Why it exists: in OpenClaw 2026.10.9, MCP HTTP headers and stdio env values are plain config
 * literals (readable through `config.get` with read scope); SecretRefs aren't supported there.
 * So the token lives in a read-only mounted file, and openclaw.json only holds its path.
 *
 * Protocol: newline-delimited JSON-RPC on stdin/stdout (MCP stdio); each message is POSTed to
 * PERSONALOS_MCP_URL (stateless JSON mode). Diagnostics go to stderr only. No dependencies.
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const URL_ = process.env.PERSONALOS_MCP_URL;
// Read from a mounted secret file (Docker-secrets style): only the *path* is in openclaw.json.
const TOKEN = process.env.PERSONALOS_MCP_TOKEN_FILE ? readFileSync(process.env.PERSONALOS_MCP_TOKEN_FILE, "utf8").trim() : process.env.PERSONALOS_MCP_TOKEN;
const TIMEOUT_MS = Number(process.env.PERSONALOS_MCP_TIMEOUT_MS ?? 20000);
if (!URL_ || !TOKEN) {
  process.stderr.write("personalos-mcp-bridge: PERSONALOS_MCP_URL and PERSONALOS_MCP_TOKEN_FILE are required\n");
  process.exit(2);
}

let protocolVersion = null; // echoed after initialize, per the Streamable HTTP spec
const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const rpcError = (id, message, code = -32000) => id !== undefined && id !== null && write({ jsonrpc: "2.0", id, error: { code, message } });

async function forward(msg) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${TOKEN}` };
  if (protocolVersion) headers["Mcp-Protocol-Version"] = protocolVersion;
  let res;
  try {
    res = await fetch(URL_, { method: "POST", headers, body: JSON.stringify(msg), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    process.stderr.write(`personalos-mcp-bridge: request failed: ${err?.name ?? "error"}\n`);
    return rpcError(msg.id, "PersonalOS tools are unreachable right now");
  }
  if (res.status === 202 || res.status === 204) return; // notification accepted
  const type = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!res.ok && !type.includes("application/json")) {
    process.stderr.write(`personalos-mcp-bridge: HTTP ${res.status}\n`);
    return rpcError(msg.id, `PersonalOS tools returned HTTP ${res.status}`);
  }
  const emit = (payload) => {
    for (const m of Array.isArray(payload) ? payload : [payload]) {
      if (m?.result?.protocolVersion && msg.method === "initialize") protocolVersion = m.result.protocolVersion;
      write(m);
    }
  };
  if (type.includes("text/event-stream")) {
    for (const line of text.split("\n")) if (line.startsWith("data:")) emit(JSON.parse(line.slice(5)));
  } else if (text) {
    emit(JSON.parse(text));
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const inflight = new Set();
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return rpcError(null, "Parse error", -32700);
  }
  const p = forward(msg).catch((err) => {
    process.stderr.write(`personalos-mcp-bridge: ${err?.message ?? err}\n`);
    rpcError(msg?.id, "Bridge error");
  });
  inflight.add(p);
  p.finally(() => inflight.delete(p));
});
rl.on("close", async () => {
  await Promise.allSettled([...inflight]);
  process.exit(0);
});
