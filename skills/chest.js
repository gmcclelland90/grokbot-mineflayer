import { Vec3, plog, sleep, bareName, resolveItemName, eachInventoryItem, findItemByNames, gotoNear, horizFromOrigin, SPAWN_SAFE_R, countNamed, countLogs, countPlanks, inventorySummary } from './lib.js'
import { loadStorage, saveStorage, recordChest, findNearChest, findChestForRole, findChestForItem, extrasToDump, campOriginFromDisk, roleForItem, plannedDumpSlots, ROLES, DUMP_LABELS } from './storage.js'
import { punchTree } from './wood.js'
import { craftByName, craftPlanks } from './craft.js'
import { placeAt } from './place.js'
import { findGroundY } from './build.js'
import { withChestLock } from './cluster.js'
import { unstickIfNeeded } from './stuck.js'

// Official chest.js: bot.openContainer, containerItems(), deposit, withdraw
// https://raw.githubusercontent.com/PrismarineJS/mineflayer/master/examples/chest.js

const CHEST_NAMES = ['chest', 'ender_chest', 'trapped_chest', 'barrel']

function itemToBag(items) {
  const bag = {}
  for (const it of items || []) {
    if (!it) continue
    const n = bareName(it.name)
    if (!n) continue
    bag[n] = (bag[n] || 0) + (Number(it.count) || 0)
  }
  return bag
}

function itemByName(items, name) {
  const want = bareName(name)
  for (const it of items || []) {
    if (it && bareName(it.name) === want) return it
  }
  return null
}

export function findChestBlock(bot, origin, maxD = 12) {
  return findNearChest(bot, origin, maxD)
}

export async function openChest(bot, block) {
  if (!block) return null
  if (block.position && Math.hypot(block.position.x, block.position.z) < SPAWN_SAFE_R) {
    plog('chest skip spawn')
    return null
  }
  try { await gotoNear(bot, block.position.x, block.position.y, block.position.z, 2, 8000) } catch {}
  try {
    if (bot.openContainer) return await bot.openContainer(block)
    if (bot.openChest) return await bot.openChest(block)
  } catch (err) {
    plog('chest open fail ' + (err && err.message))
  }
  return null
}

export function catalogWindow(win) {
  try {
    if (win && typeof win.containerItems === 'function') return itemToBag(win.containerItems())
  } catch {}
  return {}
}

function persistChest(pos, items, role) {
  if (!pos) return loadStorage()
  const s = loadStorage()
  s.chests = s.chests || []
  const x = Math.floor(pos.x)
  const y = Math.floor(pos.y)
  const z = Math.floor(pos.z)
  let row = s.chests.find((c) => c.x === x && c.y === y && c.z === z)
  if (!row) {
    row = { x, y, z, role: role || null, items: {}, lastSeen: null }
    s.chests.push(row)
  }
  if (role) row.role = role
  if (!row.role) {
    const hit = plannedDumpSlots(s.camp).find((sl) => sl.x === x && sl.z === z)
    row.role = (hit && hit.role) || row.role || 'misc'
  }
  row.items = items || row.items || {}
  row.lastSeen = new Date().toISOString()
  return saveStorage(s)
}

export async function catalogNearby(bot, state) {
  const origin = (state && state.campOrigin) || campOriginFromDisk()
  const block = findChestBlock(bot, origin, 16)
  if (!block) {
    plog('chest none nearby')
    return null
  }
  return withChestLock(async () => {
    const win = await openChest(bot, block)
    if (!win) return null
    const items = catalogWindow(win)
    persistChest(block.position, items)
    try { win.close() } catch {}
    plog('chest catalog ' + JSON.stringify(items))
    return items
  })
}

export async function depositNamed(bot, state, name, count) {
  const item = findItemByNames(bot, [name])
  if (!item) {
    plog('chest deposit no ' + name)
    return false
  }
  const n = Math.max(1, Number(count) || Number(item.count) || 1)
  const origin = (state && state.campOrigin) || campOriginFromDisk()
  const block = findChestForItem(bot, name, origin, 24) || findChestBlock(bot, origin, 16)
  if (!block) return false
  return withChestLock(async () => {
    const win = await openChest(bot, block)
    if (!win) return false
    try {
      if (typeof win.deposit === 'function') await win.deposit(item.type, item.metadata == null ? null : item.metadata, n)
      const items = catalogWindow(win)
      persistChest(block.position, items)
      plog('chest deposited ' + n + ' ' + name)
      return true
    } catch (err) {
      plog('chest deposit fail ' + (err && err.message))
      return false
    } finally {
      try { win.close() } catch {}
    }
  })
}

