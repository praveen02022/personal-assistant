# Spike 0001 — PersonalOS ⇄ OpenClaw Gateway integration

- **Date:** 2026-10-31
- **Status:** Complete — all required checks passed (with findings below)
- **Pinned runtime:** OpenClaw `2026.10.9` (revision `8b18b5578f66eab1501cba4cef2310d88bfb9a41`)
- **Client packages:** `@openclaw/gateway-client@2026.10.9`, `@openclaw/gateway-protocol@2026.10.9` (wire protocol v4)
- **Artifacts:** `spikes/gateway/spike.ts`, `spikes/gateway/recordings/*.jsonl` (redacted), `infra/openclaw/*`

## 1. Results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Container startup & state isolation | ✅ | Own volume `personalos-openclaw-state`; published on `127.0.0.1:18790` only; LAN IP refused; host Gateway (`~/.openclaw`, :18789, pid 87474) untouched (config mtime 28 Jul) |
| 2 | Version & image digest | ✅ | `ghcr.io/openclaw/openclaw@sha256:1a2a3ce113e435039dbeac5ae261759bb4759908563d91c81059e896b38c5d98` (multi-arch index; amd64 + arm64); label `org.opencontainers.image.version=2026.10.9`; `hello-ok.server.version=2026.10.9` |
| 3 | Gateway auth & device pairing | ✅ | First connect → `PAIRING_REQUIRED`; `openclaw devices approve <requestId>`; reconnect → device token with exactly `operator.read`, `operator.write` (`connect.jsonl`) |
| 4 | Agent request submission | ✅ | `chat.send` → `{runId, status:"started", messageSeq}`; idempotent resend → same `runId`, `status:"in_flight"` |
| 5 | Streaming text + tool/lifecycle events | ✅ | `chat` status/delta/final; `agent` streams `run_status`, `lifecycle`, `assistant`, `item`, `tool`, `usage` (`chat.jsonl`, `chat-tools.jsonl`) |
| 6 | Completion & failure behaviour | ✅ | Final, timeout (`errorKind:"timeout"`), invalid params, agent/session mismatch, missing scope, denied tool, unknown run (`timeout.jsonl`, `negative.jsonl`) |
| 7 | Session handling & cancellation | ✅ | Continuity within session, isolation across sessions, `chat.history`; `chat.abort` → `aborted` in ~50 ms; Gateway restart → automatic recovery run (`abort.jsonl`, `restart.jsonl`, `history.jsonl`) |
| 8 | Read-only tool restriction | ✅ (after 4 fixes) | Effective tools = `session_status`, `web_fetch`; 64 excluded; 8 red-team prompts produced zero denied tool calls (`introspect-final.jsonl`, `redteam/`) |
| 9 | Codex OAuth compatibility | ✅ | Device-code login inside container; profile `openai-codex:personalos` in the agent's own store; runs on the **OpenClaw** runtime (not native Codex harness) |
| — | Credential isolation | ✅ | Profile only in `/home/node/.openclaw/agents/personalos/agent/openclaw-agent.sqlite` (0600, inside volume). `main` agent in the same container has 0 profiles. Nothing copied from or written to `~/.openclaw` on the host |

## 2. Topology as built

```text
host (macOS)                                    container personalos-openclaw-gateway
─────────────                                   ─────────────────────────────────────
spike.ts / (later) NestJS API                   OpenClaw 2026.10.9 (node user, uid 1000)
  @openclaw/gateway-client 2026.10.9              gateway.bind = lan (inside container only)
  ws://127.0.0.1:18790  ──docker port-forward──▶  :18789
  Ed25519 device identity  (.secrets/, 0600)     state volume /home/node/.openclaw
  device token             (.secrets/, 0600)       ├─ openclaw.json (managed via config patch)
  gateway token            (infra/openclaw/.env)   ├─ agents/personalos/agent/openclaw-agent.sqlite  ← Codex OAuth
                                                   └─ workspace-personalos/
```

Connections arrive from the Docker bridge (`remoteIp: 172.18.0.1`), so the Gateway treats them as **remote**: no loopback auto-approval, explicit pairing required. This is the behaviour we want in production too.

## 3. Configuration decisions (`infra/openclaw/personalos.config.json5`)

