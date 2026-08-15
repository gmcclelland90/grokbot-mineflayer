import { Vec3, goals, pathfinderPkg, plog, sleep, posOf, bareName, countSand, countNamed, countLogs, inventorySummary, horizFromOrigin, isSolid, isPlayerBuilt, stopPath, sayAllowed, findPlayerNamed, SPAWN_SAFE_R } from './lib.js'
import { huntSand, huntBlock, leaveSpawnForGather } from './collect.js'
import { punchTree } from './wood.js'
import { placeAt } from './place.js'
import { buildNamed, countBuildMaterials, hutSolidCount } from './build.js'
import { runCamp, campSolidCount } from './camp.js'
import { runFarm } from './farm.js'
import { lookAtNearest } from './look.js'
import { goToSleep, wakeUp, shouldSleep, isNightOrThunder } from './sleep.js'

const BUSY = new Set(['stay', 'follow', 'come', 'collect', 'wood', 'craft', 'table', 'shovel', 'pick', 'place', 'build', 'camp', 'farm', 'sleep', 'guard'])
const DOODLE_ITEMS = ['dirt', 'grass_block', 'sand', 'red_sand', 'sandstone', 'cobblestone']
const SOCIAL_CD_MS = 60000
const SOCIAL_LINES = ['hi', 'hey', 'found dirt', 'looking around', 'nice spot']

function preempted(state) {
  return !!(state && BUSY.has(state.chatMode))
}

function applyWanderMovements(bot) {
  try {
    const Movements = pathfinderPkg.Movements
    if (!Movements || !bot.pathfinder) return
    const mv = new Movements(bot)
    mv.canDig = false
    mv.allow1by1towers = false
    mv.allowParkour = false
    mv.allowSprinting = false
    mv.maxDropDown = 1
    mv.scafoldingBlocks = []
    bot.pathfinder.setMovements(mv)
  } catch (err) {
    plog('fun wander movements fail ' + (err && err.message))
  }
}

function cliffAt(bot, x, z, fromY, maxDrop = 1) {
  const fx = Math.floor(x)
  const fz = Math.floor(z)
  const y0 = Math.floor(fromY)
  for (let dy = 0; dy <= maxDrop + 1; dy++) {
    let b = null
    try { b = bot.blockAt(new Vec3(fx, y0 - dy, fz)) } catch {}
    if (b && isSolid(b)) return false
  }
  return true
}

function nearbyOther(bot, maxD = 12) {
  const pos = bot.entity && bot.entity.position
  if (!pos) return null
  const me = String(bot.username || 'steve').toLowerCase()
  let best = null
  let bestD = maxD
  try {
    for (const e of Object.values(bot.entities || {})) {
      if (!e || !e.position) continue
      const n = String(e.username || e.name || '').toLowerCase()
      if (n === me || n === 'steve') continue
      const isPlayer = e.type === 'player' || e.username
      if (!isPlayer) continue
      const d = e.position.distanceTo(pos)
      if (d < bestD) { best = e; bestD = d }
    }
  } catch {}
  if (best) return best
  try {
    for (const [name, pl] of Object.entries(bot.players || {})) {
      const n = String(name).toLowerCase()
      if (n === me || n === 'steve') continue
      if (pl && pl.entity && pl.entity.position) {
        const d = pl.entity.position.distanceTo(pos)
        if (d < bestD) { best = pl.entity; bestD = d }
      }
    }
  } catch {}
  return best
}

function findDoodleItem(bot) {
  try {
    const held = bot.heldItem
    if (held && DOODLE_ITEMS.includes(bareName(held.name))) return held
  } catch {}
  try {
    const items = bot.inventory && typeof bot.inventory.items === 'function' ? bot.inventory.items() : []
    for (const it of items) {
      if (it && DOODLE_ITEMS.includes(bareName(it.name))) return it
    }
  } catch {}
  return null
}

