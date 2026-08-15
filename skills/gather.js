import { plog, sleep, posOf, bareName, countNamed, countLogs, countSand, inventorySummary, horizFromOrigin, isLogName, eachInventoryItem, resolveItemName, SPAWN_SAFE_R } from './lib.js'
import { leaveSpawnForGather, huntBlock, huntSand } from './collect.js'
import { punchTree } from './wood.js'
import { huntFood, countFood } from './food.js'
import { loadStorage, saveStorage } from './storage.js'
import { depositExtras } from './chest.js'

const DEFAULT_TARGETS = {
  dirt: 32,
  cobblestone: 16,
  logs: 8,
  food: 8,
  sand: 8,
  wheat_seeds: 16
}

const DIRT = ['dirt', 'grass_block']
const COBBLE = ['cobblestone', 'stone', 'cobble']
const SEEDS = ['wheat_seeds']

function targetsFromDisk() {
  const s = loadStorage()
  return Object.assign({}, DEFAULT_TARGETS, s.targets || {})
}

function haveOf(bot, key) {
  if (key === 'dirt') return countNamed(bot, DIRT)
  if (key === 'cobblestone' || key === 'cobble') return countNamed(bot, ['cobblestone'])
  if (key === 'logs') return countLogs(bot)
  if (key === 'food') return countFood(bot)
  if (key === 'sand') return countSand(bot)
  if (key === 'wheat_seeds') return countNamed(bot, SEEDS)
  return countNamed(bot, [bareName(key)])
}

export function missingTargets(bot) {
  const want = targetsFromDisk()
  const missing = {}
  for (const [k, n] of Object.entries(want)) {
    const have = haveOf(bot, k)
    if (have < n) missing[k] = n - have
  }
  return missing
}

function persistMissing(bot, extra) {
  const s = loadStorage()
  s.targets = targetsFromDisk()
  s.missing = Object.assign({}, missingTargets(bot), extra || {})
  return saveStorage(s)
}

async function collectOne(bot, state, key) {
  if (key === 'dirt') return huntBlock(bot, state, 'dirt')
  if (key === 'cobblestone' || key === 'cobble' || key === 'stone') return huntBlock(bot, state, 'stone')
  if (key === 'logs' || key === 'wood' || isLogName(key)) return punchTree(bot, state)
  if (key === 'food') return huntFood(bot, state)
  if (key === 'sand') return huntSand(bot, state)
  if (key === 'wheat_seeds' || key === 'seeds') {
    try { return await huntBlock(bot, state, 'short_grass') } catch {}
    return huntBlock(bot, state, 'tall_grass')
  }
  return huntBlock(bot, state, key)
}

export async function runGather(bot, state) {
  state.phase = 'gather'
  if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
    await leaveSpawnForGather(bot, state)
    if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
      plog('gather refuse spawn')
      return false
    }
  }
  const named = bareName(state.gatherName || '')
  const wantCount = Math.max(1, Number(state.gatherCount) || 0)
  if (named) {
    const goal = wantCount || 8
    state.note = 'gather ' + named + ' ' + goal
    plog(state.note + ' pos=' + (posOf(bot) && posOf(bot).str))
    for (let i = 0; i < 10 && !state.dead; i++) {
      if (state.chatMode && state.chatMode !== 'gather' && state.chatMode !== 'collect') break
      if (haveOf(bot, named) >= goal) break
      await collectOne(bot, state, named)
      await sleep(200)
    }
    persistMissing(bot)
    try { await depositExtras(bot, state) } catch {}
    state.note = 'gather ' + named + '=' + haveOf(bot, named) + ' inv=' + inventorySummary(bot)
    plog(state.note)
    return haveOf(bot, named) >= goal
  }

  const missing = missingTargets(bot)
  persistMissing(bot)
  const keys = Object.keys(missing)
  if (!keys.length) {
    state.note = 'gather stock full'
    plog(state.note + ' inv=' + inventorySummary(bot))
    try { await depositExtras(bot, state) } catch {}
    return true
  }
  const key = keys[0]
  state.note = 'gather missing ' + key + '=' + missing[key]
  plog(state.note + ' pos=' + (posOf(bot) && posOf(bot).str))
  for (let i = 0; i < 8 && !state.dead; i++) {
    if (state.chatMode && state.chatMode !== 'gather' && state.chatMode !== 'collect') break
    if (!missingTargets(bot)[key]) break
    await collectOne(bot, state, key)
    await sleep(200)
  }
  persistMissing(bot)
  try { await depositExtras(bot, state) } catch (err) {
    plog('gather deposit skip ' + (err && err.message))
  }
  state.note = 'gather inv=' + inventorySummary(bot)
  plog(state.note + ' missing=' + JSON.stringify(missingTargets(bot)))
  return Object.keys(missingTargets(bot)).length === 0
}

export async function run(bot, state) {
  return runGather(bot, state)
}
