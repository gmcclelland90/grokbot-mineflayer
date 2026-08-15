import { goals, plog, sleep, clearMove, stopPath } from './lib.js'

export const HOSTILES = new Set(['creeper', 'zombie', 'skeleton', 'husk', 'stray', 'drowned', 'spider', 'witch', 'enderman', 'phantom'])

export function nearestHostile(bot, maxD = 8) {
  const pos = bot.entity && bot.entity.position
  if (!pos) return null
  let best = null
  let bestD = maxD
  try {
    for (const e of Object.values(bot.entities || {})) {
      if (!e || !e.position) continue
      const n = String(e.name || e.displayName || '').toLowerCase()
      if (!HOSTILES.has(n)) continue
      const d = e.position.distanceTo(pos)
      if (d < bestD) {
        best = e
        bestD = d
      }
    }
  } catch {}
  return best
}

export async function fleeHostile(bot, mob) {
  if (!mob || !mob.position || !bot.entity || !bot.entity.position) return false
  stopPath(bot)
  try { bot.setControlState('jump', false) } catch {}
  const pos = bot.entity.position
  const dx = pos.x - mob.position.x
  const dz = pos.z - mob.position.z
  const len = Math.hypot(dx, dz) || 1
  const tx = pos.x + (dx / len) * 10
  const tz = pos.z + (dz / len) * 10
  const name = String(mob.name || mob.displayName || 'mob')
  plog('flee ' + name + ' d=' + mob.position.distanceTo(pos).toFixed(1))
  if (bot.pathfinder && goals && goals.GoalNear) {
    try {
      const g = new goals.GoalNear(tx, pos.y, tz, 2)
      const p = bot.pathfinder.goto(g)
      const t = sleep(2500).then(() => { try { bot.pathfinder.setGoal(null) } catch {}; throw new Error('goto-timeout') })
      await Promise.race([p, t])
      await clearMove(bot)
      return true
    } catch {
      try { bot.pathfinder.setGoal(null) } catch {}
    }
  }
  try { await bot.lookAt(pos.offset(dx, 0, dz), true) } catch {}
  try {
    bot.setControlState('jump', false)
    bot.setControlState('sprint', true)
    bot.setControlState('forward', true)
  } catch {}
  await sleep(700)
  await clearMove(bot)
  return true
}

export async function run(bot, state) {
  const mob = nearestHostile(bot, 10)
  if (!mob) return true
  state.phase = 'flee'
  state.note = 'flee ' + String(mob.name || 'mob')
  await fleeHostile(bot, mob)
  return !nearestHostile(bot, 8)
}
