# Steve skill library

What works on Glenn's world. These are play-loop rules, not a trained policy.

Server: Har0x / `45.248.51.231:25566` / Java 1.21.11. Bot is **Steve**. Goal: gather, craft sandstone, tiny house. Village nearby. Chat mute except `house up`.

## Walk then dig

- Walk within **4.5** (`DIG_REACH`) of the block, then dig. Never swing from farther away.
- One dig at a time (`digBusy`). Stop pathfinder and clear movement before `bot.dig`.

## Do not grief player builds

- Never dig `oak_planks` or other player builds (logs, doors, chests, stairs, slabs, signs, beds, glass, wool, terracotta, crafting table, furnace, torches).
- Skipping a plank is correct. Only count grief if a plank was actually dug.
- Drops under a plank pad fall through and never get picked up. If standing on forbidden floor, step onto sand/dirt first (`stepToAllowedFloor`).

## Flee without jumping

- Flee hostiles (zombie, husk, skeleton, creeper, spider, …) with no-jump walk. Jump-walk + high `maxDropDown` caused cliff deaths on dunes.
- After death: wait, path back to Har0x, resume house. Do **not** restart the Node process.

## Search from Steve, not Har0x

- `findBlock` / gather scan must use Steve's position. Searching from Har0x hid sand under Steve's feet.

## After dig, walk onto the drop

- Inventory pickup is flaky. After a successful dig, walk onto the item entity / `collectBlock`. Watch `STATUS.txt` sand/dirt counts, not just dig lines.

## Stay near Har0x

- If Steve is **>28m** from Har0x, walk back (no-jump) before gathering farther.

## Craft and house

- Craft sandstone from **4 sand** (`bot.craft`, no table).
- Tiny house: 5×5 footprint, 3-high walls, door gap at local `(2,0)` y 0–1, roof at y+3.
- Never place gravity blocks (sand / red_sand / gravel). Prefer sandstone; fallback dirt / grass_block / cobblestone.
- Site: near Har0x `offset(5, 0, 3)`, else Steve `offset(3, 0, 3)`.

## Overnight keep-alive 2026-08-15 2:16 AM AEST (low score)
- 41 deaths, 0 inventory, house not started. Failed loop.
- Do not gather while standing over air/water (`feet in=air under=air sides=...water`). Step onto solid sand/dirt first or skip the dig.
- Pickup still fails even when dig reach is OK (~4). Walking onto drops is not enough if they fall into a hole/water under a pad.
- Glenn AFK/asleep: do not path to a stale Har0x position into danger. Stay local and play safer.
- Episode logger not live until next natural process start.

## Overnight keep-alive 2026-08-15 4:11 AM AEST
- Deaths held at 41. Inventory still 0. Phase flipped to build then failed: no non-gravity blocks.
- Do not enter build phase with empty inventory. Stay in gather until sand>=8 or dirt>=16 actually in slots.

## Overnight keep-alive 2026-08-15 6:10 AM AEST
- Still 41 deaths, 0 loot. Health 10, food 0. Starvation is the next death unless food is found.
- Auto-eat is useless with empty inventory. Need to kill a cow/pig/chicken or pick berries before gathering all night.

## Keep-alive 2026-08-15 10:01 AM AEST
- Deaths 41 → 59 after food hit 0. Starvation confirmed. Respawned at full hunger.
- Still 0 inventory. Gather loop does not recover after death. Need food first, then sand on solid ground.
