import { Vec3, goals, pathfinderPkg, plog, sleep, posOf, bareName, countSand, countNamed, inventorySummary, horizFromOrigin, isPlayerBuilt, isSandBlock, isLogName, looksLikeTree, stopPath, sayAllowed, isSolid, gotoNear, SPAWN_SAFE_R, SAND_SCAN_R } from './lib.js'

function applyCollectMovements(bot) {
  try {
    const Movements = pathfinderPkg.Movements
    if (!Movements || !bot.pathfinder) return
    const mv = new Movements(bot)
    mv.canDig = true
    mv.allow1by1towers = false
    mv.allowParkour = false
    mv.allowSprinting = false
    mv.maxDropDown = 1
    mv.scafoldingBlocks = []
    try {
      const names = bot.registry && bot.registry.blocksByName
      if (names) {
        for (const key of Object.keys(names)) {
          const rec = names[key]
          if (!rec || rec.id == null) continue
          if (isLogName(key)) continue
          if (isPlayerBuilt({ name: key }) || String(key).includes('planks')) {
            mv.blocksCantBreak.add(rec.id)
          }
        }
      }
    } catch {}
    if (bot.collectBlock) {
      bot.collectBlock.movements = mv
      bot.collectBlock.chestLocations = []
      bot.collectBlock.itemFilter = () => false
    }
    bot.pathfinder.setMovements(mv)
  } catch (err) {
    plog('collect movements fail ' + (err && err.message))
  }
}

export async function collectViaPlugin(bot, target, label, ms = 15000, opts = {}) {
  if (!target) return false
  if (!bot.collectBlock || typeof bot.collectBlock.collect !== 'function') {
    plog('collect() missing plugin')
    return false
  }
  const pos = target.position
  if (pos && Math.hypot(pos.x, pos.z) < SPAWN_SAFE_R) {
    plog('collect() skip spawn ' + label)
    return false
  }
  const tname = bareName(target.name)
  if (tname.includes('planks')) {
    plog('collect() skip planks ' + target.name)
    return false
  }
  if (isLogName(tname) && !looksLikeTree(bot, target) && !opts.allowLog) {
    plog('collect() skip log without leaves ' + target.name)
    return false
  }
  if (target.name && isPlayerBuilt(target) && !isLogName(tname)) {
    plog('collect() skip player-built ' + target.name)
    return false
  }
  applyCollectMovements(bot)
  const kind = target.name || 'target'
  plog('collect() ' + label + ' ' + kind + (pos ? (' at ' + pos.x + ' ' + pos.y + ' ' + pos.z) : ''))
  try {
    if (bot.tool && typeof bot.tool.equipForBlock === 'function' && target.name) {
      try { await bot.tool.equipForBlock(target, {}) } catch {}
    }
    const p = bot.collectBlock.collect(target)
    const t = sleep(ms).then(() => {
      try { if (bot.collectBlock && typeof bot.collectBlock.cancelTask === 'function') bot.collectBlock.cancelTask() } catch {}
      try { if (bot.pathfinder) bot.pathfinder.setGoal(null) } catch {}
      throw new Error('collect-timeout')
    })
    await Promise.race([p, t])
    plog('collect() done ' + label + ' inv=' + inventorySummary(bot))
    return true
  } catch (err) {
    const msg = err && err.message
    if (msg === 'collect-timeout') plog('collect() timeout ' + label)
    else if (msg) plog('collect() fail ' + label + ' ' + msg)
    try { if (bot.pathfinder) bot.pathfinder.setGoal(null) } catch {}
    return false
  }
}

export function findSand(bot, maxDistance = SAND_SCAN_R) {
  const here = bot.entity && bot.entity.position
  if (!here) return null
  const match = (b) => isSandBlock(b) && !isPlayerBuilt(b) && b.position && Math.hypot(b.position.x, b.position.z) >= SPAWN_SAFE_R
  try {
    const block = bot.findBlock({ matching: match, maxDistance, point: here })
    if (block) return block
  } catch (err) {
    plog('findBlock sand fail ' + (err && err.message))
  }
  const origin = here.floored()
  const r = Math.min(32, Math.max(8, maxDistance))
  let best = null
  let bestD = 99
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -6; dy <= 3; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        let b = null
        try { b = bot.blockAt(origin.offset(dx, dy, dz)) } catch {}
        if (!match(b)) continue
        const d = Math.hypot(dx, dy, dz)
        if (d < bestD) { best = b; bestD = d }
      }
    }
  }
  return best
}

