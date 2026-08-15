import { Vec3, plog, sleep, posOf, bareName, countNamed, countLogs, inventorySummary, horizFromOrigin, findItemByNames, gotoNear, stopPath, isPlayerBuilt, SPAWN_SAFE_R } from './lib.js'
import { leaveSpawnForGather, huntBlock, collectViaPlugin } from './collect.js'
import { punchTree } from './wood.js'
import { placeAt } from './place.js'
import { buildNamedAt, countBuildMaterials, findGroundY, schemSolidCount } from './build.js'
import { craftByName, craftWoodenTool } from './craft.js'
import { WHEAT_XZ, TREES_XZ, markFarm, depositExtras, campOriginFromDisk } from './storage.js'

// Official farmer.js: harvest mature wheat, sow seeds on empty farmland.
// https://raw.githubusercontent.com/PrismarineJS/mineflayer/master/examples/farmer.js

const SEED_ITEMS = ['wheat_seeds', 'carrot', 'potato', 'beetroot_seeds']
const SAPLINGS = ['oak_sapling', 'birch_sapling', 'spruce_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling', 'cherry_sapling']
const HOES = ['wooden_hoe', 'stone_hoe', 'iron_hoe', 'golden_hoe', 'diamond_hoe', 'netherite_hoe']
const TILLABLE = new Set(['dirt', 'grass_block', 'dirt_path', 'coarse_dirt'])
const AIR = new Set(['air', 'cave_air', 'void_air'])

function isAir(b) {
  return !b || AIR.has(bareName(b && b.name))
}

function cropAge(block) {
  if (!block) return -1
  try {
    const p = (typeof block.getProperties === 'function' ? block.getProperties() : null) || block._properties || {}
    if (p.age != null) return Number(p.age)
  } catch {}
  if (block.metadata != null) return Number(block.metadata)
  return -1
}

function isMatureCrop(block) {
  const n = bareName(block && block.name)
  if (n === 'wheat' || n === 'carrots' || n === 'potatoes') return cropAge(block) >= 7
  if (n === 'beetroots') return cropAge(block) >= 3
  return false
}

function seedForCrop(name) {
  const n = bareName(name)
  if (n === 'wheat') return 'wheat_seeds'
  if (n === 'carrots') return 'carrot'
  if (n === 'potatoes') return 'potato'
  if (n === 'beetroots') return 'beetroot_seeds'
  return 'wheat_seeds'
}

export function farmXZ(kind) {
  if (kind === 'trees') return { x: TREES_XZ.x, z: TREES_XZ.z }
  return { x: WHEAT_XZ.x, z: WHEAT_XZ.z }
}

export function resolveFarmOrigin(bot, kind, guessY) {
  const xz = farmXZ(kind)
  const p = bot.entity && bot.entity.position
  const g = guessY != null ? guessY : (p ? p.y : 64)
  const y = findGroundY(bot, xz.x + 1, xz.z + 1, g)
  return { x: xz.x, y, z: xz.z }
}

async function ensureHoe(bot, state) {
  if (findItemByNames(bot, HOES)) return true
  try { return await craftWoodenTool(bot, state, 'hoe') } catch (err) {
    plog('farm hoe craft fail ' + (err && err.message))
    return false
  }
}

async function gatherSeeds(bot, state) {
  if (SEED_ITEMS.some((n) => countNamed(bot, [n]) > 0)) return true
  plog('farm hunt seeds/grass')
  try { await huntBlock(bot, state, 'short_grass') } catch {}
  if (SEED_ITEMS.some((n) => countNamed(bot, [n]) > 0)) return true
  try { await huntBlock(bot, state, 'tall_grass') } catch {}
  return SEED_ITEMS.some((n) => countNamed(bot, [n]) > 0)
}

function blockToHarvest(bot, origin) {
  const point = origin ? new Vec3(origin.x + 2, origin.y, origin.z + 2) : (bot.entity && bot.entity.position)
  if (!point) return null
  try {
    return bot.findBlock({
      point,
      maxDistance: 10,
      matching: (block) => {
        if (!isMatureCrop(block)) return false
        if (block.position && Math.hypot(block.position.x, block.position.z) < SPAWN_SAFE_R) return false
        return true
      }
    }) || null
  } catch {
    return null
  }
}