Applied with `openclaw config patch` (validated with `--dry-run` first). The Gateway hot-reloads; no restart needed.

| Setting | Value | Why |
|---|---|---|
| `gateway.controlUi.enabled` | `false` | The backend is the sole control/approval surface; the Control UI could otherwise resolve approvals |
| `gateway.tools.deny` | runtime, fs, ui, automation, messaging, nodes, sessions_spawn/send, subagents, media generation, `presence`, `openclaw` | Coarse emergency layer, independent of profiles |
| `tools.profile` / `tools.deny` | `minimal` + same deny list | Baseline for every agent on this Gateway |
| `tools.codeMode` | `{enabled:false}` (+ agent + per-model) | **Finding F1** |
| `tools.toolSearch` | `false` | **Finding F2** |
| `agents.entries.personalos.tools` | `profile:minimal`, `alsoAllow:[web_search, web_fetch]` | Read-only info tools only |
| `agents.entries.*.models[...].agentRuntime.id` | `"openclaw"` | **Finding F3** |
| `agents.entries.personalos.skills` | `[]` | No skills until Phase 3 |
| `session.reset.mode` | `"none"` | Explicit; default changed between versions (daily → none) |
| heartbeat `every` | `"0m"` (defaults, main, personalos) | **Finding F6** |
| `plugins.entries.memory-core.config.dreaming.enabled` | `false` | **Finding F6** |

## 4. Wire payloads (redacted)

### 4.1 Handshake and pairing

Client identity used by the backend (closed set in `GATEWAY_CLIENT_NAMES` / `GATEWAY_CLIENT_MODES`):

```json
{ "clientName": "gateway-client", "mode": "backend", "clientDisplayName": "PersonalOS API (spike)",
  "platform": "node", "deviceFamily": "server", "role": "operator",
  "scopes": ["operator.read", "operator.write"], "caps": ["tool-events"],
  "minProtocol": 4, "maxProtocol": 4 }
```

Unpaired connect error (`connect-error`):

```json
{ "message": "device pairing required (requestId: ffcfedae-…)", "code": "NOT_PAIRED",
  "details": { "code": "PAIRING_REQUIRED", "reason": "not-paired", "requestId": "ffcfedae-…",
    "remediationHint": "Approve this device from the pending pairing requests.",
    "deviceId": "a3dbe622…", "requestedRole": "operator",
    "requestedScopes": ["operator.read", "operator.write"] } }
```

Pending request as seen by the operator (`openclaw devices list --json`), verified before approval:

```json
{ "requestId": "ffcfedae-…", "deviceId": "a3dbe622…", "publicKey": "<redacted>",
  "displayName": "PersonalOS API (spike)", "clientId": "gateway-client", "clientMode": "backend",
  "role": "operator", "scopes": ["operator.read", "operator.write"], "remoteIp": "172.18.0.1" }
```

`hello-ok` (abridged):

```json
{ "type": "hello-ok", "protocol": 4,
  "server": { "version": "2026.10.9", "buildId": "2026.10.9-8b18b5578f66-…", "bootId": "…", "connId": "…" },
  "features": { "methods": ["…505 entries…"], "events": ["…65 entries…"] },
  "auth": { "method": "token", "role": "operator", "scopes": ["operator.read", "operator.write"],
            "deviceToken": "<redacted>", "recoveryScope": "<redacted>", "issuedAtMs": 1793430600352 },
  "policy": { "maxPayload": 26214400, "maxBufferedBytes": 52428800, "tickIntervalMs": 30000,
              "attachments": { "maxBytes": 19464192, "maxImageBytes": 6291456 } },
  "snapshot": { "suspension": {}, "presence": [], "health": {}, "sessionDefaults": {}, "…": "…" } }
```

### 4.2 Session creation

```json
// req sessions.create
{ "key": "agent:personalos:personalos:c1", "agentId": "personalos", "label": "spike c1",
  "permissionMode": "read-only", "idempotencyKey": "<uuid>" }
// res
{ "ok": true, "key": "agent:personalos:personalos:c1", "sessionId": "7811aae6-…",
  "entry": { "sessionRoot": "/home/node/.openclaw/workspace-personalos", "permissionMode": "read-only",
             "delivery": { "kind": "none" }, "createdVia": "operator", "parentSessionKey": "agent:personalos:main" },
  "runStarted": false }
```

