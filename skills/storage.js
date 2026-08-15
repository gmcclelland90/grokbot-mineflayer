import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Vec3, plog, sleep, bareName, countNamed, resolveItemName, eachInventoryItem, gotoNear, findItemByNames, isPlayerBuilt, horizFromOrigin, SPAWN_SAFE_R } from './lib.js'
import { withChestLock } from './cluster.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(__dirname, '..', 'rl', 'storage.json')

export const CAMP_XZ = { x: 32, z: 0 }
export const WHEAT_XZ = { x: 40, z: 0 }
export const TREES_XZ = { x: 32, z: 8 }

const KEEP = {
  wooden_hoe: 1,
  stone_hoe: 1,
  wheat_seeds: 16,
  carrot: 8,
  potato: 8,
  beetroot_seeds: 8,
  oak_sapling: 8,
  birch_sapling: 8,
  spruce_sapling: 8,
  dirt: 20,
  cobblestone: 16,
  torch: 8,
  stick: 8,
  coal: 8,
  charcoal: 8,
  bread: 8,
  wooden_shovel: 1,
  wooden_pickaxe: 1,
  crafting_table: 1,
  chest: 1
}

function empty() {
  return {
    camp: { x: CAMP_XZ.x, y: null, z: CAMP_XZ.z, r: 32 },
    farms: {},
    chests: [],
    targets: { dirt: 32, cobblestone: 16, logs: 8, food: 8, sand: 8, wheat_seeds: 16 },
    missing: {},
    updated: new Date().toISOString()
  }
}

export function loadStorage() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    if (j && typeof j === 'object') return j
  } catch {}
  return empty()
}

export function saveStorage(data) {
  const out = data || empty()
  out.updated = new Date().toISOString()
  try { fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n') } catch (err) {
    plog('storage write fail ' + (err && err.message))
  }
  return out
}

export function markCamp(origin) {
  const s = loadStorage()
  s.camp = { x: origin.x, y: origin.y, z: origin.z, r: Math.hypot(origin.x, origin.z) }
  return saveStorage(s)
}

export function markFarm(kind, origin) {
  const s = loadStorage()
  s.farms = s.farms || {}
  s.farms[kind] = { x: origin.x, y: origin.y, z: origin.z }
  return saveStorage(s)
}

export function recordChest(pos) {
  if (!pos) return loadStorage()
  const s = loadStorage()
  s.chests = s.chests || []
  const x = Math.floor(pos.x)
  const y = Math.floor(pos.y)
  const z = Math.floor(pos.z)
  if (!s.chests.some((c) => c.x === x && c.y === y && c.z === z)) {
    s.chests.push({ x, y, z })
  }
  return saveStorage(s)
}

export function campOriginFromDisk() {
  const s = loadStorage()
  if (s.camp && s.camp.x != null && s.camp.z != null) return s.camp
  return { x: CAMP_XZ.x, y: s.camp && s.camp.y, z: CAMP_XZ.z }
}

export function extrasToDump(bot) {
  const out = []
  eachInventoryItem(bot, (it) => {
    const n = resolveItemName(bot, it)
    if (!n) return
    const keep = KEEP[n] != null ? KEEP[n] : (n.includes('hoe') || n.includes('sword') || n.includes('pickaxe') || n.includes('shovel') ? 1 : 0)
    const have = Number(it.count) || 0
    const extra = have - keep
    if (extra > 0) out.push({ item: it, name: n, count: extra })
  })
  return out
}

export function findNearChest(bot, origin, maxD = 12) {
  const here = (origin && new Vec3(origin.x, origin.y || 64, origin.z)) || (bot.entity && bot.entity.position)
  if (!here) return null
  try {
    const block = bot.findBlock({
      matching: (b) => {
        const n = bareName(b && b.name)
        return n === 'chest' || n === 'trapped_chest' || n === 'barrel'
      },
      maxDistance: maxD,
      point: here
    })
    if (block) return block
  } catch {}
  const s = loadStorage()
  for (const c of s.chests || []) {
    let b = null
    try { b = bot.blockAt(new Vec3(c.x, c.y, c.z)) } catch {}
    const n = bareName(b && b.name)
    if (n === 'chest' || n === 'trapped_chest' || n === 'barrel') return b
  }
  return null
}

export async function depositExtras(bot, state) {
  const extras = extrasToDump(bot)
  if (!extras.length) return false
  const origin = (state && state.campOrigin) || campOriginFromDisk()
  const chest = findNearChest(bot, origin, 16)
  if (!chest) {
    plog('storage no chest, keep extras n=' + extras.length)
    return false
  }
  if (Math.hypot(chest.position.x, chest.position.z) < SPAWN_SAFE_R) {
    plog('storage skip spawn chest')
    return false
  }
  recordChest(chest.position)
  return withChestLock(async () => {
    try { await gotoNear(bot, chest.position.x, chest.position.y, chest.position.z, 2, 8000) } catch {}
    if (!bot.openContainer && !bot.openChest) {
      plog('storage no openContainer')
      return false
    }
    try {
      const win = bot.openContainer ? await bot.openContainer(chest) : await bot.openChest(chest)
      let dumped = 0
      for (const ex of extras) {
        try {
          if (typeof win.deposit === 'function') {
            await win.deposit(ex.item.type, ex.item.metadata == null ? null : ex.item.metadata, ex.count)
            dumped += ex.count
          }
        } catch (err) {
          plog('storage deposit fail ' + ex.name + ' ' + (err && err.message))
        }
      }
      try { win.close() } catch {}
      plog('storage dumped=' + dumped + ' into chest')
      return dumped > 0
    } catch (err) {
      plog('storage open fail ' + (err && err.message))
      return false
    }
  })
}
