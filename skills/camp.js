import { Vec3, plog, sleep, posOf, countNamed, countLogs, countPlanks, inventorySummary, horizFromOrigin, findItemByNames, gotoNear, stopPath, sayAllowed, SPAWN_SAFE_R, pathfinderPkg, goals } from './lib.js'
import { leaveSpawnForGather, huntBlock } from './collect.js'
import { punchTree } from './wood.js'
import { placeAt } from './place.js'
import { buildNamedAt, countBuildMaterials, findGroundY, schemSolidCount } from './build.js'
import { craftByName, craftSticks, craftPlanks } from './craft.js'
import { CAMP_XZ, markCamp, recordChest } from './storage.js'
import { catalogNearby, ensureDumpChests } from './chest.js'

export function campSolidCount() {
  return schemSolidCount('camp') || 46
}

export function campXZ() {
  return { x: CAMP_XZ.x, z: CAMP_XZ.z }
}

export function resolveCampOrigin(bot, guessY) {
  const x = CAMP_XZ.x
  const z = CAMP_XZ.z
  const p = bot.entity && bot.entity.position
  const g = guessY != null ? guessY : (p ? p.y : 80)
  const y = findGroundY(bot, x + 3, z + 3, g)
  return { x, y, z }
}

function applyCampWalkMovements(bot) {
  try {
    const Movements = pathfinderPkg.Movements
    if (!Movements || !bot.pathfinder) return
    const mv = new Movements(bot)
    mv.canDig = false
    mv.allow1by1towers = false
    mv.allowParkour = false
    mv.allowSprinting = false
    mv.maxDropDown = 4
    mv.scafoldingBlocks = []
    bot.pathfinder.setMovements(mv)
  } catch {}
}

function campColumnY(bot, x, z, fromY) {
  const y0 = Math.floor(fromY)
  for (let y = y0 + 2; y >= y0 - 8; y--) {
    let b = null
    let a = null
    try {
      b = bot.blockAt(new Vec3(x, y, z))
      a = bot.blockAt(new Vec3(x, y + 1, z))
    } catch {}
    if (b && b.boundingBox === 'block' && (!a || a.boundingBox !== 'block')) return y + 1
  }
  return null
}

async function stepTowardCamp(bot) {
  const p = bot.entity && bot.entity.position
  if (!p) return false
  const fx = Math.floor(p.x)
  const fy = Math.floor(p.y)
  const fz = Math.floor(p.z)
  const dirs = [[1, 0], [1, 1], [0, 1], [2, 0], [1, -1], [2, 1], [0, 2], [2, -1], [3, 0], [0, -1], [-1, 1], [3, 1], [3, -1]]
  let best = null
  let bestScore = -999
  for (const [dx, dz] of dirs) {
    const nx = fx + dx
    const nz = fz + dz
    const sy = campColumnY(bot, nx, nz, fy)
    if (sy == null) continue
    const drop = fy - sy
    if (drop > 4 || sy > fy + 1) continue
    const toward = -Math.hypot(nx - CAMP_XZ.x, nz - CAMP_XZ.z)
    const score = toward + drop * 0.4
    if (score > bestScore) { bestScore = score; best = { x: nx, y: sy, z: nz, drop } }
  }
  if (!best) return false
  plog('camp step drop=' + best.drop + ' to ' + best.x + ' ' + best.y + ' ' + best.z)
  try { await gotoNear(bot, best.x + 0.5, best.y, best.z + 0.5, 1, 5000) } catch {}
  return true
}

async function walkToCampSite(bot, state) {
  applyCampWalkMovements(bot)
  for (let attempt = 0; attempt < 6; attempt++) {
    const p = bot.entity && bot.entity.position
    if (!p) return false
    const d0 = Math.hypot(p.x - CAMP_XZ.x, p.z - CAMP_XZ.z)
    if (d0 <= 5) return true
    state.note = 'walk to camp 32,0 d=' + d0.toFixed(1)
    plog('camp walk attempt=' + attempt + ' d=' + d0.toFixed(1) + ' pos=' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ' ' + p.z.toFixed(1))
    applyCampWalkMovements(bot)
    try {
      if (bot.pathfinder && goals && goals.GoalXZ) {
        const g = new goals.GoalXZ(CAMP_XZ.x, CAMP_XZ.z)
        const pth = bot.pathfinder.goto(g)
        const t = sleep(7000).then(() => { try { bot.pathfinder.setGoal(null) } catch {}; throw new Error('goto-timeout') })
        await Promise.race([pth, t])
      }
    } catch {
      try { bot.pathfinder.setGoal(null) } catch {}
    }
    const mid = bot.entity && bot.entity.position
    const moved = mid && Math.hypot(mid.x - p.x, mid.z - p.z) >= 0.8
    const d1 = mid ? Math.hypot(mid.x - CAMP_XZ.x, mid.z - CAMP_XZ.z) : 99
    if (d1 <= 5) return true
    if (!moved) {
      const stepped = await stepTowardCamp(bot)
      if (!stepped) {
        try {
          const yaw = Math.atan2(-(CAMP_XZ.x - mid.x), (CAMP_XZ.z - mid.z))
          await bot.look(yaw, 0, true)
          bot.setControlState('forward', true)
          bot.setControlState('jump', false)
          await sleep(1800)
          bot.setControlState('forward', false)
        } catch {}
      }
    }
  }
  const now = bot.entity && bot.entity.position
  const d = now ? Math.hypot(now.x - CAMP_XZ.x, now.z - CAMP_XZ.z) : 99
  plog('camp at site d=' + d.toFixed(1) + ' pos=' + (now ? now.x.toFixed(1) + ' ' + now.y.toFixed(1) + ' ' + now.z.toFixed(1) : '?'))
  return d <= 8
}

