import { Vec3, plog, sleep, bareName, isSolid, isPlayerBuilt, horizFromOrigin, inventorySummary, findItemByNames, resolveItemName, eachInventoryItem, gotoNear, stopPath, SPAWN_SAFE_R } from './lib.js'
import { leaveSpawnForGather } from './collect.js'

const AIR = new Set(['air', 'cave_air', 'void_air'])
const GRAVITY = new Set(['sand', 'red_sand', 'gravel', 'concrete_powder'])
const FLOOR_OK = new Set(['dirt', 'grass_block', 'sand', 'red_sand', 'gravel', 'sandstone', 'stone', 'cobblestone', 'andesite', 'diorite', 'granite', 'coarse_dirt', 'podzol', 'mud', 'clay'])

function isAir(b) {
  return !b || AIR.has(bareName(b.name))
}

function isPlaceableName(name) {
  const n = bareName(name)
  if (!n) return false
  if (n.includes('sword') || n.includes('pickaxe') || n.includes('shovel') || n.includes('axe') || n.includes('hoe')) return false
  if (n.includes('helmet') || n.includes('chestplate') || n.includes('leggings') || n.includes('boots')) return false
  return true
}

function findPlaceable(bot, prefer) {
  if (prefer) {
    const it = findItemByNames(bot, [prefer])
    if (it) return it
  }
  try {
    const held = bot.heldItem
    if (held && isPlaceableName(resolveItemName(bot, held))) return held
  } catch {}
  let found = null
  eachInventoryItem(bot, (it) => {
    if (found) return
    const n = resolveItemName(bot, it)
    if (isPlaceableName(n)) found = it
  })
  return found
}

export async function placeAt(bot, x, y, z) {
  const dest = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z))
  if (Math.hypot(dest.x, dest.z) < SPAWN_SAFE_R) {
    plog('place skip spawn ' + dest.x + ' ' + dest.z)
    return false
  }
  let existing = null
  try { existing = bot.blockAt(dest) } catch {}
  if (existing && !isAir(existing)) {
    plog('place exists ' + bareName(existing.name))
    return 'exists'
  }
  const faces = [
    [new Vec3(0, -1, 0), new Vec3(0, 1, 0)],
    [new Vec3(0, 1, 0), new Vec3(0, -1, 0)],
    [new Vec3(-1, 0, 0), new Vec3(1, 0, 0)],
    [new Vec3(1, 0, 0), new Vec3(-1, 0, 0)],
    [new Vec3(0, 0, -1), new Vec3(0, 0, 1)],
    [new Vec3(0, 0, 1), new Vec3(0, 0, -1)]
  ]
  for (const [off, face] of faces) {
    let ref = null
    try { ref = bot.blockAt(dest.plus(off)) } catch {}
    if (!ref || isAir(ref)) continue
    if (isPlayerBuilt(ref) && bareName(ref.name) !== 'crafting_table') continue
    try {
      await bot.lookAt(ref.position.offset(0.5, 0.5, 0.5), true)
      await bot.placeBlock(ref, face)
      plog('placed at ' + dest.x + ' ' + dest.y + ' ' + dest.z)
      return true
    } catch (err) {
      plog('place try fail ' + dest + ' ' + (err && err.message))
    }
  }
  return false
}

function pickDest(bot) {
  const p = bot.entity && bot.entity.position
  if (!p) return null
  const yaw = bot.entity.yaw || 0
  const dx = Math.round(-Math.sin(yaw))
  const dz = Math.round(-Math.cos(yaw))
  const candidates = [
    [Math.floor(p.x + dx), Math.floor(p.z + dz)],
    [Math.floor(p.x + dx * 2), Math.floor(p.z + dz * 2)],
    [Math.floor(p.x + 1), Math.floor(p.z)],
    [Math.floor(p.x - 1), Math.floor(p.z)],
    [Math.floor(p.x), Math.floor(p.z + 1)],
    [Math.floor(p.x), Math.floor(p.z - 1)]
  ]
  const fy = Math.floor(p.y)
  for (const [fx, fz] of candidates) {
    if (Math.hypot(fx, fz) < SPAWN_SAFE_R) continue
    for (let y = fy + 2; y >= fy - 3; y--) {
      let below = null
      let at = null
      try {
        below = bot.blockAt(new Vec3(fx, y - 1, fz))
        at = bot.blockAt(new Vec3(fx, y, fz))
      } catch {}
      if (!below || !isSolid(below) || !isAir(at)) continue
      const n = bareName(below.name)
      if (n.includes('planks') || (isPlayerBuilt(below) && !FLOOR_OK.has(n))) continue
      return { x: fx, y, z: fz }
    }
  }
  return null
}

async function equipPlace(bot, item) {
  if (!item) return false
  try {
    if (typeof bot.equip === 'function') {
      await bot.equip(item, 'hand')
      return true
    }
  } catch (err) {
    plog('place equip fail ' + (err && err.message))
  }
  return true
}

export async function placeNamed(bot, state, name) {
  if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
    await leaveSpawnForGather(bot, state)
    if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
      plog('place refuse spawn')
      return false
    }
  }
  const item = findPlaceable(bot, name)
  if (!item) {
    plog('place no item ' + (name || 'held') + ' inv=' + inventorySummary(bot))
    return false
  }
  await equipPlace(bot, item)
  const dest = pickDest(bot)
  if (!dest) {
    plog('place no dest')
    return false
  }
  stopPath(bot)
  try { await gotoNear(bot, dest.x, dest.y, dest.z, 3, 6000) } catch {}
  const res = await placeAt(bot, dest.x, dest.y, dest.z)
  if (res === true) {
    state.houseBlocks = (state.houseBlocks || 0) + 1
    state.note = 'placed ' + resolveItemName(bot, item)
    return true
  }
  return false
}

export async function placeHeld(bot, state) {
  state.phase = 'place'
  state.note = 'place one'
  return placeNamed(bot, state, state.placeName || null)
}

export async function run(bot, state) {
  return placeHeld(bot, state)
}
