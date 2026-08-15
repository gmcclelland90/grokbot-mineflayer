# rl/ — Voyager-style persist, not PPO

This folder is a **reinforcement-learning-style improvement loop** without training a neural net.

It is **not** PPO, GRPO, A2C, DQN, or any policy-gradient trainer. There is no reward model, no optimizer, no weights file. Mineflayer does not learn by itself.

It is the [Voyager](https://voyager.minedojo.org/) pattern: **LLM (or a human agent) + skill library + scored episode log**.

| file | role |
| --- | --- |
| `skills.md` | Skill library — what already works in this world |
| `episodes.jsonl` | One JSON object per episode end (append-only) |
| `score.js` | Cheap scalar so later sessions can prefer better traces |
| `../LEARNINGS.md` | Durable prose notes (also gets a one-liner per episode) |
| `../play.js` | Logger hooks (death, respawn, kick/end, house-up) |

## Episode line

Each `episodes.jsonl` line:

```json
{"t":"...","reason":"death|respawn|kick|end|house-up","pos":"...","deaths":0,"sand":0,"dirt":0,"sandstone":0,"house":false,"health":20,"food":20,"seconds":12.3,"score":1.23,"notes":"..."}
```

`score.js` computes:

`sand*2 + dirt + sandstone*4 + house_blocks*5 + (house?50:0) + seconds/10 - deaths*20 - grief_planks*10`

- `deaths` in the score is **this episode** (1 on a death line, else 0). The JSON `deaths` field is the session cumulative so it matches `STATUS.txt`.
- Skipping a plank is not grief. Digging one increments `grief_planks`.
- Extra fields (`house_blocks`, `grief_planks`) may appear; readers should ignore unknowns.

## How to use it next session

1. Read `../LEARNINGS.md`, `skills.md`, and the tail of `episodes.jsonl`.
2. Prefer skills and notes from high-score episodes. Avoid traces that grief or die on dunes.
3. Patch `play.js` on disk. Do **not** kill/restart Steve for a tweak — the running process loads this logger on the next natural start.

Chat stays muted except `house up`.
