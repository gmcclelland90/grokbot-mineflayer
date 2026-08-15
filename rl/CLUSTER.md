# Steve cluster (ant colony)

Official idea: PrismarineJS/mineflayer `examples/multiple.js` — N mineflayer clients, same `play.js` / skills, different username, offline auth.

## Queen vs workers

- **Queen = planner, not a body.** The Grok Steve agent / keep-alive writes `rl/jobs.json`. There is no Queen player in Minecraft. Do not spawn one.
- **Workers** are Mineflayer processes (`Steve`, later `Steve2`…). A worker never invents a new colony goal. It only claims from the board.
- If the board is empty, a worker may add only foraging jobs: refill-stock / tend-farm / guard. Never “build a city”.
- `{ "queen": "chat+keepalive", "workers": ["Steve"] }` lives in `rl/jobs.json`. See `rl/queen.js`.

## How to scale

```
.bin/start-cluster.sh        # N=1 — same as .bin/start-logged.sh (current Steve)
.bin/start-cluster.sh 4      # later: Steve, Steve2, Steve3, Steve4
```

Env: `STEVE_COUNT=1` `STEVE_NAME=Steve`. Extra names Steve2… from `cluster.json`. **Do not run N>1 unless someone passes the number.**

N=1 is the live path. Same play loop, same skills.

## Shared brain (disk)

- `rl/storage.json` — camp origin, chests+catalog, targets, missing
- `rl/jobs.json` — queen board
- `schematics/` — camp / wheat / trees / hut
- `rl/FARMS.md` `rl/CAMP.md` `rl/matrix.json`

## Per-bot

- N=1: `bot.log` + `STATUS.txt` (unchanged)
- N>1: `STEVE_LOG=bot-Steve2.log` `STEVE_STATUS=STATUS-Steve2.txt` `MC_USERNAME=Steve2`

## Chest lock

`rl/chest.lock` so two workers do not open the same chest. N=1 still uses it.

## Allies

Never pvp/attack usernames in `cluster.json` names (Steve, Steve2, …). Same `!commands` work for any of them.

## Job priority (foraging)

1. leave-spawn (off roofs / r>=24, walk toward camp 32,0)
2. place-dump (4+1 labeled camp chests: terrain/stone/wood/food/misc) if roles missing
3. gather missing stock
4. deposit extras to the matching role chest
5. place camp
6. tend farm
7. guard camp