function pickGoal(bot, state) {
  const recent = state.funRecent || []
  const sand = countSand(bot)
  const dirt = countNamed(bot, ['dirt', 'grass_block'])
  const logs = countLogs(bot)
  const buildN = countBuildMaterials(bot)
  const need = hutSolidCount()
  const campNeed = campSolidCount()
  if (!state.funStarted) {
    state.funStarted = true
    if (!state.campBuilt) return 'camp'
    return 'wander'
  }
  if (!state.campBuilt) return 'camp'
  if (state.campBuilt && !state.farmReady) return 'farm'
  const pool = ['wander']
  if (sand < 8 || dirt < 8) pool.push('collect')
  if (logs < 1) pool.push('wood')
  if (sand + dirt >= 1) pool.push('doodle')
  if (need > 0 && buildN >= need) pool.push('hut')
  if (state.farmReady || state.treesReady) pool.push('farm')
  const other = nearbyOther(bot, 12)
  if (other && Date.now() - (state.funSaidAt || 0) >= SOCIAL_CD_MS) pool.push('social')
  if (shouldSleep(bot)) pool.push('sleep')
  const fresh = pool.filter((g) => !recent.includes(g))
  const use = fresh.length ? fresh : pool
  return use[Math.floor(Math.random() * use.length)]
}

function remember(state, goal) {
  const recent = state.funRecent || []
  recent.push(goal)
  while (recent.length > 3) recent.shift()
  state.funRecent = recent
}

function mark(bot, state, goal, note) {
  state.phase = goal
  state.smState = goal
  state.note = note
  plog('fun ' + goal + ' ' + note + ' pos=' + (posOf(bot) && posOf(bot).str) + ' inv=' + inventorySummary(bot))
}

async function wander(bot, state) {
  const p = bot.entity && bot.entity.position
  if (!p) return false
  if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
    mark(bot, state, 'wander', 'leave spawn then wander')
    await leaveSpawnForGather(bot, state)
    if (preempted(state)) return false
  }
  applyWanderMovements(bot)
  const y = p.y
  for (let i = 0; i < 8; i++) {
    if (preempted(state)) return false
    const dist = 12 + Math.floor(Math.random() * 17)
    const ang = Math.random() * Math.PI * 2
    let tx = p.x + Math.cos(ang) * dist
    let tz = p.z + Math.sin(ang) * dist
    const rr = Math.hypot(tx, tz)
    if (rr < SPAWN_SAFE_R) {
      const s = rr || 1
      tx = (tx / s) * (SPAWN_SAFE_R + 8)
      tz = (tz / s) * (SPAWN_SAFE_R + 8)
    }
    if (cliffAt(bot, tx, tz, y, 1)) continue
    mark(bot, state, 'wander', 'goto ' + dist + 'm r>=' + SPAWN_SAFE_R)
    stopPath(bot)
    if (bot.pathfinder && goals && goals.GoalXZ) {
      try {
        const g = new goals.GoalXZ(Math.floor(tx), Math.floor(tz))
        const pth = bot.pathfinder.goto(g)
        const t = sleep(9000).then(() => { try { bot.pathfinder.setGoal(null) } catch {}; throw new Error('goto-timeout') })
        await Promise.race([pth, t])
      } catch {
        try { bot.pathfinder.setGoal(null) } catch {}
      }
    }
    return true
  }
  mark(bot, state, 'wander', 'no safe dest')
  await sleep(400)
  return false
}

async function gather(bot, state) {
  const sand = countSand(bot)
  const dirt = countNamed(bot, ['dirt', 'grass_block'])
  mark(bot, state, 'collect', 'gather sand=' + sand + ' dirt=' + dirt)
  if (sand < 4) return huntSand(bot, state)
  if (dirt < 4) return huntBlock(bot, state, 'dirt')
  return huntSand(bot, state)
}

async function woodOnce(bot, state) {
  mark(bot, state, 'wood', 'punch a tree')
  return punchTree(bot, state)
}

