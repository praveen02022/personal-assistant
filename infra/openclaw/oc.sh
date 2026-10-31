#!/usr/bin/env bash
# Run the pinned OpenClaw CLI against the PersonalOS state volume.
# Uses `docker exec` when the Gateway container is running, otherwise a one-off container.
set -euo pipefail
cd "$(dirname "$0")"
if [ "$(docker inspect -f '{{.State.Running}}' personalos-openclaw-gateway 2>/dev/null)" = "true" ]; then
  exec docker exec -i personalos-openclaw-gateway node /app/openclaw.mjs "$@"
else
  exec docker compose run -T --rm --no-deps --entrypoint node openclaw-gateway /app/openclaw.mjs "$@" 2> >(grep -v -E 'Container|Network|Volume' >&2)
fi
