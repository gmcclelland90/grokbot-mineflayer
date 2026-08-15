import { plog, sleep, posOf, countSand, countNamed, inventorySummary, horizFromOrigin, stopPath, clearMove } from './lib.js'
import { funTick } from './fun.js'
import { lookAtNearest } from './look.js'

export async function idleTick(bot, state) {
  if (state.chatMode === 'stay') {
    const sand = countSand(bot)
    const dirt = countNamed(bot, ['dirt', 'grass_block'])
    const r = horizFromOrigin(bot)
    state.phase = 'idle'
    state.smState = 'idle'
    state.note = 'stay sand=' + sand + ' dirt=' + dirt + ' r=' + r.toFixed(1)
    plog('stay still sand=' + sand + ' dirt=' + dirt + ' items=' + inventorySummary(bot) + ' pos=' + (posOf(bot) && posOf(bot).str))
    stopPath(bot)
    try { bot.setControlState('jump', false) } catch {}
    await clearMove(bot)
    lookAtNearest(bot)
    if (bot.armorManager && typeof bot.armorManager.equipAll === 'function') {
      try { await bot.armorManager.equipAll() } catch {}
    }
    await sleep(800)
    return
  }
  if (state.chatMode) {
    await sleep(300)
    return
  }
  lookAtNearest(bot)
  return funTick(bot, state)
}

export async function run(bot, state) {
  return idleTick(bot, state)
}