async function doodle(bot, state) {
  if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
    await leaveSpawnForGather(bot, state)
    if (horizFromOrigin(bot) < SPAWN_SAFE_R || preempted(state)) return false
  }
  const item = findDoodleItem(bot)
  if (!item) {
    mark(bot, state, 'doodle', 'no blocks')
    return false
  }
  try { if (typeof bot.equip === 'function') await bot.equip(item, 'hand') } catch {}
  const p = bot.entity && bot.entity.position
  if (!p) return false
  const n = 1 + Math.floor(Math.random() * 3)
  const wall = Math.random() < 0.5
  const yaw = bot.entity.yaw || 0
  const dx = Math.round(-Math.sin(yaw)) || 1
  const dz = Math.round(-Math.cos(yaw))
  let placed = 0
  mark(bot, state, 'doodle', (wall ? 'wall' : 'pillar') + ' n=' + n)
  stopPath(bot)
  for (let i = 0; i < n; i++) {
    if (preempted(state)) break
    const fx = Math.floor(p.x + dx * (wall ? 1 : 1) + (wall ? dz * i : 0))
    const fz = Math.floor(p.z + dz * (wall ? 1 : 1) + (wall ? -dx * i : 0))
    const fy = Math.floor(p.y) + (wall ? 0 : i)
    if (Math.hypot(fx, fz) < SPAWN_SAFE_R) continue
    let below = null
    let at = null
    try {
      below = bot.blockAt(new Vec3(fx, fy - 1, fz))
      at = bot.blockAt(new Vec3(fx, fy, fz))
    } catch {}
    if (below && (isPlayerBuilt(below) || bareName(below.name).includes('planks'))) continue
    if (at && (isPlayerBuilt(at) || bareName(at.name).includes('planks'))) continue
    const res = await placeAt(bot, fx, fy, fz)
    if (res === true) placed++
    await sleep(80)
  }
  state.note = 'doodle placed=' + placed
  plog('fun doodle placed=' + placed)
  return placed > 0
}

async function hutOnce(bot, state) {
  const need = hutSolidCount()
  const have = countBuildMaterials(bot)
  if (have < need) {
    mark(bot, state, 'hut', 'skip need=' + need + ' have=' + have)
    return false
  }
  mark(bot, state, 'hut', 'build hut have=' + have)
  return buildNamed(bot, state, 'hut')
}

async function campOnce(bot, state) {
  mark(bot, state, 'camp', 'gather then palisade at 32,surface,0')
  return runCamp(bot, state)
}

async function farmOnce(bot, state) {
  if (!state.farmReady) state.farmKind = 'wheat'
  else if (!state.treesReady && Math.random() < 0.4) state.farmKind = 'trees'
  else state.farmKind = 'tend'
  mark(bot, state, 'farm', 'farm ' + state.farmKind)
  return runFarm(bot, state)
}

async function social(bot, state) {
  const other = nearbyOther(bot, 12) || findPlayerNamed(bot, null)
  if (!other || !other.position) {
    mark(bot, state, 'social', 'nobody near')
    return false
  }
  if (Date.now() - (state.funSaidAt || 0) < SOCIAL_CD_MS) return false
  mark(bot, state, 'social', 'wave')
  try { await bot.lookAt(other.position.offset(0, 1.6, 0), true) } catch {}
  const sand = countSand(bot)
  const dirt = countNamed(bot, ['dirt', 'grass_block'])
  let line = SOCIAL_LINES[Math.floor(Math.random() * SOCIAL_LINES.length)]
  if (dirt > 0 && Math.random() < 0.5) line = 'found dirt'
  else if (sand > 0 && Math.random() < 0.5) line = 'found sand'
  sayAllowed(bot, state, line)
  state.funSaidAt = Date.now()
  await sleep(600)
  return true
}

export async function funTick(bot, state) {
  if (preempted(state)) return false
  lookAtNearest(bot)
  if (bot.isSleeping && !isNightOrThunder(bot)) {
    try { await wakeUp(bot, state) } catch {}
  }
  if (bot.armorManager && typeof bot.armorManager.equipAll === 'function') {
    try { await bot.armorManager.equipAll() } catch {}
  }
  const goal = pickGoal(bot, state)
  remember(state, goal)
  mark(bot, state, goal === 'collect' ? 'collect' : goal, 'pick ' + goal)
  try {
    if (goal === 'wander') await wander(bot, state)
    else if (goal === 'collect') await gather(bot, state)
    else if (goal === 'wood') await woodOnce(bot, state)
    else if (goal === 'doodle') await doodle(bot, state)
    else if (goal === 'hut') await hutOnce(bot, state)
    else if (goal === 'camp') await campOnce(bot, state)
    else if (goal === 'farm') await farmOnce(bot, state)
    else if (goal === 'social') await social(bot, state)
    else if (goal === 'sleep') await goToSleep(bot, state)
  } catch (err) {
    plog('fun ' + goal + ' fail ' + (err && err.message))
  }
  return true
}

export async function run(bot, state) {
  return funTick(bot, state)
}
