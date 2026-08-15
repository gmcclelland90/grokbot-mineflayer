# Steve Minecraft learnings

Durable notes for future Steve sessions. This file lives at `/home/box/minecraft-bot/LEARNINGS.md` (box home, persists). `/workspace` packages vanish — do not treat workspace as home.

Mineflayer itself does not learn. Persist this file, `play.js`, `config.json`, `STATUS.txt`, `bot.log`, and agent memory (`/home/box/agent-data/user-memory`).

## Who / where

- Player: Glenn, in-game **Har0x**.
- Bot username: **Steve**, offline auth.
- Server: `45.248.51.231:25566` (also `minecraft.playon.games:25566`). Java **1.21.11** Paper.
- Glenn will leave the server up so Steve can keep playing.

## Project (box, not workspace)

- Root: `/home/box/minecraft-bot` — **NOT** `/workspace`.
- Start: `.bin/start-logged.sh` (execs `.bin/start-ver.js` which imports `index.js`).
- Config: `config.json` (`host`/`port`/`username`/`auth`/`version`). Env vars `MC_*` override.
- Brain / play loop: `play.js` (`startPlayLoop`).
- Voyager persist (not PPO): `rl/skills.md`, `rl/episodes.jsonl`, `rl/score.js`, `rl/README.md`. LLM+skill+score loop. Logger loads next process start.
- Connect / plugins / pathfinder movements: `index.js`.
- Status snapshot: `STATUS.txt` (rewritten often; pid, pos, health, deaths, inventory counts, phase).
- Log: `bot.log` (duplicated lines are normal — console + file).
- Live pid is whatever `STATUS.txt` says (`pid=`). `.bin/bot.pid` can be stale. As of this write: process **166580** (`node /home/box/minecraft-bot/.bin/start-ver.js`).

## Chat / behaviour rules

- Chat is **MUTE** except the rare `"house up"` when the house is actually placed.
- No coord spam in chat. `plog()` is for `bot.log` only.
- Goal: gather sand/dirt, craft sandstone, build a tiny house. Village nearby.
- Do **not** grief player builds: oak planks, logs, doors, chests (also stairs/slabs/signs/beds, glass/wool/terracotta, crafting table/furnace, torches, etc. — see `isPlayerBuilt` in `play.js`).
- Don't ask Glenn to break down tasks. Own the house. Messing up is fine. Have fun and learn.

## House plan (current `play.js`)

- Gather until `sand >= 8` or `sandstone >= 4` or `dirt >= 16` (hard caps 64 / 20 / 24).
- Craft sandstone 4:1 from sand (`bot.craft`, no table needed).
- Build 5×5 footprint, 3-high walls, door gap at local `(2,0)` y 0–1, roof at y+3.
- Site: near Har0x `offset(5, 0, 3)`, else Steve `offset(3, 0, 3)`. `groundY` finds floor.
- **Never place gravity blocks** (sand/red_sand/gravel). Prefer sandstone; fallback dirt/grass_block/cobblestone.
- After a house pass, follow Har0x (~60s if done, ~15s if retry) then retry if incomplete.

## Lessons that hurt us

- **Never restart the bot for every code tweak.** Glenn sees leave/rejoin and forbade leave/rejoin spam. Patch `play.js` on disk; only start if the process is actually dead. Pid around 166580 must stay running unless it is gone.
- **Pathfinder jump-walk + `maxDropDown` caused cliff deaths on dunes.** `index.js` `applySafeMovements` still sets `allowParkour=true` and `maxDropDown=4`. `play.js` now prefers `walkTowardNoJump` + `cliffAhead` for gather walks. Do not re-enable jump-walk / high drop-down.
- **Gather used to search from Har0x's position** so sand under Steve was invisible. Search from **Steve**. Dig under/next to feet (`localDigCandidates`, `pickGatherTarget`). Walk within **4.5** (`DIG_REACH`) before dig. **One dig at a time** (`digBusy`).
- **Do not dig oak_planks** (or any player-built). Drops under a plank pad fall through and never get picked up. `standingOnForbidden` / `stepToAllowedFloor`: step onto sand/dirt first.
- **Inventory pickup is flaky.** After dig, walk onto the drop / `collectBlock`. `pickupAfterDig` already does this; still often logs `pickup timeout` with inv=0. Watch `STATUS.txt` sand/dirt counts, not just dig lines.
- Don't ask Glenn to break down tasks. Own the house.

