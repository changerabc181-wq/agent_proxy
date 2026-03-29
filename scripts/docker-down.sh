#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
    return
  fi

  echo "Docker Compose is required but was not found." >&2
  exit 1
}

resolve_compose_cmd
cd "$ROOT_DIR"

"${COMPOSE_CMD[@]}" down --remove-orphans
echo "Stopped compose services. MySQL volume was preserved."