async function placeStubWall(bot, state, origin) {
  const item = findItemByNames(bot, ['dirt', 'grass_block', 'cobblestone'])
  if (!item) return 0
  try { if (typeof bot.equip === 'function') await bot.equip(item, 'hand') } catch {}
  const p = bot.entity && bot.entity.position
  if (!p) return 0
  const fx = Math.floor(p.x)
  const fy = Math.floor(p.y)
  const fz = Math.floor(p.z)
  const spots = [
    [fx + 1, fy, fz],
    [fx + 1, fy + 1, fz],
    [fx, fy, fz + 1],
    [fx + 1, fy, fz + 1],
    [fx + 2, fy, fz],
    [origin.x, origin.y, origin.z]
  ]
  let n = 0
  for (const [x, y, z] of spots) {
    if (Math.hypot(x, z) < SPAWN_SAFE_R) continue
    const res = await placeAt(bot, x, y, z)
    if (res === true) n++
    if (n >= 4) break
  }
  state.houseBlocks = (state.houseBlocks || 0) + n
  plog('camp stub wall placed=' + n + ' at ' + fx + ' ' + fy + ' ' + fz)
  return n
}

async function gatherWalls(bot, state, need) {
  let have = countBuildMaterials(bot)
  // 8 blocks is enough to start a wall. Extra collect() here OOMs 1.21.11.
  if (have >= Math.min(8, need)) return have
  plog('camp gather walls have=' + have + ' need=' + need)
  for (let i = 0; i < 8 && have < need && !state.dead; i++) {
    if (state.chatMode && state.chatMode !== 'camp' && state.chatMode !== 'build') break
    if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
      await leaveSpawnForGather(bot, state)
    }
    const dirt = countNamed(bot, ['dirt', 'grass_block', 'cobblestone'])
    if (dirt < need) {
      try { await huntBlock(bot, state, 'dirt') } catch {}
    }
    have = countBuildMaterials(bot)
    if (have >= need) break
    if (countLogs(bot) < 2) {
      try { await punchTree(bot, state) } catch {}
    }
    have = countBuildMaterials(bot)
  }
  return countBuildMaterials(bot)
}

async function maybeChest(bot, state, origin) {
  if (countNamed(bot, ['chest']) < 1) {
    if (countLogs(bot) < 3 && countPlanks(bot) < 12) {
      try { await punchTree(bot, state) } catch {}
      try { await punchTree(bot, state) } catch {}
    }
    try { await craftPlanks(bot, state) } catch {}
    try { await craftByName(bot, state, 'chest', 1) } catch {}
  }
  if (countNamed(bot, ['chest']) < 1) {
    plog('camp skip chest (none)')
    return false
  }
  const item = findItemByNames(bot, ['chest'])
  if (!item) return false
  try { if (typeof bot.equip === 'function') await bot.equip(item, 'hand') } catch {}
  const x = origin.x + 3
  const y = origin.y
  const z = origin.z + 3
  if (Math.hypot(x, z) < SPAWN_SAFE_R) return false
  try { await gotoNear(bot, x, y, z, 3, 6000) } catch {}
  const res = await placeAt(bot, x, y, z)
  if (res === true || res === 'exists') {
    recordChest({ x, y, z })
    try { await catalogNearby(bot, state) } catch {}
    plog('camp chest at ' + x + ' ' + y + ' ' + z + ' res=' + res)
    state.note = 'camp chest at ' + x + ',' + y + ',' + z
    return true
  }
  plog('camp chest place fail')
  return false
}

