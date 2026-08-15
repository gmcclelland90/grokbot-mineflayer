import { plog, sleep, stopPath, PLAYER_NAMES, gotoNear } from './lib.js'
import { HOSTILES, nearestHostile } from './flee.js'
import { isAllyName } from './cluster.js'

// Official guard.js + mineflayer-pvp: bot.pvp.attack(nearest mob).
// https://github.com/PrismarineJS/mineflayer/blob/master/examples/guard.js
// Self-defense: fight if HURT or a hostile is in ~8. Still FLEE creepers.
// Never attack players or named bots (Har0x). Default on during free play.

const RANGE = 8
const HURT_MS = 4000

function mobName(e) {
  return String((e && (e.name || e.displayName)) || '').toLowerCase()
}

export function isCreeper(e) {
  return !!e && mobName(e) === 'creeper'
}

export function nearestCreeper(bot, maxD = RANGE) {
  const pos = bot.entity && bot.entity.position
  if (!pos) return null
  let best = null
  let bestD = maxD
  try {
    for (const e of Object.values(bot.entities || {})) {
      if (!e || !e.position || !isCreeper(e)) continue
      const d = e.position.distanceTo(pos)
      if (d < bestD) { best = e; bestD = d }
    }
  } catch {}
  return best
}

function isPlayerOrBot(e, bot) {
  if (!e) return true
  if (e === bot.entity) return true
  if (e.type === 'player' || e.username) return true
  const n = String(e.username || e.name || '').toLowerCase()
  const me = String(bot.username || 'steve').toLowerCase()
  if (n === me || n === 'steve') return true
  if (PLAYER_NAMES.includes(n)) return true
  if (isAllyName(n)) return true
  return false
}

// Official guard.js filter, tightened: hostiles only, no armor stand, no creeper, no players.
export function guardFilter(e, bot, maxD = RANGE) {
  if (!e || !e.position || !bot.entity || !bot.entity.position) return false
  if (String(e.displayName) === 'Armor Stand') return false
  if (isPlayerOrBot(e, bot)) return false
  if (isCreeper(e)) return false
  if (e.type !== 'mob' && e.type !== 'hostile') return false
  if (!HOSTILES.has(mobName(e))) return false
  return e.position.distanceTo(bot.entity.position) < maxD
}

export function nearestGuardTarget(bot, maxD = RANGE) {
  if (!bot || typeof bot.nearestEntity !== 'function') {
    const h = nearestHostile(bot, maxD)
    return h && !isCreeper(h) && !isPlayerOrBot(h, bot) ? h : null
  }
  try {
    const ent = bot.nearestEntity((e) => guardFilter(e, bot, maxD))
    if (ent) return ent
  } catch {}
  const h = nearestHostile(bot, maxD)
  if (h && !isCreeper(h) && !isPlayerOrBot(h, bot)) return h
  return null
}

export function guardEnabled(state) {
  return !state || state.guardOn !== false
}

export function markHurt(state) {
  if (state) state.hurtAt = Date.now()
}

export function recentlyHurt(state) {
  return !!(state && state.hurtAt && Date.now() - state.hurtAt < HURT_MS)
}

export function shouldGuard(bot, state) {
  if (!guardEnabled(state)) return false
  if (nearestCreeper(bot, RANGE)) return false
  if (state && state.chatMode === 'guard') return true
  if (nearestGuardTarget(bot, RANGE)) return true
  if (recentlyHurt(state) && nearestGuardTarget(bot, RANGE + 4)) return true
  return false
}

export function stopGuard(bot) {
  try { if (bot.pvp && typeof bot.pvp.stop === 'function') bot.pvp.stop() } catch {}
}

export async function fightTarget(bot, entity) {
  if (!entity || !bot.pvp || typeof bot.pvp.attack !== 'function') return false
  const name = entity.name || entity.displayName || 'mob'
  plog('guard pvp.attack ' + name)
  try {
    await bot.pvp.attack(entity)
    return true
  } catch (err) {
    plog('guard attack fail ' + (err && err.message))
    return false
  }
}

async function holdGuardPos(bot, state) {
  const pos = state.guardPos || state.campOrigin
  if (!pos) return
  const here = bot.entity && bot.entity.position
  if (!here) return
  const d = Math.hypot(here.x - pos.x, here.z - pos.z)
  if (d <= 4) return
  state.note = 'guard walk camp'
  try { await gotoNear(bot, pos.x, pos.y || here.y, pos.z, 3, 8000) } catch {}
}

export async function runGuard(bot, ctx, still) {
  const state = ctx.state
  plog('guard self-defense on range=' + RANGE + (state.guardPos ? ' pos=camp' : ''))
  while (still() && !state.dead) {
    if (!guardEnabled(state)) {
      stopGuard(bot)
      return
    }
    if (nearestCreeper(bot, RANGE)) {
      stopGuard(bot)
      return
    }
    const target = nearestGuardTarget(bot, recentlyHurt(state) ? RANGE + 4 : RANGE)
    if (target) {
      state.phase = 'guard'
      state.note = 'guard ' + String(target.name || 'mob')
      await fightTarget(bot, target)
      await sleep(400)
      continue
    }
    stopGuard(bot)
    if (state.chatMode === 'guard') {
      await holdGuardPos(bot, state)
      await sleep(400)
      continue
    }
    return
  }
  stopGuard(bot)
}

export function wireHurt(bot, state) {
  bot.on('entityHurt', (entity) => {
    try {
      if (entity === bot.entity) {
        markHurt(state)
        plog('guard hurt health=' + bot.health)
      }
    } catch {}
  })
  bot.on('health', () => {
    try {
      const h = Number(bot.health)
      if (Number.isFinite(h) && state._guardHealth != null && h < state._guardHealth) markHurt(state)
      state._guardHealth = h
    } catch {}
  })
}

export async function run(bot, state) {
  const target = nearestGuardTarget(bot, RANGE)
  if (!target) return true
  state.phase = 'guard'
  state.note = 'guard ' + String(target.name || 'mob')
  await fightTarget(bot, target)
  return !nearestGuardTarget(bot, RANGE)
}