export async function withdrawNamed(bot, state, name, count) {
  const n = Math.max(1, Number(count) || 1)
  const origin = (state && state.campOrigin) || campOriginFromDisk()
  const block = findChestForItem(bot, name, origin, 24) || findChestBlock(bot, origin, 16)
  if (!block) {
    plog('chest withdraw no chest')
    return false
  }
  return withChestLock(async () => {
    const win = await openChest(bot, block)
    if (!win) return false
    try {
      const items = (typeof win.containerItems === 'function') ? win.containerItems() : []
      const item = itemByName(items, name)
      if (!item) {
        plog('chest withdraw unknown ' + name)
        return false
      }
      if (typeof win.withdraw === 'function') await win.withdraw(item.type, null, n)
      persistChest(block.position, catalogWindow(win))
      plog('chest withdrew ' + n + ' ' + name)
      return true
    } catch (err) {
      plog('chest withdraw fail ' + (err && err.message))
      return false
    } finally {
      try { win.close() } catch {}
    }
  })
}

async function depositInto(bot, block, extras, role) {
  if (!block || !extras.length) return 0
  if (Math.hypot(block.position.x, block.position.z) < SPAWN_SAFE_R) {
    plog('chest skip spawn')
    return 0
  }
  recordChest(block.position, { role })
  return withChestLock(async () => {
    const win = await openChest(bot, block)
    if (!win) return 0
    let dumped = 0
    for (const ex of extras) {
      try {
        if (typeof win.deposit === 'function') {
          await win.deposit(ex.item.type, ex.item.metadata == null ? null : ex.item.metadata, ex.count)
          dumped += ex.count
        }
      } catch (err) {
        plog('chest deposit fail ' + ex.name + ' ' + (err && err.message))
      }
    }
    persistChest(block.position, catalogWindow(win), role)
    try { win.close() } catch {}
    plog('chest dumped=' + dumped + ' role=' + (role || 'any'))
    return dumped
  })
}

export async function depositExtras(bot, state) {
  const extras = extrasToDump(bot)
  if (!extras.length) return false
  const origin = (state && state.campOrigin) || campOriginFromDisk()
  const groups = {}
  for (const ex of extras) {
    const role = roleForItem(ex.name)
    ;(groups[role] = groups[role] || []).push(ex)
  }
  let dumped = 0
  for (const role of Object.keys(groups)) {
    const block = findChestForRole(bot, role, origin, 24) || findChestBlock(bot, origin, 16)
    if (!block) {
      plog('chest no ' + role + ' chest, keep extras n=' + groups[role].length)
      continue
    }
    dumped += (await depositInto(bot, block, groups[role], role)) || 0
  }
  return dumped > 0
}

function canCraftChest(bot) {
  return countNamed(bot, ['chest']) >= 1 || countPlanks(bot) >= 8 || countLogs(bot) >= 2
}

async function ensureChestItem(bot, state) {
  if (countNamed(bot, ['chest']) >= 1) return true
  if (!canCraftChest(bot)) {
    state.phase = 'wood'
    state.note = 'dump need chest but no logs — gather wood'
    plog(state.note + ' inv=' + inventorySummary(bot))
    try { await unstickIfNeeded(bot, state, 'dump-no-wood') } catch {}
    try { await punchTree(bot, state) } catch (err) { plog('dump wood fail ' + (err && err.message)) }
    return canCraftChest(bot) && countNamed(bot, ['chest']) >= 1
  }
  if (countPlanks(bot) < 8 && countLogs(bot) >= 1) {
    try { await craftPlanks(bot, state) } catch {}
  }
  if (countNamed(bot, ['chest']) < 1 && (countPlanks(bot) >= 8 || countLogs(bot) >= 2)) {
    try { await craftByName(bot, state, 'chest', 1) } catch {}
  }
  if (countNamed(bot, ['chest']) < 1) {
    // 2 logs = 8 planks = 1 chest, but a missing table spends 4 planks. Get one more log.
    plog('dump chest craft miss, extra wood inv=' + inventorySummary(bot))
    try { await punchTree(bot, state) } catch (err) { plog('dump extra wood fail ' + (err && err.message)) }
    if (countPlanks(bot) < 8 && countLogs(bot) >= 1) {
      try { await craftPlanks(bot, state) } catch {}
    }
    try { await craftByName(bot, state, 'chest', 1) } catch {}
  }
  return countNamed(bot, ['chest']) >= 1
}