async function maybeTorches(bot, state, origin) {
  let torches = countNamed(bot, ['torch'])
  if (torches < 1) {
    const fuel = countNamed(bot, ['coal', 'charcoal'])
    if (fuel >= 1) {
      try { await craftSticks(bot, state, 1) } catch {}
      if (countNamed(bot, ['stick']) >= 1) {
        try { await craftByName(bot, state, 'torch', 4) } catch {}
      }
    }
  }
  torches = countNamed(bot, ['torch'])
  if (torches < 1) {
    plog('camp skip torches (none)')
    return 0
  }
  const item = findItemByNames(bot, ['torch'])
  if (!item) return 0
  try { if (typeof bot.equip === 'function') await bot.equip(item, 'hand') } catch {}
  const corners = [[0, 2, 0], [6, 2, 0], [0, 2, 6], [6, 2, 6]]
  let n = 0
  for (const [dx, dy, dz] of corners) {
    const x = origin.x + dx
    const y = origin.y + dy
    const z = origin.z + dz
    if (Math.hypot(x, z) < SPAWN_SAFE_R) continue
    try { await gotoNear(bot, x, y, z, 3, 4000) } catch {}
    const res = await placeAt(bot, x, y, z)
    if (res === true) n++
    await sleep(80)
  }
  plog('camp torches placed=' + n)
  return n
}

export async function runCamp(bot, state) {
  state.phase = 'camp'
  state.note = 'camp gather/build at 32,surface,0'
  state.buildName = 'camp'
  if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
    await leaveSpawnForGather(bot, state)
    if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
      plog('camp refuse spawn, wait')
      await sleep(2000)
      return false
    }
  }
  const need = campSolidCount()
  const have = await gatherWalls(bot, state, need)
  // Pathfinder on this grass hill OOMs and never reaches 32,0. If we are
  // already r>=24 with dirt, plant a stub wall here — no goto.
  if (horizFromOrigin(bot) >= SPAWN_SAFE_R && have >= Math.min(8, need)) {
    const here = bot.entity && bot.entity.position
    const origin = { x: Math.floor(here.x) + 1, y: Math.floor(here.y), z: Math.floor(here.z) }
    if (Math.hypot(origin.x, origin.z) < SPAWN_SAFE_R) origin.x = 24
    state.campOrigin = origin
    markCamp(origin)
    plog('camp stub at ' + origin.x + ' ' + origin.y + ' ' + origin.z + ' have=' + have)
    const n = await placeStubWall(bot, state, origin)
    if (n > 0) {
      state.campBuilt = true
      state.guardPos = origin
      state.note = 'camp stub placed=' + n + ' at ' + origin.x + ',' + origin.y + ',' + origin.z
      try { await ensureDumpChests(bot, state) } catch (err) { plog('camp dump skip ' + (err && err.message)) }
      sayAllowed(bot, state, 'camp up')
      plog('camp stub done placed=' + n + ' inv=' + inventorySummary(bot))
      return true
    }
  }
  const reached = await walkToCampSite(bot, state)
  const here = bot.entity && bot.entity.position
  let origin
  if (reached) {
    origin = resolveCampOrigin(bot, here && here.y)
  } else if (here && horizFromOrigin(bot) >= SPAWN_SAFE_R) {
    // Path to 32,0 is blocked by the grass hill. Plant the palisade at the
    // reachable r>=24 foothold so walls actually exist.
    let ox = Math.floor(here.x) + 2
    let oz = Math.floor(here.z)
    if (Math.hypot(ox, oz) < SPAWN_SAFE_R) ox = Math.max(24, ox)
    origin = { x: ox, y: Math.floor(here.y), z: oz }
    plog('camp fallback origin at bot ' + origin.x + ' ' + origin.y + ' ' + origin.z)
  } else {
    plog('camp not at site, retry later')
    state.note = 'camp walk failed, retry'
    return false
  }
  if (Math.hypot(origin.x, origin.z) < SPAWN_SAFE_R) {
    plog('camp origin inside spawn, abort')
    return false
  }
  state.campOrigin = origin
  markCamp(origin)
  if (have < Math.min(8, need)) {
    state.note = 'camp gathering dirt have=' + have + ' need=' + need
    plog(state.note + ' pos=' + (posOf(bot) && posOf(bot).str))
    return false
  }
  plog('camp build at ' + origin.x + ' ' + origin.y + ' ' + origin.z + ' have=' + have + ' need=' + need)
  const ok = await buildNamedAt(bot, state, 'camp', origin)
  if (ok) {
    state.campBuilt = true
    state.guardPos = { x: origin.x + 3, y: origin.y, z: origin.z + 3 }
    try { await maybeTorches(bot, state, origin) } catch (err) {
      plog('camp torch skip ' + (err && err.message))
    }
    try { await ensureDumpChests(bot, state) } catch (err) {
      plog('camp dump skip ' + (err && err.message))
    }
    state.note = state.note && String(state.note).includes('chest') ? state.note : ('camp up at ' + origin.x + ' ' + origin.y + ' ' + origin.z)
    sayAllowed(bot, state, 'camp up')
  }
  plog('camp done ok=' + !!ok + ' inv=' + inventorySummary(bot))
  return !!ok
}

export async function run(bot, state) {
  return runCamp(bot, state)
}