function blockToSow(bot, origin) {
  const farmlandId = bot.registry && bot.registry.blocksByName && bot.registry.blocksByName.farmland && bot.registry.blocksByName.farmland.id
  const point = origin ? new Vec3(origin.x + 2, origin.y, origin.z + 2) : (bot.entity && bot.entity.position)
  if (!point) return null
  try {
    return bot.findBlock({
      point,
      maxDistance: 10,
      matching: farmlandId != null ? farmlandId : (b) => bareName(b && b.name) === 'farmland',
      useExtraInfo: (block) => {
        if (!block || !block.position) return false
        if (Math.hypot(block.position.x, block.position.z) < SPAWN_SAFE_R) return false
        const above = bot.blockAt(block.position.offset(0, 1, 0))
        return isAir(above)
      }
    }) || null
  } catch {
    return null
  }
}

function findTillable(bot, origin, size) {
  const ox = origin.x
  const oy = origin.y
  const oz = origin.z
  const sx = (size && size.x) || 5
  const sz = (size && size.z) || 5
  for (let x = 0; x < sx; x++) {
    for (let z = 0; z < sz; z++) {
      let b = null
      let above = null
      try {
        b = bot.blockAt(new Vec3(ox + x, oy, oz + z))
        above = bot.blockAt(new Vec3(ox + x, oy + 1, oz + z))
      } catch {}
      const n = bareName(b && b.name)
      if (!TILLABLE.has(n)) continue
      if (isPlayerBuilt(b)) continue
      if (Math.hypot(ox + x, oz + z) < SPAWN_SAFE_R) continue
      if (above && !isAir(above) && !isMatureCrop(above)) continue
      return b
    }
  }
  return null
}

async function tillPlot(bot, state, origin) {
  const hoe = findItemByNames(bot, HOES)
  if (!hoe) return 0
  try { if (typeof bot.equip === 'function') await bot.equip(hoe, 'hand') } catch {}
  let n = 0
  for (let i = 0; i < 24; i++) {
    const b = findTillable(bot, origin, { x: 5, z: 5 })
    if (!b) break
    try { await gotoNear(bot, b.position.x, b.position.y, b.position.z, 3, 4000) } catch {}
    try {
      await bot.activateBlock(b)
      n++
      await sleep(120)
    } catch (err) {
      plog('farm till fail ' + (err && err.message))
      break
    }
  }
  plog('farm tilled=' + n)
  return n
}

async function harvestAndSow(bot, state, origin) {
  // Official farmer.js loop
  let harvested = 0
  let sown = 0
  try {
    while (!state.dead) {
      if (state.chatMode && state.chatMode !== 'farm' && state.chatMode !== 'build') break
      const toHarvest = blockToHarvest(bot, origin)
      if (!toHarvest) break
      try { await gotoNear(bot, toHarvest.position.x, toHarvest.position.y, toHarvest.position.z, 3, 4000) } catch {}
      try {
        await bot.dig(toHarvest)
        harvested++
        await sleep(80)
      } catch (err) {
        plog('farm harvest fail ' + (err && err.message))
        break
      }
    }
    while (!state.dead) {
      if (state.chatMode && state.chatMode !== 'farm' && state.chatMode !== 'build') break
      const toSow = blockToSow(bot, origin)
      if (!toSow) break
      const seed = findItemByNames(bot, SEED_ITEMS)
      if (!seed) break
      try { await bot.equip(seed, 'hand') } catch {}
      try { await gotoNear(bot, toSow.position.x, toSow.position.y, toSow.position.z, 3, 4000) } catch {}
      try {
        await bot.placeBlock(toSow, new Vec3(0, 1, 0))
        sown++
        await sleep(80)
      } catch (err) {
        plog('farm sow fail ' + (err && err.message))
        break
      }
    }
  } catch (e) {
    plog('farm loop ' + (e && e.message))
  }
  if (countNamed(bot, ['wheat']) >= 3) {
    try { await craftByName(bot, state, 'bread', 1) } catch {}
  }
  plog('farm harvest=' + harvested + ' sow=' + sown + ' inv=' + inventorySummary(bot))
  return harvested + sown > 0
}