## Ops for the next Steve session

1. Read this file, `STATUS.txt`, and the tail of `bot.log` before touching anything.
2. `ps -p <pid from STATUS.txt>` — if it is alive, **do not start another bot**.
3. Patch `play.js` / `index.js` on disk. The running Node process will **not** pick up `play.js` changes until a restart. That is OK. Wait until the process is actually dead, or accept that the hook/patch applies next natural start.
4. If you must start: `.bin/start-logged.sh` only. Never kill/restart for a tweak.
5. Chat mute stays. Only `"house up"`.
6. After death: wait, path back to Har0x, resume house. Do not rage-restart.

## Snapshot at time of this write (2026-08-14T14:01Z / 00:01 AEST 15 Aug)

- pid=166580, version=1.21.11, health=20, food=20, deaths=4, house=no, phase=gather.
- Position around `-7.50 98.92 7.50` (spawn-ish after death). Inventory empty (sand=0 sandstone=0 dirt=0) despite digging grass/dirt — pickup still failing.
- Last death #4: zombie while gathering, pos `23.87 102.42 17.70`. Flee-without-jump is not enough when a zombie is already on Steve.

## Runtime events (appended by play.js on death / respawn / kick-end / house-up)

Do not delete this heading. After the next process start, each event appends one JSON line to `rl/episodes.jsonl` and one line here. The process running now (pid 166580) will not see the patched `play.js` until it dies on its own.


## Keep-alive snapshot (2026-08-15 02:17 AM AEST)
- pid=166580 still connected, 1.21.11, pos ~7.38 102.54 9.39, health=20 food=20
- deaths=41 house=no phase=gather sand=0 dirt=0 sandstone=0 inv=0
- Still punching dirt/gravel from a spot with air/water underfoot; drops never enter inventory
- episodes.jsonl empty (logger is on disk; this process started before the hook)
- Glenn is asleep. Did not restart.

## Keep-alive snapshot (2026-08-15 04:11 AM AEST)
- pid=166580 still connected, pos ~6.31 101.98 12.70, health=20 food=15
- deaths=41 (unchanged) house=no sand=0 dirt=0 sandstone=0
- phase=build note=no non-gravity blocks for house (tried to build with empty inv)
- Still no episode logger on this process

## Keep-alive snapshot (2026-08-15 06:11 AM AEST)
- pid=166580 still connected, pos ~6.31 101.99 12.69
- health=10 food=0 deaths=41 house=no sand=0 dirt=0 sandstone=0 phase=gather
- Starving (no food in inv). Auto-eat cannot help. Did not restart.

## Keep-alive snapshot (2026-08-15 08:12 AM AEST)
- pid=166580 still connected, pos ~6.30 102.00 12.64
- health=10 food=0 deaths=41 house=no sand=0 dirt=0 sandstone=0 phase=gather
- Unchanged since morning recap. Did not restart. Did not ping.

## Keep-alive snapshot (2026-08-15 10:01 AM AEST)
- pid=166580 still connected, pos ~16.66 106.54 -9.39
- health=20 food=20 deaths=59 (was 41) house=no sand=0 dirt=0 sandstone=0 phase=gather
- Starvation likely caused the extra deaths; respawned full. Still no loot. Did not restart.
- [2026-08-15T01:06:45.625Z] episode death score=-15.21 sand=0 dirt=0 sandstone=0 house=no grief=0 47.9s pos=6.78 103.00 -0.45 deaths=1 score=-15.21
- [2026-08-15T01:06:45.918Z] episode respawn score=0.03 sand=0 dirt=0 sandstone=0 house=no grief=0 0.3s pos=6.78 103.00 -0.45 deaths=1 score=0.03
- [2026-08-15T01:07:07.670Z] episode death score=-17.82 sand=0 dirt=0 sandstone=0 house=no grief=0 21.8s pos=-13.70 98.00 12.95 deaths=2 score=-17.82
- [2026-08-15T01:07:07.967Z] episode respawn score=0.03 sand=0 dirt=0 sandstone=0 house=no grief=0 0.3s pos=-13.70 98.00 12.95 deaths=2 score=0.03

