#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

command -v bun >/dev/null 2>&1 || {
  echo "Bun is required: https://bun.com/docs/installation" >&2
  exit 1
}

bun install

if [[ ! -f apps/web/.env.local ]]; then
  cp apps/web/.env.example apps/web/.env.local
  echo "Created apps/web/.env.local; add OAuth credentials when needed."
fi

echo "Ready. Run: bun run dev"