`sessions.describe` for an unknown key returns `{ "session": null }` (not an error).
`sessions.describe` for a live session reports `agentRuntime: { id: "openclaw", source: "model" }`.

### 4.3 Run submission

```json
// req chat.send
{ "sessionKey": "agent:personalos:personalos:c1", "agentId": "personalos",
  "message": "My name is Praveen. Reply with one short friendly sentence.", "idempotencyKey": "<uuid>" }
// res
{ "runId": "7c9bcd35-…", "status": "started", "messageSeq": 1 }
// same idempotencyKey again
{ "runId": "7c9bcd35-…", "status": "in_flight" }
```

The `runId` equals the user-message idempotency prefix in history (`"idempotencyKey": "7c9bcd35-…:user"`), so **AppTask.id → idempotencyKey → runId** correlation is one-to-one.

### 4.4 Event sequence — plain answer (ms from start)

| dt | event | payload essentials |
|---:|---|---|
| 2100 | `chat` | `state:"status", phase:"preparing_workspace"` |
| 2100 | `agent` | `stream:"run_status", data.phase:"preparing_workspace"` |
| 2113 | `chat` / `agent` | `phase:"preparing_context"` |
| 2916 | `agent` | `stream:"lifecycle", data:{phase:"start", startedAt}` |
| 2918 | `chat` / `agent` | `phase:"starting_model"` |
| 4388 | `agent` | `stream:"lifecycle", data:{phase:"model", provider:"openai", model:"gpt-6-astra"}` |
| 5763 | `agent` | `stream:"assistant", data:{text:"Hi", delta:"Hi", phase:"final_answer", itemId}` |
| 5770 | `chat` | `state:"delta", deltaText:"Hi", message:{role:"assistant", content:[{type:"text",text:"Hi"}]}` |
| 5846 | `chat` | `state:"delta", deltaText:" Praveen, I’m your new assistant"` (coalesced) |
| 5950 | `agent` | `stream:"usage", data:{outputTokens}` |
| 6073 | `chat` | `state:"delta", deltaText:"", replace:true, message:{content:[{text:""}]}` ← **F5** |
| 6086 | `agent` | `stream:"lifecycle", data:{phase:"finishing", stopReason:"stop"}` |
| 6674 | `agent` | `stream:"lifecycle", data:{phase:"end", terminalReply:{disposition:"visible", text}}` |
| 6680 | `chat` | `state:"final", stopReason:"stop", message:{content:[{text:"Hi Praveen, …"}]}` |

`agent.wait` after completion:

```json
{ "runId": "7c9bcd35-…", "status": "ok", "startedAt": 1793431478853, "endedAt": 1793431482648,
  "terminalReceipt": { "requested": {"provider":"openai","model":"gpt-6-astra"},
    "effective": {"provider":"openai","model":"gpt-6-astra","responseModel":"gpt-6-astra"},
    "successfulToolNames": [], "terminalDisposition": "visible" },
  "terminalReply": { "disposition": "visible", "text": "Hi Praveen, …" } }
```

### 4.5 Tool events (`web_fetch`, after F1/F2 fixes)

```json
// agent stream:"item"  — display-oriented, has a human title
{ "stream": "item", "data": { "itemId": "tool:call_…", "toolCallId": "call_…", "name": "web_fetch", "kind": "tool",
  "phase": "start", "title": "Web Fetch from https://example.com", "status": "running", "startedAt": 1793431517331 } }
// agent stream:"tool"  — execution-oriented, carries args/result
{ "stream": "tool", "data": { "phase": "start", "name": "web_fetch", "toolCallId": "call_…",
  "args": { "url": "https://example.com", "extractMode": "text" } } }
{ "stream": "tool", "data": { "phase": "result", "name": "web_fetch", "toolCallId": "call_…", "isError": false,
  "result": { "content": [{ "type": "text", "text": "{… <<<EXTERNAL_UNTRUSTED_CONTENT …>>> …}" }] } } }
{ "stream": "item", "data": { "phase": "end", "status": "completed", "startedAt": …, "endedAt": … } }
```

Tool events arrive **only** because the client advertised `caps:["tool-events"]`. Fetched content is wrapped by OpenClaw in `EXTERNAL_UNTRUSTED_CONTENT` markers (prompt-injection hygiene).

