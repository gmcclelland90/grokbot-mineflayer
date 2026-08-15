import { createRequire } from 'module'
import { plog, sleep, bareName, countNamed, countSand, countLogs, countPlanks, inventorySummary, findItemByNames, isLogName, isPlankName, resolveItemName, eachInventoryItem, gotoNear, horizFromOrigin, SPAWN_SAFE_R } from './lib.js'
import { leaveSpawnForGather } from './collect.js'
import { placeNamed } from './place.js'

const require = createRequire(import.meta.url)

const ALIASES = {
  sandstone: 'sandstone',
  sand_stone: 'sandstone',
  planks: 'oak_planks',
  plank: 'oak_planks',
  oak_planks: 'oak_planks',
  table: 'crafting_table',
  crafting_table: 'crafting_table',
  workbench: 'crafting_table',
  stick: 'stick',
  sticks: 'stick',
  shovel: 'wooden_shovel',
  wooden_shovel: 'wooden_shovel',
  pick: 'wooden_pickaxe',
  pickaxe: 'wooden_pickaxe',
  wooden_pick: 'wooden_pickaxe',
  wooden_pickaxe: 'wooden_pickaxe',
  hoe: 'wooden_hoe',
  wooden_hoe: 'wooden_hoe'
}

export function resolveCraftName(name) {
  const n = bareName(name)
  if (!n) return 'sandstone'
  if (ALIASES[n]) return ALIASES[n]
  return n
}

export function itemId(bot, name) {
  const n = resolveCraftName(name)
  try {
    const rec = bot.registry && bot.registry.itemsByName && bot.registry.itemsByName[n]
    if (rec && rec.id != null) return rec.id
  } catch {}
  return null
}

function shapelessRecipe(bot, ingredientId, resultId, resultCount) {
  const Recipe = require('prismarine-recipe')(bot.registry).Recipe
  return new Recipe({
    ingredients: [ingredientId],
    result: { id: resultId, count: resultCount || 1 }
  })
}

export function findCraftingTable(bot, maxDistance = 64) {
  const here = bot.entity && bot.entity.position
  if (!here) return null
  try {
    return bot.findBlock({
      matching: (b) => bareName(b && b.name) === 'crafting_table',
      maxDistance,
      point: here
    }) || null
  } catch {
    return null
  }
}

function plankNameForLog(logName) {
  let n = bareName(logName).replace(/^stripped_/, '')
  if (n.endsWith('_log')) return n.replace(/_log$/, '_planks')
  if (n.endsWith('_stem')) return n.replace(/_stem$/, '_planks')
  if (n.endsWith('_wood')) return n.replace(/_wood$/, '_planks')
  return 'oak_planks'
}

function firstLogName(bot) {
  let found = ''
  eachInventoryItem(bot, (it) => {
    if (found) return
    const n = resolveItemName(bot, it)
    if (isLogName(n)) found = n
  })
  return found
}

function firstPlankName(bot) {
  let found = ''
  eachInventoryItem(bot, (it) => {
    if (found) return
    const n = resolveItemName(bot, it)
    if (isPlankName(n)) found = n
  })
  return found
}

export function recipesForName(bot, name, table) {
  const id = itemId(bot, name)
  if (id == null) return []
  try {
    const have = bot.recipesFor(id, null, 1, table || null) || []
    if (have.length) return have
  } catch {}
  try {
    return bot.recipesAll(id, null, table || null) || []
  } catch {
    return []
  }
}

async function ensureOutsideSpawn(bot, state) {
  if (horizFromOrigin(bot) >= SPAWN_SAFE_R) return true
  await leaveSpawnForGather(bot, state)
  return horizFromOrigin(bot) >= SPAWN_SAFE_R
}

