# Spawn camp

Paper spawn protect near 0,0 deletes drops and blocks building. Camp MUST stay at r>=24.

## Origins (fixed)

- **Camp palisade** `schematics/camp.json` (also `.schem`): **(32, surface, 0)** — r=32, due east of spawn. 7×7 footprint, 2-high dirt/cobble wall, door hole on the west wall at local (0, *, 3), facing spawn. 46 wall blocks. Open-top (no roof) so we can start with ~46 dirt.
- **Wheat farm** `schematics/wheat.json`: **(40, surface, 0)** — r=40, just east of the camp. 5×5 dirt pad, center cell left air for water. 24 blocks. Farmer tills + sows after place.
- **Tree nursery** `schematics/trees.json`: **(32, surface, 8)** — r≈33, south of camp. 6 dirt spots on a 7×4 pad, 2-block gaps so oak can grow.

Runtime Y is the first solid-with-air-above at that XZ (near-spawn surface has been ~97). Do not build any of these inside r<24.

## Commands

- `!camp` — gather wall blocks if low, place the palisade, torch corners if we have light, then guard this origin.
- `!farm` — tend existing plots (harvest / replant / deposit).
- `!farm wheat` / `!build wheat` — place wheat schematic at (40, surface, 0) then tend.
- `!farm trees` / `!build trees` — place tree dirt spots then plant saplings.
- `!guard` — once the camp exists, default stand is the camp origin. Still flee creepers.

## Guard / storage

After the palisade is up, `state.guardPos` and `rl/storage.json` `camp` point here. Extra crops go to a nearby chest if one exists (`rl/storage.json` `chests`).
