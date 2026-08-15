import { plog } from './lib.js'

// Official looker.js: nearestEntity, lookAt player eye-height or mob body.
// https://github.com/PrismarineJS/mineflayer/blob/master/examples/looker.js
// Used from fun/idle. No chat. No 50ms fight with pathfinder.

let lastLog = 0

function entityKind(entity) {
  if (!entity) return ''
  if (entity.type === 'player' || entity.username) return 'player'
  if (entity.type === 'mob' || entity.type === 'hostile') return 'mob'
  if (entity.type === 'animal' || entity.type === 'passive' || entity.type === 'water_creature' || entity.type === 'ambient') return 'animal'
  return String(entity.type || '')
}

export function lookAtNearest(bot) {
  if (!bot || typeof bot.nearestEntity !== 'function') return null
  if (bot.pathfinder && bot.pathfinder.isMoving && bot.pathfinder.isMoving()) return null
  let entity = null
  try { entity = bot.nearestEntity() } catch { return null }
  if (entity == null || !entity.position) return null
  const kind = entityKind(entity)
  try {
    if (entity.type === 'player') {
      bot.lookAt(entity.position.offset(0, 1.6, 0))
    } else if (entity.type === 'mob' || entity.type === 'animal' || entity.type === 'passive' || entity.type === 'water_creature' || entity.type === 'ambient' || entity.type === 'hostile') {
      bot.lookAt(entity.position)
    } else {
      return null
    }
  } catch {
    return null
  }
  const now = Date.now()
  if (now - lastLog > 8000) {
    lastLog = now
    const name = entity.username || entity.name || entity.displayName || kind || 'entity'
    plog('look ' + kind + ' ' + name)
  }
  return entity
}

export function lookTick(bot, state) {
  const ent = lookAtNearest(bot)
  if (ent && state) state.note = 'look ' + (ent.username || ent.name || entityKind(ent))
  return !!ent
}

export async function run(bot, state) {
  return lookTick(bot, state)
}
