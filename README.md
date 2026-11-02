# PersonalOS

A personal AI assistant: Next.js UI → NestJS API → dedicated OpenClaw Gateway (agent runtime).

```text
Browser ──same-origin──▶ Next.js (127.0.0.1:3000)  ── /api/* rewrite ──▶  NestJS API (127.0.0.1:4000)
                                                                            │  Postgres (app data)
                                                                            │  WebSocket, paired device, read/write scopes
                                                                            ▼
                                                     OpenClaw Gateway 2026.10.9 (Docker, 127.0.0.1:18790)
```

- **Spike report and OpenClaw findings:** [`docs/spikes/0001-openclaw-gateway-spike.md`](docs/spikes/0001-openclaw-gateway-spike.md)
- **Gateway config (source of truth):** [`infra/openclaw/personalos.config.json5`](infra/openclaw/personalos.config.json5)

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js 16 (App Router, Cache Components), Tailwind 4, TanStack Query, SSE client |
| `apps/api` | NestJS 12 (ESM), Prisma 7 + Postgres, auth, gateway adapter, tasks + SSE |
| `packages/contracts` | Zod schemas shared by web and api (DTOs, SSE event union) |
| `infra/openclaw` | Pinned Gateway container, managed config, `oc.sh` CLI helper |
| `infra/postgres` | Local Postgres 17 (port 55433) |
| `spikes/gateway` | Step 0 integration spike + redacted recordings (re-run before any OpenClaw upgrade) |

## Run locally

Prerequisites: Node ≥ 22.19, pnpm 10, Docker.

```bash
pnpm install
pnpm db:up                                   # Postgres on 127.0.0.1:55433
pnpm gateway:up                              # OpenClaw Gateway on 127.0.0.1:18790
cp apps/api/.env.example apps/api/.env       # first time only
pnpm --filter @personalos/api db:deploy      # apply migrations
pnpm build
pnpm --filter @personalos/api start          # API
pnpm --filter @personalos/web start          # Web → http://localhost:3000
```

Pages: `/` Home · `/assistant` · `/connections` · `/settings` (theme + voice) · `/welcome`. The customer demo lives at `/demo` (sample data, simulated actions, isolated on the backend); see [docs/demo/README.md](docs/demo/README.md) for the presentation script and what is simulated vs live.

UI live tests (demo flow, themes, keyboard, axe contrast, phone layout, screenshots): `pnpm --filter @personalos/web exec playwright test --project=ui --project=ui-mobile`.

First run of a new API device: the API logs `Gateway pairing required … approve <requestId>`. Review, then approve:

```bash
infra/openclaw/oc.sh devices list
infra/openclaw/oc.sh devices approve <requestId>
```

The API retries every 10 s and, once paired, authenticates with its own device token (`.secrets/api-device/`).

Owner account (single user):

```bash
OWNER_EMAIL=you@example.com OWNER_NAME="Your Name" OWNER_PASSWORD='…12+ chars…' \
  pnpm --filter @personalos/api owner:create            # add --reset-password to rotate (revokes sessions)
```

## Voice (Phase 2)

Push-to-talk in the message box: **hold** the mic and release to finish, or **tap** to start and tap again to stop (Esc cancels). The transcript lands in the message box for you to edit; nothing is sent automatically. Answers to voice questions are read aloud (toggle in **Voice settings**), and every answer has **Read aloud**.

- Speech to text: Azure fast transcription, browser-native WebM/Opus, language Auto (en-IN + ta-IN), English or Tamil
- Text to speech: Azure neural voices (en-IN Neerja by default, ta-IN Pallavi), browser speech as fallback
- Audio is never stored; the audit log keeps metadata only
- Config: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` in `apps/api/.env` (use an S0 resource; F0 rate-limits after ~10 requests/minute)
- Findings: [`docs/spikes/0002-azure-voice-spike.md`](docs/spikes/0002-azure-voice-spike.md)

## Checks

```bash
pnpm turbo run typecheck lint test build
```

API integration tests use a separate database (`personalos_test`) and a fake gateway; they never touch the dev database or the Gateway.

## Secrets (never committed)

| File | Holds |
|---|---|
| `infra/openclaw/.env` | Gateway shared token (bootstrap only) |
| `apps/api/.env` | API config incl. database URL |
| `.secrets/api-device/` | API Ed25519 device key + issued device token |
| `.secrets/spike-*` | Spike device key + token |
