import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Vec3, goals, plog, sleep, posOf, horizFromOrigin, stopPath, clearMove, SPAWN_SAFE_R } from './lib.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EPISODES = path.join(__dirname, '..', 'rl', 'episodes.jsonl')
const STUCK_MS = 20000
const HEADINGS = 8

function blockKey(bot) {
  const p = bot.entity && bot.entity.position
  if (!p) return ''
  return Math.floor(p.x) + ',' + Math.floor(p.y) + ',' + Math.floor(p.z)
}

function guessCause(bot, state) {
  const r = horizFromOrigin(bot)
  const phase = String((state && state.phase) || '')
  if (phase === 'leave-spawn' || r < SPAWN_SAFE_R) return 'leave-spawn'
  if (phase === 'escape') return 'hole'
  if (phase === 'wood' || (state && state.jobId === 'gather-wood')) return 'no-trees'
  if (state && state.jobId && /claimed|job/.test(String(state.note || ''))) return 'job-race'
  if (bot.pathfinder && bot.pathfinder.isMoving && !bot.pathfinder.isMoving()) return 'pathfinder'
  return 'pathfinder'
}

export function logWorkerEpisode(bot, state, reason, cause, extra) {
  try {
    const p = posOf(bot)
    const rec = {
      t: new Date().toISOString(),
      username: bot.username || process.env.MC_USERNAME || 'Steve',
      reason,
      cause: cause || guessCause(bot, state),
      pos: p ? p.str : '?',
      phase: (state && state.phase) || '',
      sm: (state && (state.smState || state.sm)) || '',
      jobId: (state && state.jobId) || null,
      r: Number(horizFromOrigin(bot).toFixed(1)),
      notes: extra || ''
    }
    fs.appendFileSync(EPISODES, JSON.stringify(rec) + '\n')
    plog('episode ' + reason + ' cause=' + rec.cause + ' pos=' + rec.pos + ' phase=' + rec.phase)
  } catch (err) {
    plog('episode write fail ' + (err && err.message))
  }
}

function headingDest(bot, state, dist) {
  const p = bot.entity && bot.entity.position
  if (!p) return null
  const idx = (state.stuckHeading || 0) % HEADINGS
  const ang = (idx / HEADINGS) * Math.PI * 2
  let tx = p.x + Math.cos(ang) * dist
  let tz = p.z + Math.sin(ang) * dist
  const rr = Math.hypot(tx, tz)
  if (rr < SPAWN_SAFE_R + 4) {
    const s = rr || 1
    tx = (tx / s) * (SPAWN_SAFE_R + 8)
    tz = (tz / s) * (SPAWN_SAFE_R + 8)
  }
  return { x: tx, y: p.y, z: tz, idx }
}

async function stepDown(bot) {
  const p = bot.entity && bot.entity.position
  if (!p) return false
  const fx = Math.floor(p.x)
  const fy = Math.floor(p.y)
  const fz = Math.floor(p.z)
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  for (const [dx, dz] of dirs) {
    let floor = null
    let body = null
    try {
      floor = bot.blockAt(new Vec3(fx + dx, fy - 2, fz + dz))
      body = bot.blockAt(new Vec3(fx + dx, fy - 1, fz + dz))
    } catch {}
    if (!floor || floor.boundingBox !== 'block') continue
    if (body && body.boundingBox === 'block') continue
    const destY = fy - 1
    plog('stuck step-down to ' + (fx + dx) + ' ' + destY + ' ' + (fz + dz))
    try { await bot.lookAt(new Vec3(fx + dx + 0.5, destY, fz + dz + 0.5), true) } catch {}
    try {
      bot.setControlState('forward', true)
      bot.setControlState('sprint', false)
    } catch {}
    await sleep(700)
    await clearMove(bot)
    return true
  }
  return false
}

async function repath(bot, dest) {
  stopPath(bot)
  if (bot.pathfinder && goals && dest) {
    try {
      const g = goals.GoalXZ ? new goals.GoalXZ(Math.floor(dest.x), Math.floor(dest.z)) : new goals.GoalNear(dest.x, dest.y, dest.z, 3)
      const pth = bot.pathfinder.goto(g)
      const t = sleep(4000).then(() => { try { bot.pathfinder.setGoal(null) } catch {}; throw new Error('goto-timeout') })
      await Promise.race([pth, t])
    } catch {
      try { bot.pathfinder.setGoal(null) } catch {}
    }
  }
  try {
    await bot.lookAt(new Vec3(dest.x, dest.y + 1, dest.z), true)
    bot.setControlState('forward', true)
    bot.setControlState('jump', true)
    await sleep(400)
    bot.setControlState('jump', false)
    await sleep(900)
  } catch {}
  await clearMove(bot)
}

export async function unstickIfNeeded(bot, state, why) {
  if (!bot || !bot.entity || !state) return false
  if (state.chatMode === 'stay' || state.chatMode === 'follow' || state.chatMode === 'come') return false
  const key = blockKey(bot)
  if (!key) return false
  const now = Date.now()
  if (!state.stuckKey || state.stuckKey !== key) {
    state.stuckKey = key
    state.stuckSince = now
    return false
  }
  const held = now - (state.stuckSince || now)
  if (held < STUCK_MS) return false
  const cause = guessCause(bot, state)
  const label = why || state.phase || 'work'
  logWorkerEpisode(bot, state, 'same-pos', cause, 'held=' + Math.round(held / 1000) + 's phase=' + label)
  state.stuckHeading = (state.stuckHeading || 0) + 1
  state.stuckSince = now
  state.note = 'unstick ' + cause + ' heading=' + (state.stuckHeading % HEADINGS)
  plog('stuck ' + held + 'ms at ' + key + ' cause=' + cause + ' — repath/heading/step-down')
  stopPath(bot)
  const dropped = await stepDown(bot)
  const dest = headingDest(bot, state, 18 + ((state.stuckHeading || 0) % 5) * 4)
  if (dest) await repath(bot, dest)
  const moved = blockKey(bot) !== key
  if (moved) {
    state.stuckKey = blockKey(bot)
    state.stuckSince = Date.now()
  }
  return dropped || moved
}

export function noteIdleEpisode(bot, state, extra) {
  const now = Date.now()
  if (now - (state.lastIdleEpisodeAt || 0) < 15000) return
  state.lastIdleEpisodeAt = now
  logWorkerEpisode(bot, state, 'idle', guessCause(bot, state), extra || 'no job / same-pos')
}
