# Steve iterate loop

fail -> gh issue on grokbot-mineflayer -> patch play.js -> restart start-logged.sh once -> watch STATUS -> comment issue -> close on pass -> next matrix skill.

Keep-alive runs this every 2 hours. Actions CI is only syntax / matrix graph / scoreEpisode. CI never starts Steve and never talks to the server.

## Cycle (one skill)

1. **Read.** `STATUS.txt`, `matrix.json` `current`, tail of `bot.log` and `episodes.jsonl`. Pass criteria live in `LOOP.md`.
2. **Fail -> issue.** If the current skill is stuck or failed, file **one** open GitHub issue on `gmcclelland90/grokbot-mineflayer` for that skill. Title `pN-name: short fail`. Body: pos, r, inv, food bar, phase, what never fired, what to try. Do not open a second issue for the same skill.
3. **Patch.** Change `play.js` for the current skill only. Do not rewrite the whole brain.
4. **Restart once.** `.bin/start-logged.sh` **once** so the new `play.js` loads. Then stop restarting in this keep-alive unless the process is dead.
5. **Watch STATUS.** pid, position, r, phase, dirt/sand/food_inv, deaths. Confirm the intended action (`collect()`, roam, eat) actually fires.
6. **Comment the issue** with the patch, the restart, and what STATUS showed.
7. **Close on pass.** When `LOOP.md` criteria are met: mark the skill `done` in `matrix.json`, comment the evidence, close the issue, set `current` to the next skill whose deps are all `done`.
8. **Next matrix skill.** Repeat from step 1. One skill at a time.

## Restart rule

This loop **does** restart `start-logged.sh` once after a skill patch (Node will not pick up `play.js` otherwise). That is the only planned restart. Do not leave/rejoin spam. If the process is already running the new code, leave it.

## What keep-alive does vs Actions

| | keep-alive (every 2h) | Actions CI |
| --- | --- | --- |
| syntax `play.js` `index.js` `score.js` | optional local | yes |
| validate `matrix.json` graph | yes after edits | yes (`rl/ci-matrix.mjs`) |
| `scoreEpisode` unit tests | optional local | yes (`rl/ci-score.mjs`) |
| file / comment / close GitHub issues | **yes** | no |
| patch `play.js` | **yes** | no |
| restart Steve | **once** after a patch | **never** |
| watch live `STATUS.txt` | **yes** | no |
| advance `matrix.json` current | **yes** on pass | no |

## Hard rules

- Stay outside spawn (`r>=24`) for gather / place. Paper spawn protect eats drops.
- Do not grief player builds.
- `collectBlock.collect(target)` for gather. No homemade walk+dig+pickup.
- Chat like a person. No coord spam.
- Do not train PPO. Voyager-style: try, score, keep code.

## Current

See `matrix.json`. Live graph + pass criteria: `LOOP.md`. Architecture: `ADVANCED_PLAN.md`.