### 4.6 Cancellation

```json
// req chat.abort  (≈4.7 s into an essay)
{ "sessionKey": "agent:personalos:personalos:abort1", "agentId": "personalos" }
// chat (51 ms later)
{ "state": "aborted", "stopReason": "rpc", "message": { "content": [{ "text": "# Chennai…" }] } }
// agent lifecycle
{ "phase": "end", "status": "cancelled", "aborted": true, "stopReason": "rpc" }
// res chat.abort
{ "ok": true, "aborted": true, "runIds": ["d8eda099-…"] }
// agent.wait
{ "runId": "d8eda099-…", "status": "error", "stopReason": "rpc" }   ← map to CANCELLED, not FAILED
```

### 4.7 Failures

| Case | Outcome |
|---|---|
| `chat.send` without `idempotencyKey` | `INVALID_REQUEST` "must have required property 'idempotencyKey'" |
| `chat.send` with `agentId` ≠ session key's agent | `INVALID_REQUEST` "agent "personalos" does not match session key agent "main"" |
| `sessions.create` with `permissionMode:"full"` | `FORBIDDEN`, `details:{code:"MISSING_SCOPE", missingScope:"operator.admin"}` |
| `tools.invoke exec` | RPC ok, payload `{ok:false, error:{code:"not_found", message:"Tool not available: exec"}}` |
| `agent.wait` unknown runId | `{status:"timeout"}` (no error) |
| Run timeout (`chat.send timeoutMs:1500`) | `chat` `state:"error"`, `errorKind:"timeout"`; `agent.wait` `{status:"timeout", livenessState:"paused"}` |
| `config.get` with read scope | **Succeeds** — see F7 |

### 4.8 Gateway restart mid-run

1. Socket closes `1006` (no `shutdown` event observed). Client auto-reconnects (`ECONNRESET` ×4 with backoff) → new `hello-ok` with a new `bootId` after ~35 s.
2. `agent.wait(originalRunId)` → `{status:"timeout"}` — the original run is gone from memory.
3. `chat.history` shows a synthetic user row *"[System] Your previous turn was interrupted …"* and `inFlightRun.runId` = **a new runId** continuing the answer; `sessionInfo.hasActiveRun:true`.

See F4.

## 5. Findings and limitations

**F1 — Code Mode auto-engaged a JavaScript interpreter (fixed).** OpenClaw Code Mode (experimental) turns on automatically for "preferred" models, which includes `gpt-6-astra`. The model saw an `exec` tool that runs model-written JavaScript and calls permitted tools from inside it. Nested calls still passed tool policy (only `web_fetch` was reachable), but the default executor (`node:vm`) is documented as **not a security boundary**. Disabled globally, per agent, and per model.

**F2 — Tool Search wrapped calls (fixed).** It's on by default for embedded runs: real calls arrive as `tool_call` → nested `web_fetch` with `parentToolCallId`. It doesn't execute code, but it obscures the event stream, so I disabled it. The backend mapper will still handle `parentToolCallId` and treat control tools (`tool_call`, `tool_search`, `tool_describe`, `exec`, `wait`) as non-user-facing.

**F3 — Codex OAuth implicitly selects the native Codex harness (fixed).** With an official ChatGPT endpoint, the implicit runtime is `codex`, which keeps its own tool surface. Pinned `agentRuntime.id:"openclaw"` per model and verified it on the live session (`source:"model"`). Only on the OpenClaw runtime are our tool policy and future `before_tool_call` approval hooks authoritative.

**F4 — Restart recovery is always on and changes the runId.** Interrupted turns are resumed automatically with a new `runId`. Backend implication: after any reconnect, reconcile every `RUNNING` AppTask **by conversation**: read `chat.history` (`inFlightRun`, `sessionInfo.activeRunIds`), adopt the recovery run into the task (`metadata.runIds[]`), and show "Resumed after interruption". A task can't be settled from `agent.wait(originalRunId)` alone. For Phase 4 this means an auto-resumed turn can retry a side-effecting tool, so approvals must be per call, payload-bound, and tools must be idempotent.