export async function exploreNewDir(bot, state) {
  const p = bot.entity && bot.entity.position
  if (!p) return false
  const last = state.lastSandPos
  if (last && Math.hypot(p.x - last.x, p.z - last.z) < 1.5) {
    state.sandExploreDir = (state.sandExploreDir || 0) + 1
    plog('sand refuse 1x1 wander, new heading')
  }
  state.lastSandPos = { x: p.x, y: p.y, z: p.z }
  const idx = (state.sandExploreDir || 0) % 8
  state.sandExploreDir = idx + 1
  const ang = (idx / 8) * Math.PI * 2
  const dist = 22 + ((idx * 5) % 13)
  let tx = p.x + Math.cos(ang) * dist
  let tz = p.z + Math.sin(ang) * dist
  if (Math.hypot(tx, tz) < SPAWN_SAFE_R) {
    const rr = Math.hypot(tx, tz) || 1
    tx = (tx / rr) * 30
    tz = (tz / rr) * 30
  }
  plog('sand explore ' + dist + 'm heading=' + idx + ' -> ' + tx.toFixed(1) + ' ' + tz.toFixed(1))
  stopPath(bot)
  if (bot.pathfinder && goals && goals.GoalXZ) {
    try {
      const g = new goals.GoalXZ(Math.floor(tx), Math.floor(tz))
      const pth = bot.pathfinder.goto(g)
      const t = sleep(10000).then(() => { try { bot.pathfinder.setGoal(null) } catch {}; throw new Error('goto-timeout') })
      await Promise.race([pth, t])
    } catch {
      try { bot.pathfinder.setGoal(null) } catch {}
    }
  }
  return true
}

export async function huntSand(bot, state) {
  const r = horizFromOrigin(bot)
  const sand = countSand(bot)
  const dirt = countNamed(bot, ['dirt', 'grass_block'])
  state.phase = sand >= 1 ? 'hold' : 'sand'
  state.note = 'hunt sand r=' + r.toFixed(1) + ' sand=' + sand + ' dirt=' + dirt
  if (!state.saidLookingSand) {
    state.saidLookingSand = true
    sayAllowed(bot, state, 'looking for sand')
  }
  if (r < SPAWN_SAFE_R) {
    plog('sand leave-spawn first r=' + r.toFixed(1))
    await leaveSpawnForGather(bot, state)
    if (horizFromOrigin(bot) < SPAWN_SAFE_R) return false
  }
  const block = findSand(bot, SAND_SCAN_R)
  if (block) {
    plog('sand target ' + block.name + ' at ' + block.position.x + ' ' + block.position.y + ' ' + block.position.z)
    const before = countSand(bot)
    await collectViaPlugin(bot, block, 'p5-sand', 15000)
    const after = countSand(bot)
    if (after > before) {
      plog('sand PICKUP sand=' + after + ' dirt=' + dirt + ' items=' + inventorySummary(bot))
      state.note = 'PICKUP sand=' + after + ' dirt=' + dirt
      return true
    }
    return false
  }
  plog('no sand in ' + SAND_SCAN_R + ' pos=' + (posOf(bot) && posOf(bot).str) + ' explore')
  await exploreNewDir(bot, state)
  return false
}

export async function run(bot, state) {
  return huntSand(bot, state)
}

const BLOCK_ALIASES = {
  sand: ['sand', 'red_sand'],
  dirt: ['dirt', 'grass_block'],
  gravel: ['gravel'],
  sandstone: ['sandstone', 'red_sandstone'],
  cobblestone: ['cobblestone', 'stone'],
  cobble: ['cobblestone', 'stone'],
  stone: ['stone', 'cobblestone']
}

function isAirBlock(b) {
  const n = bareName(b && b.name)
  return !b || n === 'air' || n === 'cave_air' || n === 'void_air'
}

function columnSurfaceY(bot, x, z, fromY) {
  const y0 = Math.floor(fromY)
  for (let y = y0 + 1; y >= y0 - 8; y--) {
    let b = null
    let a = null
    try {
      b = bot.blockAt(new Vec3(x, y, z))
      a = bot.blockAt(new Vec3(x, y + 1, z))
    } catch {}
    if (b && isSolid(b) && isAirBlock(a)) return y + 1
  }
  return null
}

function underFeet(bot) {
  const p = bot.entity && bot.entity.position
  if (!p) return null
  try { return bot.blockAt(new Vec3(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z))) } catch { return null }
}

function isPerch(bot) {
  const p = bot.entity && bot.entity.position
  if (!p) return false
  if (p.y >= 100) return true
  const u = underFeet(bot)
  const n = bareName(u && u.name)
  if (!n) return false
  if (isPlayerBuilt(u) || n.includes('planks') || n.includes('slab') || n.includes('stair') || n.includes('wool')) return true
  return false
}

