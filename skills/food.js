import { plog, sleep, posOf, bareName, resolveItemName, eachInventoryItem, inventorySummary, horizFromOrigin, stopPath, sayAllowed, gotoNear, SPAWN_SAFE_R, SAND_SCAN_R } from './lib.js'
import { collectViaPlugin, leaveSpawnForGather, exploreNewDir } from './collect.js'
import { nearestHostile, fleeHostile } from './flee.js'

const FOOD_ITEMS = new Set([
  'sweet_berries', 'glow_berries', 'apple', 'bread',
  'carrot', 'potato', 'baked_potato', 'melon_slice',
  'porkchop', 'cooked_porkchop',
  'beef', 'cooked_beef',
  'chicken', 'cooked_chicken',
  'mutton', 'cooked_mutton'
])
const FOOD_MOBS = new Set(['cow', 'pig', 'chicken', 'sheep'])

function isFoodName(n) {
  const s = bareName(n)
  if (!s) return false
  if (FOOD_ITEMS.has(s)) return true
  return s.startsWith('cooked_')
}

export function countFood(bot) {
  let n = 0
  eachInventoryItem(bot, (it) => {
    if (isFoodName(resolveItemName(bot, it))) n += Number(it.count) || 0
  })
  return n
}

export async function tryEat(bot) {
  try {
    if (bot.food != null && bot.food >= 18) return false
    if (countFood(bot) < 1) return false
    if (bot.autoEat && typeof bot.autoEat.eat === 'function' && !bot.autoEat.isEating) {
      const before = Number(bot.food)
      await bot.autoEat.eat()
      const after = Number(bot.food)
      plog('ate food=' + after + ' was=' + before)
      return Number.isFinite(before) && Number.isFinite(after) && after > before
    }
  } catch (err) {
    const msg = err && err.message
    if (msg && !/no food|cannot eat|not hungry/i.test(msg)) plog('eat fail ' + msg)
  }
  return false
}

function droppedItemName(bot, e) {
  if (!e) return ''
  try {
    if (typeof e.getDroppedItem === 'function') {
      const it = e.getDroppedItem()
      if (it) return resolveItemName(bot, it) || bareName(it.name)
    }
  } catch {}
  return ''
}

function isItemEntity(e) {
  if (!e) return false
  const t = String(e.name || e.type || '').toLowerCase()
  return t === 'item' || t === 'object' || (e.getDroppedItem && typeof e.getDroppedItem === 'function')
}

function nearestFoodDrop(bot, maxD = SAND_SCAN_R) {
  const pos = bot.entity && bot.entity.position
  if (!pos) return null
  let best = null
  let bestD = maxD
  try {
    for (const e of Object.values(bot.entities || {})) {
      if (!e || !e.position || !isItemEntity(e)) continue
      const n = droppedItemName(bot, e)
      if (n && !isFoodName(n)) continue
      if (Math.hypot(e.position.x, e.position.z) < SPAWN_SAFE_R) continue
      const d = e.position.distanceTo(pos)
      if (d < bestD) { best = e; bestD = d }
    }
  } catch {}
  return best
}

function nearestFoodMob(bot, maxD = SAND_SCAN_R) {
  const pos = bot.entity && bot.entity.position
  if (!pos) return null
  let best = null
  let bestD = maxD
  try {
    for (const e of Object.values(bot.entities || {})) {
      if (!e || !e.position) continue
      const n = String(e.name || e.displayName || '').toLowerCase()
      if (!FOOD_MOBS.has(n)) continue
      if (Math.hypot(e.position.x, e.position.z) < SPAWN_SAFE_R) continue
      const d = e.position.distanceTo(pos)
      if (d < bestD) { best = e; bestD = d }
    }
  } catch {}
  return best
}

function berryHasFruit(b) {
  if (!b || !b.name) return false
  if (bareName(b.name) !== 'sweet_berry_bush') return false
  try {
    const props = typeof b.getProperties === 'function' ? b.getProperties() : null
    if (props && props.age != null) return Number(props.age) >= 2
  } catch {}
  return true
}

export async function huntFood(bot, state) {
  state.phase = 'food'
  await tryEat(bot)
  if (countFood(bot) > 0) {
    state.foodPassed = true
    state.note = 'food inv=' + countFood(bot)
    return true
  }
  if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
    await leaveSpawnForGather(bot, state)
    if (horizFromOrigin(bot) < SPAWN_SAFE_R) return false
  }
  const creep = nearestHostile(bot, 8)
  if (creep) { await fleeHostile(bot, creep); return false }

  const drop = nearestFoodDrop(bot, SAND_SCAN_R)
  if (drop) {
    plog('food collect() drop')
    await collectViaPlugin(bot, drop, 'food-item', 10000)
    if (countFood(bot) > 0) return true
  }

  let bush = null
  try {
    const here = bot.entity && bot.entity.position
    bush = bot.findBlock({ matching: berryHasFruit, maxDistance: SAND_SCAN_R, point: here })
  } catch {}
  if (bush && bush.position && Math.hypot(bush.position.x, bush.position.z) >= SPAWN_SAFE_R) {
    plog('food collect() berry')
    await collectViaPlugin(bot, bush, 'food-berry', 12000)
    if (countFood(bot) > 0) return true
  }

  const mob = nearestFoodMob(bot, SAND_SCAN_R)
  if (mob && mob.position) {
    const id = mob.id
    const name = String(mob.name || 'mob')
    plog('food hunt mob ' + name)
    const deadline = Date.now() + 14000
    while (Date.now() < deadline && !state.dead) {
      if (state.chatMode === 'come' || state.chatMode === 'stay' || state.chatMode === 'follow') break
      const e = (bot.entities && bot.entities[id]) || null
      if (!e || !e.position) break
      if (Math.hypot(e.position.x, e.position.z) < SPAWN_SAFE_R) break
      const d = bot.entity.position.distanceTo(e.position)
      if (d > 2.8) await gotoNear(bot, e.position.x, e.position.y, e.position.z, 2, 2500)
      try { await bot.lookAt(e.position.offset(0, 0.8, 0), true) } catch {}
      try { bot.attack(e) } catch {}
      await sleep(400)
    }
    await sleep(400)
    const after = nearestFoodDrop(bot, 14)
    if (after) await collectViaPlugin(bot, after, 'food-drop', 10000)
    if (countFood(bot) > 0) return true
  }

  plog('food scan empty pos=' + (posOf(bot) && posOf(bot).str) + ' items=' + inventorySummary(bot))
  await exploreNewDir(bot, state)
  return countFood(bot) > 0
}

export async function run(bot, state) {
  return huntFood(bot, state)
}
