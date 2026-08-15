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

1. leave-spawn (off roofs / r>=24). Do not close this for siblings still at spawn.
2. gather-wood (collectBlock logs, range 64+, r>=24) while logs<8
3. place-dump waits until logs>=2 (or a chest/planks in hand); never spin place-dump with empty wood
4. gather missing stock
5. deposit extras to the matching role chest
6. place camp
7. tend farm
8. guard camp

## Per-bot commands

Workers poll `rl/command-<username>.json` (e.g. `command-Steve2.json`). Shared `rl/command.json` is only consumed by Steve, or by a worker if `to`/`for`/`username` matches. Do not use shared command.json for hive-wide jobs — write `rl/jobs.json` or a per-bot file. Workers stay mute (no "on it" / "camp up").

## Hive loop

The six Steves must be constantly working. Standing still is a bug.

- **Observe** STATUS + `rl/episodes.jsonl` (idle / same-pos cause).
- **Patch** the cause (pathfinder, hole, no trees, job race, leave-spawn sit). Do not only restart.
- **Repeat** on the next keep-alive. Restart only dead or spawn-stuck extras after a code change.

Workers claim wood / dirt / dump / farm / guard from `rl/jobs.json`. Stale claims expire in 40s. If the board is empty a worker synthesizes a personal forage job. Doodle is last.

Stuck detector: same block ~20s → repath, new heading, step down. Leave-spawn walks radially out (`r>=24`) and must not sit on the 32,0 path.

Force wood at scan 64+. First grove pins `rl/storage.json` `camp.grove`. Then craft+place a dump chest.
