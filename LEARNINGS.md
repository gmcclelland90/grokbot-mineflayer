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
- [2026-08-15T01:51:44.370Z] episode end score=56.35 sand=0 dirt=9 sandstone=0 house=no grief=0 473.5s pos=25.48 100.00 24.66 deaths=0 score=56.35
- [2026-08-15T01:56:05.763Z] episode end score=31.77 sand=0 dirt=6 sandstone=0 house=no grief=0 257.7s pos=14.50 103.94 11.50 deaths=0 score=31.77

## p4-food roam (2026-08-15 11:57 AM AEST / 01:57 UTC)
- Glenn: Steve has to get food. Issue #1 p4-food.
- Patched play.js: escapeHole first; do not lock chatMode=follow on spawn; come/stop still interrupt; follow is loose (GoalFollow range 8) while hunting; scan 32 for cow/pig/chicken/sheep, sweet_berry_bush, food item entities; kill one then collectBlock.collect drop; berries via collect(); if nothing in 16m path 20-30m new heading (refuse same 1x1); stay r>=24 unless Har0x inside spawn; say "hungry" once / "got food" on inv food. No plank grief.
- node --check OK. Restarted ONCE via .bin/start-logged.sh. pid=592491 left running.
- Spawned in hole at 14.50 102.94 11.50, pillar/jump escape, left_hole=yes, said hungry, phase=food.
- First explore moved to ~30.70 102.53 6.76 (r=31). Later explores often failed no-jump path (same tile) then nudged to 29.71 102.00 8.70.
- scan32: no drop/berry/mob. food_inv=0 bar=15 dirt=6 deaths=0. Did not move toward a mob (none in range). Har0x chat: "there's pigs over here".
- Did not close https://github.com/gmcclelland90/grokbot-mineflayer/issues/1 (food_inv=0).
- vision = entity packets + chat hints, not a camera.