## Simple-get-one restart (2026-08-15 11:07 AM AEST / 01:07 UTC)
- Restarted ONCE. pid=480357 `node /home/box/minecraft-bot/.bin/start-ver.js`. mode=simple-get-one. Chat mute.
- Spawned at 9.50 114.00 -4.50 on oak_leaves (tree). findBlock threw `Cannot read properties of null (reading y)`. No sand/dirt in no-jump reach (ground is ~8 blocks down).
- Zombie flee walked him off the tree. Fall + zombie. Death #1 at 6.78 103.00 -0.45.
- After respawn, standing on grass at -5.50 99.00 7.50. DIG ONCE grass_block. Walked onto drop. **pickup fail sand=0 dirt=0**. playerCollect never fired.
- Likely causes: (1) spawn protection near 0,0 so broken blocks drop nothing; (2) mineflayer 1.21.11 inventory not seeing items; (3) digging under feet then walking off the drop.
- Did not restart again. Process left running.
- [2026-08-15T01:07:48.234Z] episode death score=-15.97 sand=0 dirt=0 sandstone=0 house=no grief=0 40.3s pos=15.70 98.00 36.54 deaths=3 score=-15.97
- [2026-08-15T01:07:48.519Z] episode respawn score=0.03 sand=0 dirt=0 sandstone=0 house=no grief=0 0.3s pos=15.70 98.00 36.54 deaths=3 score=0.03
- [2026-08-15T01:08:10.672Z] episode death score=-17.78 sand=0 dirt=0 sandstone=0 house=no grief=0 22.2s pos=-7.31 97.00 -8.37 deaths=4 score=-17.78
- [2026-08-15T01:08:10.876Z] episode respawn score=0.02 sand=0 dirt=0 sandstone=0 house=no grief=0 0.2s pos=-7.31 97.00 -8.37 deaths=4 score=0.02

## Spawn protection eats drops (2026-08-15 11:10 AM AEST / 01:10 UTC)
- Paper spawn protection (default 16 blocks around 0,0) likely deleted every drop. Overnight 93 deaths with 0 loot and the simple-get-one pickup fails at ~5,101,3 match this.
- Confirmed contrast: one dirt pickup DID work at 15.70 98.00 36.52 (r≈40, outside protection) then a zombie killed Steve and loot was lost. After respawn near 0,0, playerCollect never fired again.
- Rule: do not gather inside ~16–24 blocks of origin. Walk (no jump) to about x=28 or z=28 on solid ground (not water/air/leaves/planks), prefer sand underfoot, then one dig.
- simple-get-one now refuses to dig until horiz r>=24 and logs `left spawn r=N`.
- [2026-08-15T01:09:30.285Z] episode end score=7.94 sand=0 dirt=0 sandstone=0 house=no grief=0 79.4s pos=-2.24 96.94 2.50 deaths=4 score=7.94
- [2026-08-15T01:11:05.872Z] episode kick score=7.57 sand=0 dirt=0 sandstone=0 house=no grief=0 75.7s pos=-10.30 97.00 5.30 deaths=0 score=7.57
- [2026-08-15T01:11:42.671Z] episode end score=3.6 sand=0 dirt=0 sandstone=0 house=no grief=0 36s pos=-10.31 97.00 5.28 deaths=0 score=3.6

## Confirmed: gather outside spawn works (2026-08-15 11:12 AM AEST / 01:12 UTC)
- First leave-spawn walk (walkNoJump + cliffAhead, no sleep on refuse) busy-looped, flooded bot.log (~369MB), and the process was kicked at r=11.6. Do not busy-loop on cliff refuse; use pathfinder no-jump or sleep on fail.
- After a later start, Steve pathfind-walked to 24.53 103.00 24.50 (`left spawn r=34.7`), dug one grass_block, walked onto the drop. playerCollect fired. Inventory dirt=1. Holding at 25.68 102.00 24.64 r=35.6.
- Spawn protection near 0,0 ate drops; gathering outside ~16-24 blocks is required and now proven.
- Village/spawn-protect: hypot(x,z) from 0,0 < 28 is protected (digs drop nothing). simple-get-one must no-jump pathfind out to (32,y,0)/(0,y,32)/(24,y,24) and only dig at r>=24. Blind walkNoJump dies on village cliffs; GoalXZ pathfinder left spawn (r=34.7) and dirt pickup worked. Log `leaving spawn r=N -> target`. Never grief builds. Chat mute. No jump.

