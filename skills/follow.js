import { goals, pathfinderPkg, plog, sleep, posOf, horizFromOrigin, stopPath, findPlayerNamed, SPAWN_SAFE_R } from './lib.js'

const FOLLOW_RANGE = 5

export function startFollow(bot, entity, range = FOLLOW_RANGE) {
  if (!bot.pathfinder || !goals || !goals.GoalFollow || !entity) return false
  try {
    bot.pathfinder.setGoal(new goals.GoalFollow(entity, range), true)
    return true
  } catch (err) {
    plog('follow fail ' + (err && err.message))
    return false
  }
}

export async function comeNow(bot, state, user, extra) {
  if (state.chatComing) return
  state.chatComing = true
  try {
    let x, y, z
    if (extra && extra.x != null && extra.z != null) {
      x = Number(extra.x)
      y = extra.y != null ? Number(extra.y) : (bot.entity && bot.entity.position ? bot.entity.position.y : 64)
      z = Number(extra.z)
    } else {
      const ent = findPlayerNamed(bot, user)
      if (!ent || !ent.position) {
        plog('come fail, no player ' + (user || '?'))
        return
      }
      x = ent.position.x
      y = ent.position.y
      z = ent.position.z
    }
    plog('come to ' + Number(x).toFixed(1) + ' ' + Number(y).toFixed(1) + ' ' + Number(z).toFixed(1) + ' from=' + (user || '?'))
    if (bot.pathfinder && goals && goals.GoalNear) {
      try {
        const g = new goals.GoalNear(x, y, z, 2)
        const p = bot.pathfinder.goto(g)
        const t = sleep(12000).then(() => { try { bot.pathfinder.setGoal(null) } catch {}; throw new Error('goto-timeout') })
        await Promise.race([p, t])
      } catch {
        try { bot.pathfinder.setGoal(null) } catch {}
      }
    }
    plog('come done pos=' + (posOf(bot) && posOf(bot).str) + ' r=' + horizFromOrigin(bot).toFixed(1))
  } catch (err) {
    plog('come fail ' + (err && err.message))
  } finally {
    state.chatComing = false
  }
}

export async function honorFollow(bot, state) {
  const mode = state.chatMode
  if (mode === 'stay') {
    stopPath(bot)
    state.phase = 'chat-stay'
    state.note = 'chat stay'
    await sleep(400)
    return
  }
  if (mode === 'follow') {
    const ent = findPlayerNamed(bot, state.chatUser)
    if (ent) startFollow(bot, ent, FOLLOW_RANGE)
    else stopPath(bot)
    state.phase = 'chat-follow'
    state.note = 'chat follow ' + (state.chatUser || '')
    await sleep(400)
    return
  }
  if (mode === 'come') {
    state.phase = 'chat-come'
    state.note = 'chat come ' + (state.chatUser || '')
    if (!state.chatComing) await comeNow(bot, state, state.chatUser, state.chatExtra || null)
    if (state.chatMode === 'come') state.chatMode = null
  }
}

export async function run(bot, state) {
  return honorFollow(bot, state)
}
