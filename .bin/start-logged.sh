#!/bin/bash
cd /home/box/minecraft-bot
export MC_HOST=45.248.51.231
export MC_PORT=25566
export MC_USERNAME=Steve
export MC_AUTH=offline
export MC_VERSION=1.21.11
printf '\n--- start-logged %s ---\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /home/box/minecraft-bot/bot.log
exec /home/box/minecraft-bot/.bin/start-ver.js >> /home/box/minecraft-bot/bot.log 2>&1