- [2026-08-15T01:17Z / 11:17 AEST] after first dirt, keep gathering outside spawn to 8, then hold.
- [2026-08-15T01:17:29.688Z] episode end score=35.33 sand=0 dirt=1 sandstone=0 house=no grief=0 343.3s pos=25.68 102.00 24.64 deaths=0 score=35.33

## Skill matrix loop (2026-08-15 11:17 AM AEST / 01:17 UTC)
- Live skill graph: `rl/matrix.json` (current=`p3-stack-8`). Cycle + pass criteria: `rl/LOOP.md`.
- Observe STATUS -> attempt current skill -> write episode to episodes.jsonl -> score -> update matrix (attempts++, pass/fail) -> stay or advance to next skill whose deps are done -> patch play.js for that skill only.
- Restart ONLY if the bot is dead or Glenn asked. One skill at a time. Did not restart.
- [2026-08-15T01:20:49.383Z] episode end score=28.45 sand=0 dirt=9 sandstone=0 house=no grief=0 194.5s pos=25.31 100.00 24.63 deaths=0 score=28.45
- [2026-08-15T01:22Z / 11:22 AEST] p4-food attempt 1: pid=514937 spawned 25.3 100 24.5 r=35 dirt=9 bar=19; no food/berries/mobs in 16m, micro-wander stuck, p4 not passed, left running.
- [2026-08-15T01:32:50.286Z] episode end score=80.58 sand=0 dirt=9 sandstone=0 house=no grief=0 715.8s pos=25.30 100.00 24.66 deaths=0 score=80.58

## p16-chat listener (2026-08-15 11:33 AM AEST / 01:33 UTC)
- Glenn asked if Steve monitors in-game chat. He did not. Added bot.on(chat/whisper/messagestr) in play.js.
- Logs every player line to rl/chat.jsonl {t,user,text}. Non-commands (esp. Har0x/Glenn or mention steve) also go to rl/chat-pending.jsonl for keep-alive/LLM.
- Local instant cmds (anyone): come/here path to speaker no-jump (enter spawn only if they are inside); follow; stop/stay stand still. Polls rl/command.json every 2s {action,x,y,z,text} then deletes it. say only if text short.
- hi/hey/hello (word match on disk; live process is exact+spawn) replies "hey" once per 20s. Spawn said hey. Har0x "oh hey" / "where are you?" logged. command.json said hey then here.
- Restarted ONCE via start-logged.sh. pid=540063 spawned 25.30 100.00 24.67 r=35.3 dirt=9 phase=food food_inv=0 bar=19 deaths=0. Food hunt kept. No house machine. No second restart.
- Disk parseLocalCmd now matches (hi|hey|hello) so "oh hey" will greet after next natural restart. Do not restart just for that.
- [2026-08-15T01:43:46.905Z] episode end score=74.39 sand=0 dirt=9 sandstone=0 house=no grief=0 653.9s pos=26.49 101.00 24.50 deaths=0 score=74.39

## Use collectblock, stop homemade dig (2026-08-15 11:44 AM AEST / 01:44 UTC)
- Glenn: stop reinventing walk+dig+pickup. mineflayer-collectblock was already installed and loaded in index.js (`bot.loadPlugin`).
- play.js gather / food / simple-dig now call `bot.collectBlock.collect(block|item)` (official collectblock.js pattern). Homemade `bot.dig` + walk-onto-drop removed from those paths.
- Still skip oak_planks / player builds. Still no collect/dig inside spawn r<24. Dirt kept. Chat hey/come/follow/stop kept.
- collectBlock.chestLocations=[] and itemFilter never-deposit so dirt is not dumped in a village chest. After collect(), restore no-jump movements.
- Restarted ONCE via start-logged.sh. pid=560984 spawned 26.49 101.00 24.50 r=36.1 dirt=9. Said hey once. collectBlock=ready.
- Watched ~45s: collect() was NOT called. dirt already >=8 so gather path idle; food hunt found no item/berry/mob in 14-16m, local wander stuck at 25.31 100.00 24.50 r=35.2 food_inv=0 bar=19 deaths=0. Left running. No second restart.