async function plantSaplings(bot, state, origin) {
  const sap = findItemByNames(bot, SAPLINGS)
  if (!sap) {
    plog('farm trees no saplings')
    return 0
  }
  const spots = [[0, 0], [3, 0], [6, 0], [0, 3], [3, 3], [6, 3]]
  let n = 0
  for (const [dx, dz] of spots) {
    const x = origin.x + dx
    const y = origin.y
    const z = origin.z + dz
    if (Math.hypot(x, z) < SPAWN_SAFE_R) continue
    let dirt = null
    let above = null
    try {
      dirt = bot.blockAt(new Vec3(x, y, z))
      above = bot.blockAt(new Vec3(x, y + 1, z))
    } catch {}
    const dn = bareName(dirt && dirt.name)
    if (!TILLABLE.has(dn) && dn !== 'farmland') continue
    if (above && !isAir(above)) continue
    try { await bot.equip(sap, 'hand') } catch {}
    try { await gotoNear(bot, x, y, z, 3, 4000) } catch {}
    try {
      await bot.placeBlock(dirt, new Vec3(0, 1, 0))
      n++
      await sleep(80)
    } catch (err) {
      plog('farm sapling fail ' + (err && err.message))
    }
  }
  plog('farm saplings planted=' + n)
  return n
}

async function placeFarmSchem(bot, state, kind) {
  const need = schemSolidCount(kind) || (kind === 'trees' ? 6 : 24)
  let have = countBuildMaterials(bot)
  if (have < need) {
    plog('farm gather ' + kind + ' have=' + have + ' need=' + need)
    for (let i = 0; i < 6 && have < need && !state.dead; i++) {
      if (horizFromOrigin(bot) < SPAWN_SAFE_R) await leaveSpawnForGather(bot, state)
      try { await huntBlock(bot, state, 'dirt') } catch {}
      have = countBuildMaterials(bot)
    }
  }
  const origin = resolveFarmOrigin(bot, kind)
  if (Math.hypot(origin.x, origin.z) < SPAWN_SAFE_R) {
    plog('farm origin inside spawn')
    return null
  }
  const ok = await buildNamedAt(bot, state, kind, origin)
  if (ok) markFarm(kind, origin)
  return ok ? origin : null
}

export async function runFarm(bot, state) {
  const kind = String(state.farmKind || state.buildName || 'tend').toLowerCase()
  state.phase = 'farm'
  state.note = 'farm ' + kind
  if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
    await leaveSpawnForGather(bot, state)
    if (horizFromOrigin(bot) < SPAWN_SAFE_R) return false
  }
  stopPath(bot)
  let origin = null
  if (kind === 'wheat' || kind === 'trees') {
    origin = await placeFarmSchem(bot, state, kind)
    if (origin) {
      if (kind === 'wheat') {
        await ensureHoe(bot, state)
        await tillPlot(bot, state, origin)
        await gatherSeeds(bot, state)
        await harvestAndSow(bot, state, origin)
        state.farmReady = true
        state.farmKindReady = 'wheat'
      } else {
        await plantSaplings(bot, state, origin)
        state.treesReady = true
      }
    } else {
      state.note = 'farm ' + kind + ' waiting blocks'
      return false
    }
  } else {
    const wheat = resolveFarmOrigin(bot, 'wheat')
    const trees = resolveFarmOrigin(bot, 'trees')
    await harvestAndSow(bot, state, wheat)
    await plantSaplings(bot, state, trees)
  }
  try { await depositExtras(bot, state) } catch (err) {
    plog('farm deposit skip ' + (err && err.message))
  }
  state.note = 'farm ' + kind + ' inv=' + inventorySummary(bot)
  plog(state.note + ' pos=' + (posOf(bot) && posOf(bot).str))
  return true
}

export async function run(bot, state) {
  return runFarm(bot, state)
}
