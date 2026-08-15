import { Vec3, plog, sleep, posOf, isSolid, resolveItemName, countNamed, clearMove } from './lib.js'
import { leaveSpawnForGather } from './collect.js'

const PLAYER_CMDS = new Set(['come', 'follow', 'stay', 'wood', 'collect', 'craft', 'place', 'build', 'table', 'shovel', 'pick', 'camp', 'farm', 'sleep', 'guard', 'gather', 'chest', 'store', 'withdraw'])
const GIVE_UP_MS = 45000

function sideSolid(bot, p, dx, dz, dy) {
  try {
    return isSolid(bot.blockAt(p.offset(dx, dy, dz)))
  } catch {
    return false
  }
}

export function playerPreemptsEscape(state) {
  if (!state) return false
  return PLAYER_CMDS.has(state.chatMode)
}

export function inHole(bot) {
  // Strict: only a real 1-block pit (feet boxed in AND a jumpable rim).
  // Village streets / standing next to house walls are NOT holes.
  try {
    const p = bot.entity.position.floored()
    let feetWalls = 0
    let jumpableRim = 0
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const feet = sideSolid(bot, p, dx, dz, 0)
      const head = sideSolid(bot, p, dx, dz, 1)
      if (feet) feetWalls++
      if (feet && !head) jumpableRim++
    }
    return feetWalls >= 3 && jumpableRim >= 1
  } catch {
    return false
  }
}

export function isOneBlockHole(bot) {
  return inHole(bot)
}

export function holeActive(bot, state) {
  try {
    if (playerPreemptsEscape(state)) return false
    if (state && state.escapeGiveUpUntil && Date.now() < state.escapeGiveUpUntil) return false
    return inHole(bot)
  } catch {
    return false
  }
}

function dirtCount(bot) {
  return countNamed(bot, ['dirt', 'grass_block'])
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
    const yFloor = Math.floor(p.y)
    for (let dy = 0; dy >= -5; dy--) {
      const b = bot.blockAt(new Vec3(x, yFloor + dy, z))
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

async function giveUpAndCollect(bot, state, why) {
  state.escapeGiveUpUntil = Date.now() + GIVE_UP_MS
  state.leftHole = !inHole(bot)
  state.phase = 'escape-giveup'
  state.note = 'escape give up: ' + why
  plog('escape give up: ' + why + ' pos=' + (posOf(bot) && posOf(bot).str) + ' — walk r>=24 then collect')
  await clearMove(bot)
  try {
    await leaveSpawnForGather(bot, state)
  } catch (err) {
    plog('escape leave-spawn fail ' + (err && err.message))
  }
  return false
}

export async function escapeHole(bot, state) {
  if (playerPreemptsEscape(state)) {
    plog('escape preempted by chat ' + state.chatMode)
    await clearMove(bot)
    return false
  }
  if (!inHole(bot)) {
    state.leftHole = true
    return true
  }
  state.leftHole = false
  state.phase = 'escape'
  const start = posOf(bot)
  const dirtN = dirtCount(bot)
  plog('escape start ' + (start && start.str) + ' dirt=' + dirtN + ' oneBlock=' + isOneBlockHole(bot))
  if (dirtN < 1) {
    return giveUpAndCollect(bot, state, 'no dirt')
  }
  const deadline = Date.now() + 25000
  let jumped = false
  let pillarFails = 0
  while (Date.now() < deadline && !state.dead) {
    if (playerPreemptsEscape(state)) {
      plog('escape preempted by chat ' + state.chatMode)
      await clearMove(bot)
      return false
    }
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
    if (dirtCount(bot) < 1) {
      return giveUpAndCollect(bot, state, 'no dirt after jump')
    }
    const ok = await pillarOut(bot)
    if (ok && !inHole(bot)) {
      state.leftHole = true
      plog('left hole by pillar at ' + (posOf(bot) && posOf(bot).str))
      await clearMove(bot)
      return true
    }
    if (!ok) {
      pillarFails++
      if (dirtCount(bot) < 1 || pillarFails >= 3) {
        return giveUpAndCollect(bot, state, dirtCount(bot) < 1 ? 'no dirt' : ('pillar fail x' + pillarFails))
      }
    }
    await sleep(150)
  }
  if (!inHole(bot)) {
    state.leftHole = true
    plog('escape done left=true pos=' + (posOf(bot) && posOf(bot).str))
    await clearMove(bot)
    return true
  }
  return giveUpAndCollect(bot, state, 'timeout still in hole')
}

export async function run(bot, state) {
  return escapeHole(bot, state)
}
