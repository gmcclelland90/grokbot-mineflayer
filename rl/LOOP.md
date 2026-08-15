# Steve skill loop

Observe STATUS.txt -> attempt the current skill in matrix.json -> write one episode to episodes.jsonl -> score with score.js -> update matrix.json (attempts++, last_score, pass if criteria met) -> if pass, set current to the next skill whose deps are all done -> patch play.js on disk for that new skill only -> restart ONLY if the bot is dead or Glenn asked. One skill at a time.

1. Read STATUS.txt, matrix.json `current`, and the tail of episodes.jsonl.
2. Attempt only the current skill. Do not skip ahead or rewrite the whole brain.
3. On episode end, append one JSON line to episodes.jsonl and score it.
4. Bump `attempts` on the current skill; set `last_score`; mark pass or fail in `note`.
5. Pass: set status=done, then current = first skill whose deps are all done and status is todo.
6. Fail: stay on current; write why; try again next keep-alive.
7. Patch play.js on disk for the new/current skill only.
8. Never restart Steve for a tweak. Restart only if the process is dead or Glenn asked.
9. Chat mute except house up. Stay outside spawn (r>=24) for gather/place.
10. Keep-alive and Steve both update matrix.json. This file is the cycle contract.

## Pass criteria

- p1-leave-spawn: horiz r>=24 from 0,0 (done: r=35)
- p2-hold-one: dirt+sand >= 1 in inventory (done: 1 dirt)
- p3-stack-8: sand+dirt >= 8 and deaths this attempt < 5
- p4-food: food item in inv or food bar increased after eat
- p5-sand: sand >= 1
- p6-sandstone: sandstone >= 1
- p7-place-one: house_blocks >= 1 or a place log
- p8-wall: house_blocks >= 3 or a 3-block wall place log
- p9-hut: house=yes or 4 walls + door hole + non-gravity roof
- p10-follow: walked near Har0x without a fall death this attempt
- p11-flee: fled a hostile and lived (no death this attempt after flee)
- p12-wood: log + plank + crafting table in inv or placed
- p13-shovel: wooden shovel or pick in inv
- p14-play: p9+p4+p11+p13 done and still alive / self-sufficient