async function maybeSign(bot, state, x, y, z, label) {
  if (countNamed(bot, ['oak_sign', 'spruce_sign', 'birch_sign', 'sign']) < 1) return false
  const item = findItemByNames(bot, ['oak_sign', 'spruce_sign', 'birch_sign', 'sign'])
  if (!item) return false
  try { if (typeof bot.equip === 'function') await bot.equip(item, 'hand') } catch {}
  const sx = x
  const sy = y
  const sz = z - 1
  if (Math.hypot(sx, sz) < SPAWN_SAFE_R) return false
  const res = await placeAt(bot, sx, sy, sz)
  if (res !== true && res !== 'exists') return false
  try {
    const block = bot.blockAt(new Vec3(sx, sy, sz))
    if (block && typeof bot.updateSign === 'function') {
      await bot.updateSign(block, String(label || '').slice(0, 15))
      plog('chest sign ' + label + ' at ' + sx + ' ' + sy + ' ' + sz)
      return true
    }
  } catch (err) {
    plog('chest sign skip ' + (err && err.message))
  }
  return false
}

export async function ensureDumpChests(bot, state) {
  state.phase = 'dump'
  try { await unstickIfNeeded(bot, state, 'dump') } catch {}
  if (!canCraftChest(bot)) {
    state.phase = 'wood'
    state.note = 'dump need chest but no logs — gather wood r>=24'
    plog(state.note + ' inv=' + inventorySummary(bot))
    try { await punchTree(bot, state) } catch (err) { plog('dump wood fail ' + (err && err.message)) }
    return false
  }
  const origin = (state && state.campOrigin) || campOriginFromDisk()
  const yGuess = origin.y != null ? origin.y : (bot.entity && bot.entity.position && bot.entity.position.y) || 64
  const slots = plannedDumpSlots({ x: origin.x, y: origin.y, z: origin.z })
  let placed = 0
  for (const slot of slots) {
    if (state.dead) break
    const y = slot.y != null ? slot.y : findGroundY(bot, slot.x, slot.z, yGuess)
    if (y == null) continue
    if (Math.hypot(slot.x, slot.z) < SPAWN_SAFE_R) continue
    let existing = null
    try { existing = bot.blockAt(new Vec3(slot.x, y, slot.z)) } catch {}
    const n = existing && existing.name
    if (n && (bareName(n) === 'chest' || bareName(n) === 'trapped_chest' || bareName(n) === 'barrel')) {
      persistChest({ x: slot.x, y, z: slot.z }, {}, slot.role)
      placed++
      continue
    }
    if (!(await ensureChestItem(bot, state))) {
      plog('dump need wood for chest role=' + slot.role + ' inv=' + inventorySummary(bot))
      state.note = 'dump need wood for ' + slot.role
      break
    }
    const item = findItemByNames(bot, ['chest'])
    if (!item) break
    try { if (typeof bot.equip === 'function') await bot.equip(item, 'hand') } catch {}
    try { await gotoNear(bot, slot.x, y, slot.z, 3, 8000) } catch {}
    const res = await placeAt(bot, slot.x, y, slot.z)
    if (res === true || res === 'exists') {
      persistChest({ x: slot.x, y, z: slot.z }, {}, slot.role)
      try { await maybeSign(bot, state, slot.x, y, slot.z, slot.label || DUMP_LABELS[slot.role] || slot.role) } catch {}
      plog('dump chest role=' + slot.role + ' at ' + slot.x + ' ' + y + ' ' + slot.z + ' res=' + res)
      state.note = 'dump ' + slot.role + ' at ' + slot.x + ',' + y + ',' + slot.z
      placed++
    } else {
      plog('dump place fail role=' + slot.role + ' at ' + slot.x + ' ' + y + ' ' + slot.z)
    }
  }
  state.note = 'dump placed=' + placed + '/' + slots.length
  plog(state.note)
  return placed > 0
}

export async function runChest(bot, state) {
  const act = String(state.chestAction || 'catalog').toLowerCase()
  state.phase = 'chest'
  if (act === 'dump' || act === 'place-dump') return ensureDumpChests(bot, state)
  if (act === 'store' || act === 'deposit') return depositExtras(bot, state)
  if (act === 'withdraw') return withdrawNamed(bot, state, state.chestItem || 'dirt', state.chestCount || 1)
  const items = await catalogNearby(bot, state)
  state.note = 'chest ' + (items ? Object.keys(items).join(',') : 'empty')
  return !!items
}

export async function run(bot, state) {
  return runChest(bot, state)
}
