# Spawn camp

Paper spawn protect near 0,0 deletes drops and blocks building. Camp MUST stay at r>=24.

## Origins

Default first pin was **(32, surface, 0)** — that is only `r>=24` due east of spawn protect, **not a grove**. The +X hill is grass, no trees in 48m. Do not keep building the dump there forever.

**Repin rule:** if a worker finds trees at `r>=24`, move camp origin to a flat-ish spot next to that grove (still `r>=24`). Prefer "near wood + outside protect" over the original +X axis. Write `rl/storage.json` `camp` and this file. Wheat/trees schematics stay relative to the new origin (trees south +8, wheat east +8).

- **Camp palisade** `schematics/camp.json` (also `.schem`): current pin in `rl/storage.json` `camp` (started 32,surface,0). 7×7 footprint, 2-high dirt/cobble wall, door hole on the west wall at local (0, *, 3), facing spawn. 46 wall blocks. Open-top (no roof) so we can start with ~46 dirt.
- **Wheat farm** `schematics/wheat.json`: east of camp (default 40,surface,0). 5×5 dirt pad, center cell left air for water. 24 blocks. Farmer tills + sows after place.
- **Tree nursery** `schematics/trees.json`: south of camp (default 32,surface,8). 6 dirt spots on a 7×4 pad, 2-block gaps so oak can grow.
- Stub foothold ~14,108,-23 is a reachable dirt pad when 32,0 is blocked. It is **not** the colony origin.

Runtime Y is the first solid-with-air-above at that XZ (near-spawn surface has been ~97–108 on the east hill). Do not build any of these inside r<24.

## Commands

- `!camp` — gather wall blocks if low, place the palisade, torch corners if we have light, then guard this origin.
- `!farm` — tend existing plots (harvest / replant / deposit).
- `!farm wheat` / `!build wheat` — place wheat schematic at (40, surface, 0) then tend.
- `!farm trees` / `!build trees` — place tree dirt spots then plant saplings.
- `!guard` — once the camp exists, default stand is the camp origin. Still flee creepers.

## Guard / storage

After the palisade is up, `state.guardPos` and `rl/storage.json` `camp` point here. Extra crops go to a nearby chest if one exists (`rl/storage.json` `chests`).

## Dump chests (organized, not one junk box)

Row just north of the palisade (camp 32,surface,0 + offsets). All r>=24.

| role    | local | items              |
|---------|-------|--------------------|
| terrain | +1,-1 | dirt / sand        |
| stone   | +3,-1 | cobble / stone     |
| wood    | +5,-1 | logs / planks      |
| food    | +7,-1 | food / seeds       |
| misc    | +9,-1 | overflow           |

`rl/storage.json` chests are `{x,y,z,role,items,lastSeen}`. Official `skills/chest.js` deposits extras to the matching role and withdraws from it when building. `!dump` / job `place-dump` crafts wood→planks→chest and places missing slots. Sign labels optional; role on disk is enough. Workers keep a small working stack (see KEEP in storage.js) and dump the rest after gather.
