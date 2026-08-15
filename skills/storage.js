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

export const ROLES = ['terrain', 'stone', 'wood', 'food', 'misc']
export const DUMP_LABELS = {
  terrain: 'dirt/sand',
  stone: 'cobble/stone',
  wood: 'wood/logs/planks',
  food: 'food/seeds',
  misc: 'misc'
}
// North of the 7x7 palisade so dump chests do not eat wall cells.
export const DUMP_PLAN = [
  { role: 'terrain', dx: 1, dz: -1, label: DUMP_LABELS.terrain },
  { role: 'stone', dx: 3, dz: -1, label: DUMP_LABELS.stone },
  { role: 'wood', dx: 5, dz: -1, label: DUMP_LABELS.wood },
  { role: 'food', dx: 7, dz: -1, label: DUMP_LABELS.food },
  { role: 'misc', dx: 9, dz: -1, label: DUMP_LABELS.misc }
]

function defaultDumpPlan() {
  return DUMP_PLAN.map((s) => ({ role: s.role, dx: s.dx, dz: s.dz, label: s.label }))
}

function empty() {
  return {
    camp: { x: CAMP_XZ.x, y: null, z: CAMP_XZ.z, r: 32 },
    farms: {},
    chests: [],
    dumpPlan: defaultDumpPlan(),
    targets: { dirt: 32, cobblestone: 16, logs: 8, food: 8, sand: 8, wheat_seeds: 16 },
    missing: {},
    updated: new Date().toISOString()
  }
}

export function roleForItem(name) {
  const n = bareName(name)
  if (!n) return 'misc'
  if (n === 'dirt' || n === 'grass_block' || n === 'coarse_dirt' || n === 'podzol' || n === 'mud' || n === 'clay' || n === 'gravel' || n === 'sand' || n === 'red_sand' || n.includes('sand')) return 'terrain'
  if (n === 'cobblestone' || n === 'stone' || n === 'andesite' || n === 'diorite' || n === 'granite' || n === 'cobbled_deepslate' || n.endsWith('_ore') || (n.includes('stone') && !n.includes('sandstone') && !n.includes('redstone'))) return 'stone'
  if (n.includes('log') || n.includes('stem') || n.includes('plank') || n.includes('sapling') || n === 'stick' || n.endsWith('_wood')) return 'wood'
  if (n.includes('seed') || n.includes('wheat') || n.includes('carrot') || n.includes('potato') || n.includes('beetroot') || n.includes('berry') || n.includes('bread') || n.includes('apple') || n.includes('beef') || n.includes('pork') || n.includes('chicken') || n.includes('mutton') || n.includes('cod') || n.includes('salmon') || n.includes('flesh') || n === 'bowl' || n.includes('stew') || n.includes('soup')) return 'food'
  return 'misc'
}

export function plannedDumpSlots(origin) {
  const ox = (origin && origin.x != null) ? origin.x : CAMP_XZ.x
  const oz = (origin && origin.z != null) ? origin.z : CAMP_XZ.z
  const oy = (origin && origin.y != null) ? origin.y : null
  return DUMP_PLAN.map((s) => {
    let x = ox + s.dx
    let z = oz + s.dz
    const r = Math.hypot(x, z)
    if (r < SPAWN_SAFE_R) {
      const scale = (SPAWN_SAFE_R + 2) / (r || 1)
      x = Math.round(x * scale)
      z = Math.round(z * scale)
    }
    return { role: s.role, label: s.label, x, y: oy, z }
  })
}

function sameBlock(a, x, y, z) {
  return a && a.x === x && a.y === y && a.z === z
}

export function assignChestRoles(s) {
  const data = s || loadStorage()
  data.chests = data.chests || []
  data.dumpPlan = data.dumpPlan && data.dumpPlan.length ? data.dumpPlan : defaultDumpPlan()
  const origin = data.camp || { x: CAMP_XZ.x, y: null, z: CAMP_XZ.z }
  const slots = plannedDumpSlots(origin)
  const used = new Set(data.chests.filter((c) => c && c.role).map((c) => c.role))
  for (const c of data.chests) {
    if (!c) continue
    if (!c.role) {
      const hit = slots.find((sl) => sl.x === c.x && sl.z === c.z)
      if (hit) c.role = hit.role
      else {
        const next = ROLES.find((r) => !used.has(r)) || 'misc'
        c.role = next
      }
    }
    used.add(c.role)
    if (c.items == null) c.items = {}
    if (!c.lastSeen) c.lastSeen = null
  }
  return data
}

export function loadStorage() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    if (j && typeof j === 'object') return j
  } catch {}
  return empty()
}

export function saveStorage(data) {
  const out = assignChestRoles(data || empty())
  if (!out.dumpPlan) out.dumpPlan = defaultDumpPlan()
  out.updated = new Date().toISOString()
  try { fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n') } catch (err) {
    plog('storage write fail ' + (err && err.message))
  }
  return out
}

export function liveCampXZ() {
  const c = campOriginFromDisk()
  if (c && c.x != null && c.z != null) return { x: c.x, z: c.z }
  return { x: CAMP_XZ.x, z: CAMP_XZ.z }
}