async function ensureTableBlock(bot, state) {
  let table = findCraftingTable(bot, 16)
  if (table) return table
  if (countNamed(bot, ['crafting_table']) < 1) {
    const made = await craftByName(bot, state, 'crafting_table', 1)
    if (!made) return null
  }
  const placed = await placeNamed(bot, state, 'crafting_table')
  if (!placed) {
    plog('craft no table placed')
    return null
  }
  await sleep(300)
  table = findCraftingTable(bot, 8)
  return table
}

export async function craftByName(bot, state, name, count = 1) {
  const want = resolveCraftName(name)
  const n = Math.max(1, Number(count) || 1)
  plog('craft try ' + want + ' x' + n + ' inv=' + inventorySummary(bot))

  if (want === 'oak_planks' || isPlankName(want)) {
    const log = firstLogName(bot)
    if (log) {
      const plank = plankNameForLog(log)
      return craftRaw(bot, state, plank, n, null)
    }
  }

  if (want === 'chest') {
    let table = findCraftingTable(bot, 64)
    if (!table) {
      // Keep a log in reserve: 2 stripped logs = table (4 planks) + 4 planks left, then one more log for the chest.
      if (countNamed(bot, ['crafting_table']) < 1 && countPlanks(bot) < 4 && countLogs(bot) >= 1) {
        const log = firstLogName(bot)
        const plank = plankNameForLog(log)
        try { await craftRaw(bot, state, plank, 1, null) } catch {}
      }
      table = await ensureTableBlock(bot, state)
    }
    if (countPlanks(bot) < 8 && countLogs(bot) >= 1) {
      try { await craftPlanks(bot, state) } catch {}
    }
    if (!table) table = findCraftingTable(bot, 64)
    if (!table || countPlanks(bot) < 8) {
      plog('craft chest need table + 8 planks inv=' + inventorySummary(bot))
      return false
    }
    try { await gotoNear(bot, table.position.x, table.position.y, table.position.z, 2, 8000) } catch {}
    return craftRaw(bot, state, 'chest', n, table)
  }

  let table = null
  let recs = recipesForName(bot, want, null)
  if (!recs.length) {
    table = findCraftingTable(bot, 64)
    if (!table) table = await ensureTableBlock(bot, state)
    if (table) {
      try { await gotoNear(bot, table.position.x, table.position.y, table.position.z, 2, 8000) } catch {}
      recs = recipesForName(bot, want, table)
    }
  }
  if (!recs.length) {
    plog('craft no recipe ' + want + ' (need ingredients or table)')
    return false
  }
  return craftRaw(bot, state, want, n, table)
}

async function craftRaw(bot, state, name, count, table) {
  const id = itemId(bot, name)
  if (id == null) {
    plog('craft no id ' + name)
    return false
  }
  let recs = []
  try { recs = bot.recipesFor(id, null, 1, table || null) || [] } catch {}
  // 1.21 minecraft-data only lists oak_log→oak_planks. Stripped logs/wood also craft in vanilla.
  if (!recs.length && isPlankName(name)) {
    const log = firstLogName(bot)
    const logId = log ? itemId(bot, log) : null
    if (logId != null) {
      recs = [shapelessRecipe(bot, logId, id, 4)]
      plog('craft synth ' + name + ' from ' + log)
    }
  }
  const rec = recs[0]
  if (!rec) {
    plog('craft recipesFor empty ' + name)
    return false
  }
  try {
    plog('craft ' + name + ' x' + count + (table ? ' at table' : ' inv'))
    await bot.craft(rec, count, table || null)
    await sleep(300)
    plog('crafted ' + name + ' inv=' + inventorySummary(bot))
    return true
  } catch (err) {
    plog('craft fail ' + name + ' ' + (err && err.message))
    try {
      const rec1 = (bot.recipesFor(id, null, 1, table || null) || [])[0]
      if (!rec1) return false
      await bot.craft(rec1, 1, table || null)
      await sleep(200)
      plog('crafted1 ' + name + ' inv=' + inventorySummary(bot))
      return true
    } catch (e) {
      plog('craft1 fail ' + name + ' ' + (e && e.message))
      return false
    }
  }
}

