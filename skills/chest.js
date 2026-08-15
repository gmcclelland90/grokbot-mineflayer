import { Vec3, plog, sleep, bareName, resolveItemName, eachInventoryItem, findItemByNames, gotoNear, horizFromOrigin, SPAWN_SAFE_R } from './lib.js'
import { loadStorage, saveStorage, recordChest, findNearChest, extrasToDump, campOriginFromDisk } from './storage.js'
import { withChestLock } from './cluster.js'

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

function persistChest(pos, items) {
  if (!pos) return loadStorage()
  const s = loadStorage()
  s.chests = s.chests || []
  const x = Math.floor(pos.x)
  const y = Math.floor(pos.y)
  const z = Math.floor(pos.z)
  let row = s.chests.find((c) => c.x === x && c.y === y && c.z === z)
  if (!row) {
    row = { x, y, z }
    s.chests.push(row)
  }
  row.items = items || {}
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
  const block = findChestBlock(bot, origin, 16)
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
  const block = findChestBlock(bot, origin, 16)
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

export async function depositExtras(bot, state) {
  const extras = extrasToDump(bot)
  if (!extras.length) return false
  const origin = (state && state.campOrigin) || campOriginFromDisk()
  const block = findChestBlock(bot, origin, 16)
  if (!block) {
    plog('chest no chest, keep extras n=' + extras.length)
    return false
  }
  if (Math.hypot(block.position.x, block.position.z) < SPAWN_SAFE_R) {
    plog('chest skip spawn')
    return false
  }
  recordChest(block.position)
  return withChestLock(async () => {
    const win = await openChest(bot, block)
    if (!win) return false
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
    persistChest(block.position, catalogWindow(win))
    try { win.close() } catch {}
    plog('chest dumped=' + dumped)
    return dumped > 0
  })
}

export async function runChest(bot, state) {
  const act = String(state.chestAction || 'catalog').toLowerCase()
  state.phase = 'chest'
  if (act === 'store' || act === 'deposit') return depositExtras(bot, state)
  if (act === 'withdraw') return withdrawNamed(bot, state, state.chestItem || 'dirt', state.chestCount || 1)
  const items = await catalogNearby(bot, state)
  state.note = 'chest ' + (items ? Object.keys(items).join(',') : 'empty')
  return !!items
}

export async function run(bot, state) {
  return runChest(bot, state)
}