export function markCamp(origin) {
  const s = loadStorage()
  if (origin && origin.x != null && origin.z != null) {
    const r = Math.hypot(origin.x, origin.z)
    if (r >= SPAWN_SAFE_R) {
      s.camp = {
        x: Math.floor(origin.x),
        y: origin.y != null ? origin.y : (s.camp && s.camp.y),
        z: Math.floor(origin.z),
        r: Math.round(r)
      }
      plog('storage camp pin ' + s.camp.x + ' ' + s.camp.y + ' ' + s.camp.z + ' r=' + s.camp.r)
      return saveStorage(s)
    }
  }
  const y = origin && origin.y != null ? origin.y : (s.camp && s.camp.y)
  if (s.camp && s.camp.x != null && Math.hypot(s.camp.x, s.camp.z) >= SPAWN_SAFE_R) {
    if (y != null) s.camp.y = y
    return saveStorage(s)
  }
  s.camp = { x: CAMP_XZ.x, y, z: CAMP_XZ.z, r: 32 }
  return saveStorage(s)
}

export function pinCampNearGrove(pos) {
  if (!pos) return loadStorage()
  const r = Math.hypot(pos.x, pos.z)
  if (r < SPAWN_SAFE_R) return loadStorage()
  const s = loadStorage()
  if (s.camp && s.camp.grove) return s
  let x = Math.floor(pos.x) - 2
  let z = Math.floor(pos.z)
  if (Math.hypot(x, z) < SPAWN_SAFE_R) {
    const rr = r || 1
    x = Math.floor((pos.x / rr) * 26)
    z = Math.floor((pos.z / rr) * 26)
  }
  s.camp = { x, y: Math.floor(pos.y), z, r: Math.round(Math.hypot(x, z)), grove: true }
  plog('camp repin grove ' + x + ' ' + s.camp.y + ' ' + z)
  return saveStorage(s)
}

export function markFarm(kind, origin) {
  const s = loadStorage()
  s.farms = s.farms || {}
  s.farms[kind] = { x: origin.x, y: origin.y, z: origin.z }
  return saveStorage(s)
}

export function recordChest(pos, extra) {
  if (!pos) return loadStorage()
  const s = loadStorage()
  s.chests = s.chests || []
  const x = Math.floor(pos.x)
  const y = Math.floor(pos.y)
  const z = Math.floor(pos.z)
  let row = s.chests.find((c) => sameBlock(c, x, y, z))
  if (!row) {
    row = { x, y, z, role: extra && extra.role, items: (extra && extra.items) || {}, lastSeen: (extra && extra.lastSeen) || null }
    s.chests.push(row)
  }
  if (extra && extra.role) row.role = extra.role
  if (extra && extra.items) row.items = extra.items
  if (extra && extra.lastSeen) row.lastSeen = extra.lastSeen
  if (!row.role) {
    const hit = plannedDumpSlots(s.camp).find((sl) => sl.x === x && sl.z === z)
    row.role = (hit && hit.role) || roleForItem((extra && extra.hint) || '')
  }
  if (row.items == null) row.items = {}
  return saveStorage(s)
}

export function chestByRole(role) {
  const s = assignChestRoles(loadStorage())
  const want = String(role || '').toLowerCase()
  return (s.chests || []).find((c) => c && c.role === want) || null
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

function isChestName(n) {
  return n === 'chest' || n === 'trapped_chest' || n === 'barrel'
}

function blockAtChest(bot, c) {
  if (!c || c.y == null) return null
  try {
    const b = bot.blockAt(new Vec3(c.x, c.y, c.z))
    if (isChestName(bareName(b && b.name))) return b
  } catch {}
  return null
}

export function findChestForRole(bot, role, origin, maxD = 24) {
  const s = assignChestRoles(loadStorage())
  const want = String(role || 'misc').toLowerCase()
  const row = (s.chests || []).find((c) => c && c.role === want)
  const fromRow = blockAtChest(bot, row)
  if (fromRow) return fromRow
  const here = (origin && new Vec3(origin.x, origin.y || 64, origin.z)) || (bot.entity && bot.entity.position)
  if (here) {
    try {
      const block = bot.findBlock({
        matching: (b) => isChestName(bareName(b && b.name)),
        maxDistance: maxD,
        point: here
      })
      if (block) return block
    } catch {}
  }
  for (const fallback of ['misc', 'terrain', 'stone', 'wood', 'food']) {
    if (fallback === want) continue
    const alt = (s.chests || []).find((c) => c && c.role === fallback)
    const b = blockAtChest(bot, alt)
    if (b) return b
  }
  for (const c of s.chests || []) {
    const b = blockAtChest(bot, c)
    if (b) return b
  }
  return null
}

export function findChestForItem(bot, itemName, origin, maxD = 24) {
  return findChestForRole(bot, roleForItem(itemName), origin, maxD)
}

export function findNearChest(bot, origin, maxD = 12) {
  return findChestForRole(bot, 'misc', origin, maxD)
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
