import { plog, sleep, posOf, countSand, countNamed, inventorySummary, horizFromOrigin, stopPath, clearMove } from './lib.js'

export async function idleTick(bot, state) {
  const sand = countSand(bot)
  const dirt = countNamed(bot, ['dirt', 'grass_block'])
  const r = horizFromOrigin(bot)
  state.phase = 'idle'
  state.note = 'idle sand=' + sand + ' dirt=' + dirt + ' r=' + r.toFixed(1)
  plog('idle sand=' + sand + ' dirt=' + dirt + ' items=' + inventorySummary(bot) + ' pos=' + (posOf(bot) && posOf(bot).str))
  stopPath(bot)
  try { bot.setControlState('jump', false) } catch {}
  await clearMove(bot)
  if (bot.armorManager && typeof bot.armorManager.equipAll === 'function') {
    try { await bot.armorManager.equipAll() } catch {}
  }
  await sleep(800)
}

export async function run(bot, state) {
  return idleTick(bot, state)
}