**F5 — Live text ends with an empty `replace:true` delta before `final`.** A naive accumulator shows a blank answer. Use the client's `mergeChatStreamMessage` and treat `chat.final.message` as authoritative. `chat` deltas are coalesced; `agent.assistant` deltas are finer-grained.

**F6 — Built-in background automation (disabled).** A 30-minute heartbeat and a 03:00 "memory dreaming" job existed for the `main` agent. They were skipped only because `main` has no credentials. Both are disabled until Automations (Phase 5).

**F7 — `config.get` requires only `operator.read`.** Older docs implied `config.*` was admin-only; in 2026.10.9 only `set`/`patch`/`apply` are. No secret is exposed (the Gateway token is a SecretRef to an env var), but any read-scoped client sees the full configuration. Keep secrets as SecretRefs, never inline.

**F8 — `presence` is in the `minimal` profile (denied).** It exposes connected devices, IP addresses, and approximate geolocation. Denied at the Gateway, global, and agent layers.

**F9 — `web_search` is unavailable.** No provider is configured and no keyless provider is bundled in 2026.10.9 (the DuckDuckGo plugin would be a third-party install). Options for later: native Codex web search (`tools.web.search.openaiCodex`) or a keyed provider. `web_fetch` remains and has a data-exfiltration risk (a GET to an attacker-chosen URL after prompt injection). It's acceptable for the read-only MVP, but it should get a domain policy before integrations hold private data.

**F10 — Token cost per turn.** About 7–8k input tokens for a one-line exchange (system prompt and bootstrap context). This matters for the Codex allowance, and the workspace bootstrap files (`AGENTS.md`, `SOUL.md`, `BOOTSTRAP.md`, …) should be curated. The default `BOOTSTRAP.md` persona also makes the agent ask the user to name it on first contact.

**F11 — Version drift is real.** Between 2026.7.1 (host CLI) and 2026.10.9: `agents.list` became `agents.entries`, the session reset default changed, a "default agent" marker was retired, official client packages appeared, and `minimal` gained `presence`. Pinning by digest plus this spike's recordings act as our compatibility baseline. Re-run the spike before any upgrade.

**F12 — Operational notes.** The device-code login needs a TTY (`script` wrapper) and the code expires after 15 minutes. One-off CLI commands run via `infra/openclaw/oc.sh`. A Gateway restart takes ~10–35 s before clients reconnect.

## 6. Mapping to the PersonalOS SSE contract

| OpenClaw | PersonalOS `TaskEvent` |
|---|---|
| `chat` `state:"status"` `phase` | `task.progress { phase }` (preparing_workspace → "Getting ready", preparing_context → "Understanding request", starting_model → "Thinking") |
| `agent` `lifecycle:start` | `task.status RUNNING` |
| `agent` `item` `kind:"tool"` `phase:start` | `tool.started { toolCallId, tool:name, label:title }` (leaf tools only) |
| `agent` `item` `phase:end` | `tool.finished { toolCallId, ok: status==="completed" }` |
| `chat` `state:"delta"` | `assistant.delta` via `mergeChatStreamMessage` |
| `chat` `state:"final"` | `assistant.final { text }` + `task.status SUCCEEDED` |
| `chat` `state:"aborted"` | `task.status CANCELLED` |
| `chat` `state:"error"` + `errorKind` | `task.error { code: errorKind, retryable: timeout\|rate_limit }` + FAILED / TIMED_OUT |
| `agent.wait` `status:"error", stopReason:"rpc"` | CANCELLED (reconciliation path) |

Raw tool `args`/`result` are never forwarded to the browser.

## 7. Reproduce

```bash
cd infra/openclaw
docker compose up -d                                   # pinned digest, isolated volume
./oc.sh config patch --stdin < personalos.config.json5 # managed config
cd ../../spikes/gateway && pnpm install --ignore-workspace
node spike.ts connect        # first run → PAIRING_REQUIRED; approve with ../../infra/openclaw/oc.sh devices approve <id>
node spike.ts introspect     # effective tools
node spike.ts chat c1 "…"    # also: abort, history, describe, negative, timeout, restart
```

Model auth (once, interactive): `script -q /dev/null docker exec -it personalos-openclaw-gateway node /app/openclaw.mjs models auth login --provider openai --method device-code --agent personalos --profile-id openai-codex:personalos`.