## Keep-alive 2026-08-15 12:01 PM AEST
- p4-food PASSED: food_inv=2, following Har0x, pos ~-6.7 93 53.6, dirt=5, deaths=0, left_hole=yes
- Did not restart (Glenn is playing). Next skill p5-sand.
- [2026-08-15T02:17:07.442Z] episode end score=133.8 sand=0 dirt=8 sandstone=0 house=no grief=0 1258s pos=-3.92 91.00 53.31 deaths=0 score=133.8
- [2026-08-15T02:18:18.920Z] episode death score=-5.38 sand=0 dirt=8 sandstone=0 house=no grief=0 66.2s pos=-3.92 91.00 53.31 deaths=1 score=-5.38
- [2026-08-15T02:18:19.212Z] episode respawn score=0.03 sand=0 dirt=0 sandstone=0 house=no grief=0 0.3s pos=-3.92 91.00 53.31 deaths=1 score=0.03
- [2026-08-15T02:31:06.610Z] episode end score=76.74 sand=0 dirt=0 sandstone=0 house=no grief=0 767.4s pos=4.61 102.00 2.24 deaths=1 score=76.74
- [2026-08-15T02:36:09.481Z] episode end score=29.76 sand=0 dirt=0 sandstone=0 house=no grief=0 297.6s pos=4.61 101.94 2.30 deaths=0 score=29.76
- [2026-08-15T02:42:39.712Z] episode end score=38.4 sand=0 dirt=0 sandstone=0 house=no grief=0 384s pos=4.61 101.94 2.30 deaths=0 score=38.4
- [2026-08-15T02:45:29.963Z] episode end score=16.64 sand=0 dirt=0 sandstone=0 house=no grief=0 166.4s pos=4.61 101.94 2.30 deaths=0 score=16.64
- [2026-08-15T02:48:26.225Z] episode end score=22.34 sand=0 dirt=5 sandstone=0 house=no grief=0 173.4s pos=42.70 103.00 30.24 deaths=0 score=22.34
- [2026-08-15T02:55:13.910Z] episode end score=42.29 sand=0 dirt=2 sandstone=0 house=no grief=0 402.9s pos=81.70 118.00 79.32 deaths=0 score=42.29
- [2026-08-15T03:00:03.226Z] episode death score=8.32 sand=0 dirt=0 sandstone=0 house=no grief=0 283.2s pos=85.70 117.00 76.04 deaths=1 score=8.32
- [2026-08-15T03:00:03.518Z] episode respawn score=0.03 sand=0 dirt=0 sandstone=0 house=no grief=0 0.3s pos=85.70 117.00 76.04 deaths=1 score=0.03
- [2026-08-15T03:02:21.273Z] episode end score=13.78 sand=0 dirt=0 sandstone=0 house=no grief=0 137.8s pos=-20.50 99.19 -16.70 deaths=1 score=13.78
- [2026-08-15T03:05:21.682Z] episode death score=-2.53 sand=0 dirt=0 sandstone=0 house=no grief=0 174.7s pos=-13.54 97.00 9.69 deaths=1 score=-2.53
- [2026-08-15T03:05:21.972Z] episode respawn score=0.03 sand=0 dirt=0 sandstone=0 house=no grief=0 0.3s pos=-13.54 97.00 9.69 deaths=1 score=0.03
- [2026-08-15T03:06:54.431Z] episode death score=-10.75 sand=0 dirt=0 sandstone=0 house=no grief=0 92.5s pos=-13.72 98.00 7.70 deaths=2 score=-10.75
- [2026-08-15T03:06:54.722Z] episode respawn score=0.03 sand=0 dirt=0 sandstone=0 house=no grief=0 0.3s pos=-13.50 98.00 7.70 deaths=2 score=0.03
- [2026-08-15T03:11:17.995Z] episode end score=26.33 sand=0 dirt=0 sandstone=0 house=no grief=0 263.3s pos=10.33 114.00 -9.00 deaths=2 score=26.33
- [2026-08-15T03:16:21.151Z] episode end score=29.94 sand=0 dirt=0 sandstone=0 house=no grief=0 299.4s pos=10.15 114.00 -9.11 deaths=0 score=29.94
- [2026-08-15T03:17:54.225Z] episode end score=8.92 sand=0 dirt=0 sandstone=0 house=no grief=0 89.2s pos=10.15 114.00 -9.11 deaths=0 score=8.92
- [2026-08-15T03:18:39.282Z] episode end score=4.02 sand=0 dirt=0 sandstone=0 house=no grief=0 40.2s pos=10.15 114.00 -9.11 deaths=0 score=4.02
- [2026-08-15T03:19:47.272Z] episode end score=6.32 sand=0 dirt=0 sandstone=0 house=no grief=0 63.2s pos=14.73 107.00 -18.30 deaths=0 score=6.32
- [2026-08-15T03:20:32.307Z] episode end score=4.02 sand=0 dirt=0 sandstone=0 house=no grief=0 40.2s pos=13.67 107.00 -18.32 deaths=0 score=4.02
- [2026-08-15T03:25:26.239Z] episode end score=28.92 sand=0 dirt=0 sandstone=0 house=no grief=0 289.2s pos=13.67 107.00 -18.32 deaths=0 score=28.92
- [2026-08-15T03:30:34.756Z] episode end score=48.57 sand=0 dirt=18 sandstone=0 house=no grief=0 305.7s pos=16.67 104.00 -18.50 deaths=0 score=48.57
- [2026-08-15T03:40:27.585Z] episode end score=35.55 sand=0 dirt=25 sandstone=0 house=no grief=0 105.5s pos=16.31 105.00 -21.23 deaths=0 score=35.55
- [2026-08-15T03:41:47.665Z] episode end score=33.63 sand=0 dirt=26 sandstone=0 house=no grief=0 76.3s pos=16.31 105.00 -21.60 deaths=0 score=33.63
- [2026-08-15T03:47:06.251Z] episode kick score=119.38 sand=0 dirt=20 sandstone=0 house=no grief=0 43.8s pos=16.32 105.17 -20.38 deaths=0 score=119.38
- [2026-08-15T03:47:57.170Z] episode kick score=34.09 sand=0 dirt=18 sandstone=0 house=no grief=0 60.9s pos=12.73 109.10 -22.49 deaths=0 score=34.09
- [2026-08-15T04:01:18.565Z] episode end score=182.89 sand=0 dirt=0 sandstone=0 house=no grief=0 1828.9s pos=2.60 100.42 -5.30 deaths=0 score=182.89
- [2026-08-15T04:01:18.574Z] episode end score=181.39 sand=0 dirt=0 sandstone=0 house=no grief=0 1813.9s pos=0.96 99.00 -5.30 deaths=0 score=181.39
- [2026-08-15T04:01:18.574Z] episode end score=181.89 sand=0 dirt=0 sandstone=0 house=no grief=0 1818.9s pos=8.70 101.00 -1.41 deaths=0 score=181.89
- [2026-08-15T04:01:18.578Z] episode end score=182.39 sand=0 dirt=0 sandstone=0 house=no grief=0 1823.9s pos=8.70 101.00 -3.18 deaths=0 score=182.39
- [2026-08-15T04:01:18.591Z] episode end score=183.39 sand=0 dirt=0 sandstone=0 house=no grief=0 1833.9s pos=20.70 100.00 10.46 deaths=0 score=183.39
- [2026-08-15T04:02:25.637Z] episode end score=4.48 sand=0 dirt=0 sandstone=0 house=no grief=0 44.8s pos=9.49 103.25 -2.64 deaths=0 score=4.48
- [2026-08-15T04:03:37.478Z] episode kick score=25.2 sand=0 dirt=18 sandstone=0 house=no grief=0 72s pos=8.70 103.00 -5.28 deaths=0 score=25.2
- [2026-08-15T04:03:55.302Z] episode end score=12.95 sand=0 dirt=0 sandstone=0 house=no grief=0 129.5s pos=14.69 103.00 4.09 deaths=0 score=12.95
- [2026-08-15T04:03:55.352Z] episode end score=13.96 sand=0 dirt=0 sandstone=0 house=no grief=0 139.6s pos=-3.31 98.00 -1.29 deaths=0 score=13.96
- [2026-08-15T04:04:14.331Z] episode death score=-3.15 sand=0 dirt=0 sandstone=0 house=no grief=0 168.5s pos=30.70 101.00 9.50 deaths=1 score=-3.15
- [2026-08-15T04:04:14.612Z] episode respawn score=0.03 sand=0 dirt=0 sandstone=0 house=no grief=0 0.3s pos=30.70 101.00 9.50 deaths=1 score=0.03
- [2026-08-15T04:04:15.285Z] episode death score=-3.55 sand=0 dirt=0 sandstone=0 house=no grief=0 164.5s pos=32.54 101.00 11.67 deaths=1 score=-3.55
- [2026-08-15T04:04:15.498Z] episode respawn score=0.02 sand=0 dirt=0 sandstone=0 house=no grief=0 0.2s pos=32.54 101.00 11.67 deaths=1 score=0.02
- [2026-08-15T04:05:28.328Z] episode end score=7.37 sand=0 dirt=0 sandstone=0 house=no grief=0 73.7s pos=0.47 99.75 14.56 deaths=1 score=7.37
- [2026-08-15T04:05:28.328Z] episode end score=7.28 sand=0 dirt=0 sandstone=0 house=no grief=0 72.8s pos=22.59 103.94 5.36 deaths=1 score=7.28

## Dump without wood (2026-08-15 2:05 PM AEST)
- Steve froze at 12.50 108.96 -22.36 in phase=dump, dirt=18, house_blocks=3, chests=0, logs=0. Cannot craft a chest without wood and would not walk.
- Fix: need-chest-but-no-logs → gather wood via collectBlock logs (range 64+, r>=24). place-dump stays `wait` until logs>=2. Stuck detector: same pos ~20s → repath. Mute "on it"/"camp up". Workers always claim a job.
- [2026-08-15T04:06:19.185Z] episode death score=-15.69 sand=0 dirt=0 sandstone=0 house=no grief=0 43.1s pos=32.69 104.00 7.47 deaths=1 score=-15.69
- [2026-08-15T04:06:19.473Z] episode respawn score=0.03 sand=0 dirt=0 sandstone=0 house=no grief=0 0.3s pos=32.69 104.00 7.47 deaths=1 score=0.03
- [2026-08-15T04:07:38.525Z] episode kick score=32.05 sand=0 dirt=10 sandstone=0 house=no grief=0 220.5s pos=-15.58 99.10 25.94 deaths=0 score=32.05
