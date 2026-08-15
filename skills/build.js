import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Schematic } from 'prismarine-schematic'
import { Vec3, plog, sleep, bareName, isSolid, isPlayerBuilt, horizFromOrigin, inventorySummary, findItemByNames, resolveItemName, eachInventoryItem, gotoNear, stopPath, sayAllowed, SPAWN_SAFE_R } from './lib.js'
import { leaveSpawnForGather } from './collect.js'
import { gatherWood } from './wood.js'
import { craftSandstone, craftPlanks } from './craft.js'
import { placeAt } from './place.js'
import { loadStorage, saveStorage } from './storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCHEM_DIR = path.join(__dirname, '..', 'schematics')
const AIR = new Set(['air', 'cave_air', 'void_air'])
const GRAVITY = new Set(['sand', 'red_sand', 'gravel', 'concrete_powder', 'anvil', 'dragon_egg'])
const BUILD_ITEMS = ['sandstone', 'cut_sandstone', 'smooth_sandstone', 'dirt', 'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'bamboo_planks', 'cobblestone']

function isAir(b) {
  return !b || AIR.has(bareName(b && b.name))
}

export async function loadSchematic(name) {
  const base = String(name || 'hut').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'hut'
  const jsonPath = path.join(SCHEM_DIR, base + '.json')
  const schemPath = path.join(SCHEM_DIR, base + '.schem')
  if (fs.existsSync(jsonPath)) {
    const schem = Schematic.fromJSON(fs.readFileSync(jsonPath, 'utf8'))
    if (!schem) throw new Error('bad json ' + base)
    return schem
  }
  if (fs.existsSync(schemPath)) {
    return Schematic.read(fs.readFileSync(schemPath), '1.21.11')
  }
  throw new Error('no schematic ' + base)
}

export async function listSolids(schem) {
  const out = []
  await schem.forEach((block, pos) => {
    const n = bareName(block && block.name)
    if (!n || AIR.has(n)) return
    if (GRAVITY.has(n)) return
    out.push({ name: n, pos })
  })
  return out
}

function countBuildInv(bot) {
  let n = 0
  eachInventoryItem(bot, (it) => {
    const name = resolveItemName(bot, it)
    if (BUILD_ITEMS.includes(name) && !GRAVITY.has(name)) n += Number(it.count) || 0
  })
  return n
}

export function countBuildMaterials(bot) {
  return countBuildInv(bot)
}

export function countInvAndChests(bot) {
  const bag = {}
  eachInventoryItem(bot, (it) => {
    const n = resolveItemName(bot, it)
    if (!n) return
    bag[n] = (bag[n] || 0) + (Number(it.count) || 0)
  })
  const s = loadStorage()
  for (const c of s.chests || []) {
    for (const [name, n] of Object.entries(c.items || {})) {
      bag[name] = (bag[name] || 0) + Number(n || 0)
    }
  }
  return bag
}

export function planSchematic(bot, solids, name) {
  const needN = (solids && solids.length) || 0
  const haveBuild = countBuildMaterials(bot)
  const bag = countInvAndChests(bot)
  const chestBuild = (bag.dirt || 0) + (bag.cobblestone || 0) + (bag.sandstone || 0)
  const have = haveBuild + chestBuild
  const missing = {}
  if (have < needN) missing.blocks = needN - have
  const s = loadStorage()
  s.missing = Object.assign({}, s.missing || {}, missing, { schematic: name || '', need: needN, have })
  saveStorage(s)
  plog('build plan ' + (name || '') + ' need=' + needN + ' inv=' + haveBuild + ' inv+chests=' + have + ' missing=' + JSON.stringify(missing))
  return { need: needN, have, haveBuild, missing }
}


const _solidCache = {}
export function schemSolidCount(name) {
  const key = String(name || 'hut').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'hut'
  if (_solidCache[key]) return _solidCache[key]
  try {
    const jsonPath = path.join(SCHEM_DIR, key + '.json')
    if (fs.existsSync(jsonPath)) {
      const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      _solidCache[key] = (j.blocks || []).filter((x) => x !== 0).length
    }
  } catch {}
  return _solidCache[key] || 0
}

export function hutSolidCount() {
  return schemSolidCount('hut')
}

export function findGroundY(bot, x, z, guess) {
  return groundY(bot, x, z, guess)
}

function pickBuildItem(bot) {
  return findItemByNames(bot, BUILD_ITEMS)
}

async function equipBuild(bot, item) {
  if (!item || GRAVITY.has(resolveItemName(bot, item))) return false
  try {
    if (typeof bot.equip === 'function') await bot.equip(item, 'hand')
    return true
  } catch (err) {
    plog('build equip fail ' + (err && err.message))
    return false
  }
}

function groundY(bot, x, z, guess) {
  const g = Math.floor(guess)
  for (let y = g + 4; y >= g - 10; y--) {
    let b = null
    let a = null
    try {
      b = bot.blockAt(new Vec3(x, y, z))
      a = bot.blockAt(new Vec3(x, y + 1, z))
    } catch {}
    if (b && isSolid(b) && isAir(a) && !isPlayerBuilt(b)) return y + 1
  }
  return g
}

function siteClear(bot, ox, oy, oz, size) {
  for (let x = 0; x < size.x; x++) {
    for (let z = 0; z < size.z; z++) {
      if (Math.hypot(ox + x, oz + z) < SPAWN_SAFE_R) return false
      for (let y = 0; y < size.y; y++) {
        let b = null
        try { b = bot.blockAt(new Vec3(ox + x, oy + y, oz + z)) } catch {}
        if (b && isPlayerBuilt(b)) return false
      }
    }
  }
  return true
}

function pickOrigin(bot, size) {
  const p = bot.entity && bot.entity.position
  if (!p) return null
  const tries = [[6, 0], [0, 6], [-6, 0], [0, -6], [8, 8], [-8, 8], [8, -8], [-8, -8], [32 - Math.floor(p.x), 0], [0, 32 - Math.floor(p.z)], [24 - Math.floor(p.x), 24 - Math.floor(p.z)]]
  for (const [dx, dz] of tries) {
    const ox = Math.floor(p.x + dx)
    const oz = Math.floor(p.z + dz)
    const oy = groundY(bot, ox + 2, oz + 2, p.y)
    if (siteClear(bot, ox, oy, oz, size)) return { x: ox, y: oy, z: oz }
  }
  return null
}

async function maybeGather(bot, state, need) {
  let have = countBuildInv(bot)
  if (have >= need) return have
  try { await craftSandstone(bot, state) } catch {}
  try { await craftPlanks(bot, state) } catch {}
  have = countBuildInv(bot)
  if (have >= need) return have
  if (have < Math.min(8, need)) {
    plog('build missing materials have=' + have + ' need=' + need + ' try wood')
    try { await gatherWood(bot, state) } catch {}
    try { await craftPlanks(bot, state) } catch {}
  }
  have = countBuildInv(bot)
  if (have < need) plog('build missing have=' + have + ' need=' + need + ' will place what we have')
  return have
}

export async function buildNamed(bot, state, name) {
  const want = String(name || state.buildName || 'hut').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'hut'
  state.phase = 'build'
  state.note = 'build ' + want
  state.buildName = want
  if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
    await leaveSpawnForGather(bot, state)
    if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
      plog('build refuse spawn')
      return false
    }
  }
  let schem
  try {
    schem = await loadSchematic(want)
  } catch (err) {
    plog('build load fail ' + (err && err.message))
    return false
  }
  const solids = await listSolids(schem)
  if (!solids.length) {
    plog('build empty schematic ' + want)
    return false
  }
  const plan = planSchematic(bot, solids, want)
  await maybeGather(bot, state, solids.length)
  const origin = pickOrigin(bot, schem.size)
  if (!origin) {
    plog('build no site r>=24 without player-built')
    return false
  }
  return placeSolids(bot, state, want, solids, origin)
}

