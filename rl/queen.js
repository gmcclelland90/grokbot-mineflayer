// Queen = chat + keep-alive planner. NOT an in-game Mineflayer body.
// Do not spawn a Queen player. Workers claim jobs from rl/jobs.json.
// Queen (us) adds jobs when matrix / camp / storage says something is missing.
// Workers may only seed forage jobs (stock / farm / guard) if the board is empty.

export const QUEEN = 'chat+keepalive'

export function queenMeta(workers) {
  return {
    queen: QUEEN,
    workers: workers && workers.length ? workers : ['Steve']
  }
}
