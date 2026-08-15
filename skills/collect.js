import { Vec3, goals, pathfinderPkg, plog, sleep, posOf, bareName, countSand, countNamed, inventorySummary, horizFromOrigin, isPlayerBuilt, isSandBlock, stopPath, sayAllowed, SPAWN_SAFE_R, SAND_SCAN_R } from './lib.js'

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
          if (isPlayerBuilt({ name: key }) || String(key).includes('planks') || String(key).includes('oak')) {
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

async function collectViaPlugin(bot, target, label, ms = 15000) {
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
  if (target.name && (isPlayerBuilt(target) || String(target.name).includes('planks'))) {
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

async function exploreNewDir(bot, state) {
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
  sandstone: ['sandstone', 'red_sandstone']
}

export async function leaveSpawnForGather(bot, state) {
  const r0 = horizFromOrigin(bot)
  if (r0 >= SPAWN_SAFE_R) return true
  const p = bot.entity && bot.entity.position
  if (!p) return false
  let tx = p.x
  let tz = p.z
  const rr = Math.hypot(tx, tz) || 1
  tx = (tx / rr) * 30
  tz = (tz / rr) * 30
  plog('collect leave-spawn r=' + r0.toFixed(1))
  state.phase = 'leave-spawn'
  state.note = 'leaving spawn to gather'
  stopPath(bot)
  if (bot.pathfinder && goals && goals.GoalXZ) {
    try {
      const g = new goals.GoalXZ(Math.floor(tx), Math.floor(tz))
      const pth = bot.pathfinder.goto(g)
      const t = sleep(8000).then(() => { try { bot.pathfinder.setGoal(null) } catch {}; throw new Error('goto-timeout') })
      await Promise.race([pth, t])
    } catch {
      try { bot.pathfinder.setGoal(null) } catch {}
    }
  }
  return horizFromOrigin(bot) >= SPAWN_SAFE_R
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