export async function craftPlanks(bot, state) {
  const logs = countLogs(bot)
  if (logs < 1) {
    plog('craft planks skip, logs=0')
    return false
  }
  const log = firstLogName(bot)
  const plank = plankNameForLog(log)
  return craftRaw(bot, state, plank, logs, null)
}

export async function craftSandstone(bot, state) {
  const sand = countSand(bot)
  const want = Math.floor(sand / 4)
  if (want < 1) {
    plog('craft sandstone skip, sand=' + sand)
    return false
  }
  return craftRaw(bot, state, 'sandstone', want, null)
}

export async function craftSticks(bot, state, count = 1) {
  if (countNamed(bot, ['stick']) >= count) return true
  if (countPlanks(bot) < 2) {
    if (countLogs(bot) >= 1) await craftPlanks(bot, state)
  }
  if (countPlanks(bot) < 2) {
    plog('craft sticks skip, planks=' + countPlanks(bot))
    return false
  }
  const need = Math.max(1, Math.ceil(count / 4))
  return craftRaw(bot, state, 'stick', need, null)
}

export async function craftTableItem(bot, state) {
  if (countNamed(bot, ['crafting_table']) >= 1) return true
  if (findCraftingTable(bot, 16)) return true
  if (countPlanks(bot) < 4) {
    if (countLogs(bot) >= 1) await craftPlanks(bot, state)
  }
  if (countPlanks(bot) < 4) {
    plog('craft table skip, planks=' + countPlanks(bot))
    return false
  }
  return craftRaw(bot, state, 'crafting_table', 1, null)
}

export async function craftWoodenTool(bot, state, kind) {
  const name = kind === 'shovel' ? 'wooden_shovel' : kind === 'hoe' ? 'wooden_hoe' : 'wooden_pickaxe'
  if (countNamed(bot, [name]) >= 1) {
    plog('craft have ' + name)
    return true
  }
  if (countPlanks(bot) < 3) {
    if (countLogs(bot) >= 1) await craftPlanks(bot, state)
  }
  const sticksNeed = 2
  await craftSticks(bot, state, sticksNeed)
  const table = await ensureTableBlock(bot, state)
  if (!table) {
    plog('craft ' + name + ' need table')
    return false
  }
  try { await gotoNear(bot, table.position.x, table.position.y, table.position.z, 2, 8000) } catch {}
  return craftRaw(bot, state, name, 1, table)
}

export async function runCraft(bot, state) {
  const mode = state.chatMode
  const item = resolveCraftName(state.craftItem || (mode === 'table' ? 'crafting_table' : mode === 'shovel' ? 'wooden_shovel' : mode === 'pick' ? 'wooden_pickaxe' : 'sandstone'))
  state.phase = 'craft'
  state.note = 'craft ' + item
  await ensureOutsideSpawn(bot, state)

  if (mode === 'table' || item === 'crafting_table') {
    const ok = await craftTableItem(bot, state)
    if (ok && !findCraftingTable(bot, 8) && countNamed(bot, ['crafting_table']) >= 1) {
      await placeNamed(bot, state, 'crafting_table')
    }
    return ok
  }
  if (mode === 'shovel' || item === 'wooden_shovel') return craftWoodenTool(bot, state, 'shovel')
  if (mode === 'pick' || item === 'wooden_pickaxe') return craftWoodenTool(bot, state, 'pick')
  if (mode === 'hoe' || item === 'wooden_hoe') return craftWoodenTool(bot, state, 'hoe')
  if (item === 'sandstone') return craftSandstone(bot, state)
  if (isPlankName(item) || item === 'oak_planks') return craftPlanks(bot, state)
  if (item === 'stick') return craftSticks(bot, state, 4)
  return craftByName(bot, state, item, 1)
}

export async function run(bot, state) {
  return runCraft(bot, state)
}