export async function buildNamedAt(bot, state, name, origin) {
  const want = String(name || state.buildName || 'hut').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'hut'
  state.phase = 'build'
  state.note = 'build ' + want
  state.buildName = want
  if (!origin) {
    plog('buildNamedAt missing origin')
    return false
  }
  if (Math.hypot(origin.x, origin.z) < SPAWN_SAFE_R) {
    plog('buildNamedAt refuse spawn origin')
    return false
  }
  if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
    await leaveSpawnForGather(bot, state)
    if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
      plog('build refuse spawn')
      return false
    }
  }
  let schem
  try {
    schem = await loadSchematic(want)
  } catch (err) {
    plog('build load fail ' + (err && err.message))
    return false
  }
  const solids = await listSolids(schem)
  if (!solids.length) {
    plog('build empty schematic ' + want)
    return false
  }
  planSchematic(bot, solids, want)
  return placeSolids(bot, state, want, solids, origin)
}

async function placeSolids(bot, state, want, solids, origin) {
  plog('build ' + want + ' n=' + solids.length + ' at ' + origin.x + ' ' + origin.y + ' ' + origin.z)
  stopPath(bot)
  try { await gotoNear(bot, origin.x + 2, origin.y, origin.z + 2, 3, 8000) } catch {}
  let placed = 0
  let skipped = 0
  let missing = 0
  for (const cell of solids) {
    if (state.dead) break
    if (state.chatMode && state.chatMode !== 'build' && state.chatMode !== 'camp' && state.chatMode !== 'farm') break
    const x = origin.x + cell.pos.x
    const y = origin.y + cell.pos.y
    const z = origin.z + cell.pos.z
    if (Math.hypot(x, z) < SPAWN_SAFE_R) { skipped++; continue }
    let existing = null
    try { existing = bot.blockAt(new Vec3(x, y, z)) } catch {}
    if (existing && isPlayerBuilt(existing)) { skipped++; continue }
    if (existing && !isAir(existing)) { skipped++; continue }
    const item = pickBuildItem(bot)
    if (!item) { missing++; continue }
    await equipBuild(bot, item)
    const here = bot.entity && bot.entity.position
    if (here && here.distanceTo(new Vec3(x + 0.5, y, z + 0.5)) > 4.2) {
      try { await gotoNear(bot, x, y, z, 3, 4000) } catch {}
    }
    const res = await placeAt(bot, x, y, z)
    if (res === true) placed++
    else if (res === 'exists') skipped++
    await sleep(80)
  }
  state.houseBlocks = (state.houseBlocks || 0) + placed
  state.housePlaced = state.houseBlocks >= 8
  const left = pickBuildItem(bot)
  state.buildMaterial = (left && resolveItemName(bot, left)) || state.buildMaterial || 'none'
  state.note = 'build ' + want + ' placed=' + placed + ' skip=' + skipped + ' missing=' + missing
  plog(state.note + ' inv=' + inventorySummary(bot))
  if (want === 'hut' && state.housePlaced) sayAllowed(bot, state, 'house up')
  return placed > 0
}

export async function run(bot, state) {
  return buildNamed(bot, state, state.buildName || 'hut')
}
