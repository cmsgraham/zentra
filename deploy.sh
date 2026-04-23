#!/usr/bin/env bash
# ─────────────────────────────────────────────
#  Zentra deploy script
#  Usage:
#    ./deploy.sh            — sync web source + build + restart web
#    ./deploy.sh api        — sync api  source + build + restart api
#    ./deploy.sh all        — sync both + build + restart both
#    ./deploy.sh caddy      — sync Caddyfile + reload caddy (no rebuild)
#    ./deploy.sh --no-sync  — skip file sync (just rebuild with what's on server)
# ─────────────────────────────────────────────
set -euo pipefail

SSH_KEY=~/.ssh/key
SSH_HOST=cmsgraham@172.235.130.124
REMOTE='/home/cmsgraham/inkflow'
LOCAL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TARGET="${1:-web}"
NO_SYNC=false
[[ "${1:-}" == "--no-sync" ]] && { NO_SYNC=true; TARGET="web"; }
[[ "${2:-}" == "--no-sync" ]] && NO_SYNC=true

ssh_run() { ssh -i "$SSH_KEY" "$SSH_HOST" "$1"; }

rsync_web() {
  echo "→ Syncing web source..."
  rsync -az --delete --checksum -e "ssh -i $SSH_KEY" \
    "$LOCAL/apps/web/app/"        "$SSH_HOST:$REMOTE/apps/web/app/"
  rsync -az --delete --checksum -e "ssh -i $SSH_KEY" \
    "$LOCAL/apps/web/components/" "$SSH_HOST:$REMOTE/apps/web/components/"
  rsync -az --delete --checksum -e "ssh -i $SSH_KEY" \
    "$LOCAL/apps/web/lib/"        "$SSH_HOST:$REMOTE/apps/web/lib/"
  rsync -az --delete --checksum -e "ssh -i $SSH_KEY" \
    "$LOCAL/apps/web/public/"     "$SSH_HOST:$REMOTE/apps/web/public/"
  # Individual config files
  for f in next.config.mjs tsconfig.json package.json postcss.config.mjs; do
    rsync -az --checksum -e "ssh -i $SSH_KEY" \
      "$LOCAL/apps/web/$f" "$SSH_HOST:$REMOTE/apps/web/$f"
  done
  echo "✓ Web source synced"
}

rsync_api() {
  echo "→ Syncing api source..."
  rsync -az --delete --checksum -e "ssh -i $SSH_KEY" \
    "$LOCAL/apps/api/src/" "$SSH_HOST:$REMOTE/apps/api/src/"
  for f in tsconfig.json package.json; do
    rsync -az --checksum -e "ssh -i $SSH_KEY" \
      "$LOCAL/apps/api/$f" "$SSH_HOST:$REMOTE/apps/api/$f"
  done
  # DB migrations are baked into the API image at build time (see Dockerfile.prod
  # `COPY . .`). Always sync so new migrations apply on the next API restart.
  rsync -az --delete --checksum -e "ssh -i $SSH_KEY" \
    "$LOCAL/db/migrations/" "$SSH_HOST:$REMOTE/db/migrations/"
  echo "✓ API source + migrations synced"
}

rsync_caddy() {
  echo "→ Syncing Caddyfile..."
  rsync -az --checksum -e "ssh -i $SSH_KEY" \
    "$LOCAL/infra/Caddyfile" "$SSH_HOST:$REMOTE/infra/Caddyfile"
  echo "→ Reloading Caddy..."
  # 'caddy reload' can silently no-op when admin API compares stale state;
  # restart is more reliable and only takes ~3s (certs are persisted in /data volume).
  ssh_run "docker restart zentra-caddy"
  echo "✓ Caddy reloaded"
}

build_and_restart() {
  local service="$1"
  echo "→ Building $service..."
  ssh_run "cd $REMOTE/infra && docker compose -f docker-compose.prod.yml --env-file $REMOTE/.env.prod build --no-cache $service"
  echo "→ Restarting $service..."
  ssh_run "cd $REMOTE/infra && docker compose -f docker-compose.prod.yml --env-file $REMOTE/.env.prod up -d $service"
  echo "✓ $service deployed"
}

echo ""
echo "╔══════════════════════════════╗"
echo "║  Zentra Deploy — target: $TARGET  "
echo "╚══════════════════════════════╝"
echo ""

if [[ "$NO_SYNC" == "false" ]]; then
  case "$TARGET" in
    web) rsync_web ;;
    api) rsync_api ;;
    all) rsync_web; rsync_api ;;
    caddy) rsync_caddy; echo ""; echo "🚀 Done!"; exit 0 ;;
    *) echo "Unknown target '$TARGET'. Use: web | api | all | caddy"; exit 1 ;;
  esac
else
  echo "⚠ Skipping file sync (--no-sync)"
fi

echo ""

case "$TARGET" in
  web) build_and_restart web ;;
  api) build_and_restart api ;;
  all)
    build_and_restart web
    build_and_restart api
    ;;
esac

echo ""
echo "🚀 Done! https://usezentra.app"
echo ""
