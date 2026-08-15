# Steve advanced architecture

Rethink: stop homemade loops. Plugins do the body. A state machine does the hands. A skill library + this chat do the brain. End state: wander, build, fight, talk, and play with Har0x and other Mineflayer bots.

## Layers

1. Body (Mineflayer plugins). Never reimplement these.
   - HAVE: mineflayer, pathfinder, collectblock, auto-eat, pvp, tool, armor-manager, statemachine
   - ADD NEXT: schematic/builder (real houses), bloodhound (who hit me), prismarine-viewer optional
2. Hands: statemachine nested states (idle, follow, collect, eat, flee, fight, craft, place, talk, hold).
   Transitions, not a 1500-line tick().
3. Skills: named actions like Mindcraft (`!collect sand 8`, `!follow Har0x`, `!craft sandstone`, `!come`, `!stop`).
   Each skill is a small file that calls plugins. Matrix scores them. Keep winners.
4. Brain: this chat + keep-alive. Picks current matrix skill, writes/patches a skill file, talks in game.
   Do not train PPO. Voyager-style: try, score, keep code.
5. Social: in-game chat in and out. Local commands instant. Longer talk via chat-pending + command.json.
   Later: same !commands so other Grok/Mineflayer bots can ask Steve for help.
6. Memory: STATUS.txt, LEARNINGS.md, rl/matrix.json, rl/episodes.jsonl, rl/skills/, rl/chat.jsonl
7. Ops: stay outside spawn r>=24 to gather. Restart only if dead or a new plugin must load. Chat talks like a person, no coord spam.

## Hard rules we already paid for

- Paper spawn protect eats drops near 0,0. Gather/place outside ~24.
- Do not grief player builds.
- One skill at a time on the matrix until free play.
- collectBlock.collect(target) for gather. No homemade walk+dig+pickup.

## Build order

P0 done: collectblock for gather. Chat kept. Matrix kept.
P1 done (2026-08-15): tool, armor-manager, statemachine loaded. skills/ escape collect follow idle.
    No auto-follow. collectBlock gather r>=24.
P2 done (2026-08-15): nested BotStateMachine (idle, escape, follow, collect, flee).
    !come !follow !stop !stay !collect [block] !hungry (bang optional; over here=come).
    Talk short, no coord spam, no plank grief, spawn r>=24. No auto-follow Har0x.
P3 done (2026-08-15): skills/food.js wood.js craft.js place.js. SM states wood/craft/place.
    !craft [item] !wood !place !table !shovel !pick. Matrix climb p5-sand + p12-wood; do not skip hut.
P4: schematic/builder for the hut and bigger builds.
P5: other-bot protocol (chat !commands, share coords, don't grief each other).
P6: free play. Brain only sets goals. Hands run forever.

## What we are not doing

- Not cloning Voyager/Mindcraft wholesale (wrong version, their LLM keys, LAN assumptions).
- Not neural RL on this box.
- Not another 2000-line play.js.

## Iterate loop

Keep-alive every 2 hours runs `ITERATE.md`: fail -> gh issue on grokbot-mineflayer -> patch play.js -> restart start-logged.sh once -> watch STATUS -> comment issue -> close on pass -> next matrix skill. Actions CI is only syntax / matrix graph / scoreEpisode.
