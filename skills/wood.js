import { plog, sleep, posOf, bareName, countLogs, countPlanks, countNamed, inventorySummary, horizFromOrigin, isLogName, looksLikeTree, isPlayerBuilt, stopPath, sayAllowed, SPAWN_SAFE_R, SAND_SCAN_R } from './lib.js'
import { collectViaPlugin, leaveSpawnForGather, exploreNewDir } from './collect.js'
import { craftPlanks, craftTableItem } from './craft.js'

function isTreeLog(bot, b) {
  if (!b || !b.name) return false
  if (!isLogName(b.name)) return false
  if (bareName(b.name).includes('planks')) return false
  if (isPlayerBuilt(b)) return false
  if (b.position && Math.hypot(b.position.x, b.position.z) < SPAWN_SAFE_R) return false
  return looksLikeTree(bot, b)
}

export function findLog(bot, maxDistance = SAND_SCAN_R) {
  const here = bot.entity && bot.entity.position
  if (!here) return null
  try {
    const block = bot.findBlock({ matching: (b) => isTreeLog(bot, b), maxDistance, point: here })
    if (block) return block
  } catch (err) {
    plog('findBlock log fail ' + (err && err.message))
  }
  return null
}

export async function punchTree(bot, state) {
  const r = horizFromOrigin(bot)
  if (r < SPAWN_SAFE_R) {
    await leaveSpawnForGather(bot, state)
    if (horizFromOrigin(bot) < SPAWN_SAFE_R) return false
  }
  const block = findLog(bot, SAND_SCAN_R)
  if (!block) {
    plog('wood no tree in ' + SAND_SCAN_R + ' pos=' + (posOf(bot) && posOf(bot).str))
    await exploreNewDir(bot, state)
    return false
  }
  plog('wood target ' + block.name + ' at ' + block.position.x + ' ' + block.position.y + ' ' + block.position.z)
  const before = countLogs(bot)
  await collectViaPlugin(bot, block, 'p12-wood', 18000, { allowLog: true })
  const after = countLogs(bot)
  if (after > before) {
    plog('wood PICKUP logs=' + after + ' items=' + inventorySummary(bot))
    state.note = 'PICKUP logs=' + after
    return true
  }
  return after > 0
}

export async function gatherWood(bot, state) {
  state.phase = 'wood'
  const logs = countLogs(bot)
  const planks = countPlanks(bot)
  const table = countNamed(bot, ['crafting_table'])
  state.note = 'wood logs=' + logs + ' planks=' + planks + ' table=' + table + ' r=' + horizFromOrigin(bot).toFixed(1)
  plog(state.note + ' items=' + inventorySummary(bot))

  if (table >= 1 && planks >= 4) {
    plog('wood done table+planks')
    return true
  }
  if (planks >= 4 && table < 1) {
    const made = await craftTableItem(bot, state)
    if (made) return true
  }
  if (logs >= 1 && planks < 4) {
    await craftPlanks(bot, state)
    if (countPlanks(bot) >= 4) {
      await craftTableItem(bot, state)
      return countNamed(bot, ['crafting_table']) >= 1 || countPlanks(bot) >= 4
    }
  }
  const got = await punchTree(bot, state)
  if (got && countLogs(bot) >= 1) {
    await craftPlanks(bot, state)
    if (countPlanks(bot) >= 4) await craftTableItem(bot, state)
  }
  return countNamed(bot, ['crafting_table']) >= 1
}

export async function run(bot, state) {
  return gatherWood(bot, state)
}
