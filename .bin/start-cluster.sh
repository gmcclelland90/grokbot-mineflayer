#!/bin/bash
# N mineflayer clients (official multiple.js idea). Default N=1 = start-logged.sh.
# Usage: .bin/start-cluster.sh [N]
# Skips usernames that already have a live pid (so N=6 can add Steve2..Steve6 next to Steve).
set -euo pipefail
ROOT=/home/box/minecraft-bot
cd "$ROOT"
N="${1:-${STEVE_COUNT:-1}}"
if ! [[ "$N" =~ ^[0-9]+$ ]] || [ "$N" -lt 1 ]; then
  echo "usage: $0 [N]" >&2
  exit 2
fi
# Paper home server — never spawn a crowd.
if [ "$N" -gt 8 ]; then
  echo "refusing N=$N (max 8)" >&2
  exit 2
fi
if [ "$N" -eq 1 ]; then
  exec "$ROOT/.bin/start-logged.sh"
fi
BASE="${STEVE_NAME:-Steve}"

is_live() {
  local name="$1"
  local status pf pid
  if [ "$name" = "$BASE" ]; then
    status="$ROOT/STATUS.txt"
  else
    status="$ROOT/STATUS-${name}.txt"
  fi
  if [ -f "$status" ]; then
    pid=$(awk -F= '/^pid=/{print $2; exit}' "$status" | tr -d '[:space:]')
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  # pid file without a STATUS means kicked/never-spawned keepAlive — not live
  return 1
}

i=1
started=0
while [ "$i" -le "$N" ]; do
  if [ "$i" -eq 1 ]; then NAME="$BASE"; else NAME="${BASE}${i}"; fi
  if is_live "$NAME"; then
    echo "cluster skip $NAME (already live)"
    i=$((i + 1))
    continue
  fi
  if [ "$NAME" = "$BASE" ]; then
    LOG="$ROOT/bot.log"
    STATUS="$ROOT/STATUS.txt"
  else
    LOG="$ROOT/bot-${NAME}.log"
    STATUS="$ROOT/STATUS-${NAME}.txt"
  fi
  echo "cluster start $NAME log=$LOG"
  STEVE_NAME="$NAME" STEVE_LOG="$LOG" STEVE_STATUS="$STATUS" \
    MC_USERNAME="$NAME" MC_AUTH=offline \
    MC_HOST="${MC_HOST:-45.248.51.231}" MC_PORT="${MC_PORT:-25566}" MC_VERSION="1.21.11" \
    "$ROOT/.bin/start-ver.js" >> "$LOG" 2>&1 &
  echo $! > "$ROOT/.bin/bot-${NAME}.pid"
  started=$((started + 1))
  i=$((i + 1))
  sleep 5
done
echo "cluster started $started new of N=$N"
# Do not wait — hive stays up; caller returns.
