#!/bin/bash
# N mineflayer clients (official multiple.js idea). Default N=1 = start-logged.sh.
# Usage: .bin/start-cluster.sh [N]
set -euo pipefail
ROOT=/home/box/minecraft-bot
cd "$ROOT"
N="${1:-${STEVE_COUNT:-1}}"
if ! [[ "$N" =~ ^[0-9]+$ ]] || [ "$N" -lt 1 ]; then
  echo "usage: $0 [N]" >&2
  exit 2
fi
if [ "$N" -eq 1 ]; then
  exec "$ROOT/.bin/start-logged.sh"
fi
# N>1 only when someone passed the number. Each child: same play.js, different name.
BASE="${STEVE_NAME:-Steve}"
i=1
while [ "$i" -le "$N" ]; do
  if [ "$i" -eq 1 ]; then NAME="$BASE"; else NAME="${BASE}${i}"; fi
  LOG="$ROOT/bot-${NAME}.log"
  STATUS="$ROOT/STATUS-${NAME}.txt"
  echo "cluster start $NAME log=$LOG"
  STEVE_NAME="$NAME" STEVE_LOG="$LOG" STEVE_STATUS="$STATUS" \
    MC_USERNAME="$NAME" MC_AUTH=offline \
    MC_HOST="${MC_HOST:-45.248.51.231}" MC_PORT="${MC_PORT:-25566}" MC_VERSION="${MC_VERSION:-1.21.11}" \
    "$ROOT/.bin/start-ver.js" >> "$LOG" 2>&1 &
  echo $! > "$ROOT/.bin/bot-${NAME}.pid"
  i=$((i + 1))
  sleep 0.2
done
wait