export async function leaveRoof(bot, state) {
  const p = bot.entity && bot.entity.position
  if (!p) return false
  if (!isPerch(bot) && p.y < 108) return false
  const fx = Math.floor(p.x)
  const fy = Math.floor(p.y)
  const fz = Math.floor(p.z)
  const u = underFeet(bot)
  plog('leave roof perch y=' + fy + ' under=' + ((u && u.name) || '?') + ' toward camp 32,0')
  state.note = 'off roof y=' + fy + ' -> camp'
  let stair = null
  try {
    stair = bot.findBlock({
      matching: (b) => {
        const n = bareName(b && b.name)
        return n.includes('stairs') || n === 'ladder'
      },
      maxDistance: 16,
      point: p
    })
  } catch {}
  if (stair && stair.position) {
    plog('leave roof via ' + stair.name + ' at ' + stair.position.x + ' ' + stair.position.y + ' ' + stair.position.z)
    try { await gotoNear(bot, stair.position.x, stair.position.y, stair.position.z, 1, 4000) } catch {}
    try {
      await bot.lookAt(stair.position.offset(0.5, 0.2, 0.5), true)
      bot.setControlState('forward', true)
      await sleep(2500)
    } catch {}
    try { bot.setControlState('forward', false) } catch {}
    return true
  }
  const dirs = [[1, 0], [2, 0], [1, 1], [1, -1], [2, 1], [2, -1], [0, 1], [0, -1], [3, 0], [-1, 0], [0, 2], [0, -2]]
  let best = null
  let bestScore = -999
  for (const [dx, dz] of dirs) {
    const nx = fx + dx
    const nz = fz + dz
    const sy = columnSurfaceY(bot, nx, nz, fy)
    if (sy == null) continue
    if (sy > fy) continue
    const drop = fy - sy
    if (drop > 2) continue
    const toward = -Math.hypot(nx - 32, nz - 0)
    const score = drop * 8 + toward
    if (score > bestScore) { bestScore = score; best = { x: nx, y: sy, z: nz, drop } }
  }
  if (best) {
    plog('leave roof step drop=' + best.drop + ' to ' + best.x + ' ' + best.y + ' ' + best.z)
    try { await gotoNear(bot, best.x + 0.5, best.y, best.z + 0.5, 1, 5000) } catch {}
    return true
  }
  try {
    const yaw = Math.atan2(-(32 - p.x), (0 - p.z))
    await bot.look(yaw, 0, true)
    bot.setControlState('forward', true)
    bot.setControlState('sprint', false)
    await sleep(1600)
  } catch {}
  try {
    bot.setControlState('forward', false)
    bot.setControlState('jump', false)
  } catch {}
  return true
}

export async function leaveSpawnForGather(bot, state) {
  const p = bot.entity && bot.entity.position
  if (!p) return false
  const r0 = horizFromOrigin(bot)
  if (r0 >= SPAWN_SAFE_R && (p.y < 102)) return true
  const tx = 32
  const tz = 0
  plog('collect leave-spawn r=' + r0.toFixed(1) + ' y=' + p.y.toFixed(1) + ' -> camp 32,0')
  state.phase = 'leave-spawn'
  state.note = 'leaving spawn toward camp 32,0'
  if (p.y >= 100 || isPerch(bot)) {
    try { await leaveRoof(bot, state) } catch (err) { plog('leave roof fail ' + (err && err.message)) }
  } else if (bot.pathfinder && goals && goals.GoalXZ) {
    try {
      const g = new goals.GoalXZ(tx, tz)
      const pth = bot.pathfinder.goto(g)
      const t = sleep(10000).then(() => { try { bot.pathfinder.setGoal(null) } catch {}; throw new Error('goto-timeout') })
      await Promise.race([pth, t])
    } catch {
      try { bot.pathfinder.setGoal(null) } catch {}
    }
  }
  const here = bot.entity && bot.entity.position
  const ok = horizFromOrigin(bot) >= SPAWN_SAFE_R && here && here.y < 102
  if (!ok) await sleep(400)
  return ok
}

export function findNamedBlock(bot, name, maxDistance = SAND_SCAN_R) {
  const want = bareName(name)
  const names = new Set(BLOCK_ALIASES[want] || [want])
  const here = bot.entity && bot.entity.position
  if (!here) return null
  const match = (b) => {
    const n = bareName(b && b.name)
    if (!names.has(n)) return false
    if (isPlayerBuilt(b) || n.includes('planks')) return false
    if (b.position && Math.hypot(b.position.x, b.position.z) < SPAWN_SAFE_R) return false
    return true
  }
  try {
    const block = bot.findBlock({ matching: match, maxDistance, point: here })
    if (block) return block
  } catch (err) {
    plog('findBlock ' + want + ' fail ' + (err && err.message))
  }
  return null
}

export async function huntBlock(bot, state, blockName) {
  const name = bareName(blockName || state.collectName || 'sand')
  if (!name || name === 'sand' || name === 'red_sand') return huntSand(bot, state)
  const r = horizFromOrigin(bot)
  state.phase = 'collect'
  state.note = 'hunt ' + name + ' r=' + r.toFixed(1)
  if (r < SPAWN_SAFE_R) {
    await leaveSpawnForGather(bot, state)
    if (horizFromOrigin(bot) < SPAWN_SAFE_R) return false
  }
  const block = findNamedBlock(bot, name, SAND_SCAN_R)
  if (block) {
    plog('collect target ' + block.name)
    const before = countNamed(bot, [bareName(block.name)])
    await collectViaPlugin(bot, block, 'cmd-' + name, 15000)
    const after = countNamed(bot, [bareName(block.name)])
    if (after > before) {
      plog('collect PICKUP ' + name + '=' + after + ' items=' + inventorySummary(bot))
      state.note = 'PICKUP ' + name + '=' + after
      return true
    }
    return false
  }
  plog('no ' + name + ' in ' + SAND_SCAN_R + ' explore')
  await exploreNewDir(bot, state)
  return false
}
