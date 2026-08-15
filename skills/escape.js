import { Vec3, plog, sleep, posOf, isSolid, resolveItemName, countNamed, clearMove } from './lib.js'

function sideSolid(bot, p, dx, dz, dy) {
  try {
    return isSolid(bot.blockAt(p.offset(dx, dy, dz)))
  } catch {
    return false
  }
}

function cannotPathTwoBlocks(bot) {
  try {
    const p = bot.entity.position.floored()
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    for (const [dx, dz] of dirs) {
      let open = true
      for (let step = 1; step <= 2; step++) {
        const body = bot.blockAt(p.offset(dx * step, 0, dz * step))
        const head = bot.blockAt(p.offset(dx * step, 1, dz * step))
        if (isSolid(body) || isSolid(head)) {
          open = false
          break
        }
      }
      if (open) return false
    }
    return true
  } catch {
    return false
  }
}

export function inHole(bot) {
  try {
    const p = bot.entity.position.floored()
    let bodyWalls = 0
    let headWalls = 0
    let highGround = 0
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (sideSolid(bot, p, dx, dz, 0)) bodyWalls++
      if (sideSolid(bot, p, dx, dz, 1)) headWalls++
      if (sideSolid(bot, p, dx, dz, 1) || sideSolid(bot, p, dx, dz, 2)) highGround++
    }
    if (bodyWalls >= 3 || headWalls >= 3 || highGround >= 3) return true
    if (cannotPathTwoBlocks(bot)) return true
    return false
  } catch {
    return false
  }
}

export function isOneBlockHole(bot) {
  try {
    const p = bot.entity.position.floored()
    let feetWalls = 0
    let headWalls = 0
    let jumpableRim = 0
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const feet = sideSolid(bot, p, dx, dz, 0)
      const head = sideSolid(bot, p, dx, dz, 1)
      if (feet) feetWalls++
      if (head) headWalls++
      if (feet && !head) jumpableRim++
    }
    return feetWalls >= 3 && headWalls <= 1 && jumpableRim >= 1
  } catch {
    return false
  }
}

async function jumpOut(bot) {
  plog('escape jump 1-block hole')
  try { bot.setControlState('jump', true) } catch {}
  await sleep(350)
  try { bot.setControlState('jump', false) } catch {}
}

async function pillarOut(bot) {
  let dirt = null
  try {
    dirt = bot.inventory.items().find((i) => {
      const n = resolveItemName(bot, i)
      return n === 'dirt' || n === 'grass_block'
    }) || null
  } catch {}
  if (!dirt) {
    plog('escape pillar fail, no dirt')
    return false
  }
  const y0 = bot.entity && bot.entity.position ? bot.entity.position.y : 0
  try {
    await bot.equip(dirt, 'hand')
  } catch (err) {
    plog('escape pillar equip fail ' + (err && err.message))
    return false
  }
  let under = null
  try {
    const p = bot.entity.position
    const x = Math.floor(p.x)
    const z = Math.floor(p.z)
    const y0 = Math.floor(p.y)
    for (let dy = 0; dy >= -5; dy--) {
      const b = bot.blockAt(new Vec3(x, y0 + dy, z))
      if (b && b.name && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air' && isSolid(b)) {
        under = b
        break
      }
    }
  } catch {}
  if (!under) {
    plog('escape pillar no floor, jump toward rim')
    try { bot.setControlState('jump', true) } catch {}
    try { bot.setControlState('forward', true) } catch {}
    await sleep(400)
    try { bot.setControlState('jump', false) } catch {}
    try { bot.setControlState('forward', false) } catch {}
    return false
  }
  plog('escape pillar dirt y=' + y0.toFixed(2) + ' ref=' + under.name)
  try { await bot.look(bot.entity.yaw, 1.45, true) } catch {}
  try { bot.setControlState('jump', true) } catch {}
  await sleep(80)
  let placed = false
  try {
    await bot.placeBlock(under, new Vec3(0, 1, 0))
    placed = true
    plog('escape pillar placed on ' + under.name)
  } catch (err) {
    plog('escape pillar place fail ' + (err && err.message))
  }
  await sleep(220)
  try { bot.setControlState('jump', false) } catch {}
  const y1 = bot.entity && bot.entity.position ? bot.entity.position.y : y0
  return placed || y1 > y0 + 0.35
}

export async function escapeHole(bot, state) {
  if (!inHole(bot)) {
    state.leftHole = true
    return true
  }
  state.leftHole = false
  state.phase = 'escape'
  const start = posOf(bot)
  const dirtN = countNamed(bot, ['dirt', 'grass_block'])
  plog('escape start ' + (start && start.str) + ' dirt=' + dirtN + ' oneBlock=' + isOneBlockHole(bot))
  const deadline = Date.now() + 25000
  let jumped = false
  while (Date.now() < deadline && !state.dead) {
    if (!inHole(bot)) {
      state.leftHole = true
      plog('left hole at ' + (posOf(bot) && posOf(bot).str))
      await clearMove(bot)
      return true
    }
    if (isOneBlockHole(bot) && !jumped) {
      jumped = true
      await jumpOut(bot)
      await sleep(250)
      continue
    }
    const ok = await pillarOut(bot)
    if (ok && !inHole(bot)) {
      state.leftHole = true
      plog('left hole by pillar at ' + (posOf(bot) && posOf(bot).str))
      await clearMove(bot)
      return true
    }
    await sleep(150)
  }
  if (!inHole(bot)) state.leftHole = true
  plog('escape done left=' + state.leftHole + ' pos=' + (posOf(bot) && posOf(bot).str))
  await clearMove(bot)
  return !!state.leftHole
}

export async function run(bot, state) {
  return escapeHole(bot, state)
}
