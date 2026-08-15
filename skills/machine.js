import stateMachine from 'mineflayer-statemachine'
import { inHole, escapeHole } from './escape.js'
import { huntSand, huntBlock, leaveSpawnForGather } from './collect.js'
import { startFollow, comeNow } from './follow.js'
import { idleTick } from './idle.js'
import { nearestHostile, fleeHostile } from './flee.js'
import { plog, stopPath, findPlayerNamed, horizFromOrigin, countSand, SPAWN_SAFE_R } from './lib.js'

function smApi(mod) {
  const m = (mod && mod.BotStateMachine) ? mod : (mod && mod.default) ? mod.default : mod
  if (!m || !m.StateTransition || !m.BotStateMachine || !m.NestedStateMachine) {
    throw new Error('mineflayer-statemachine missing StateTransition/BotStateMachine/NestedStateMachine')
  }
  return m
}

function wantFollow(state) {
  return state.chatMode === 'follow' || state.chatMode === 'come'
}

function shouldCollect(state, bot) {
  if (state.chatMode === 'stay' || state.chatMode === 'follow' || state.chatMode === 'come') return false
  if (state.chatMode === 'collect') return true
  try { if (countSand(bot) < 1) return true } catch {}
  return false
}

function hole(bot) {
  try { return inHole(bot) } catch { return false }
}

function hostile(bot, d = 8) {
  try { return nearestHostile(bot, d) } catch { return null }
}

class SkillState {
  constructor(name, bot, ctx, runner) {
    this.stateName = name
    this.active = false
    this.bot = bot
    this.ctx = ctx
    this.runner = runner
    this._gen = 0
  }

  onStateEntered() {
    const gen = ++this._gen
    this.ctx.state.phase = this.stateName
    this.ctx.state.note = 'sm ' + this.stateName
    this.ctx.state.smState = this.stateName
    plog('state enter ' + this.stateName)
    Promise.resolve()
      .then(() => this.runner(this.bot, this.ctx, () => this.active && this._gen === gen))
      .catch((err) => plog('state ' + this.stateName + ' fail ' + (err && err.message)))
  }

  onStateExited() {
    this._gen++
    try { stopPath(this.bot) } catch {}
    plog('state exit ' + this.stateName)
  }
}

async function runEscape(bot, ctx, still) {
  while (still() && hole(bot) && !ctx.state.dead) {
    await escapeHole(bot, ctx.state)
  }
}

async function runFlee(bot, ctx, still) {
  while (still() && !ctx.state.dead) {
    const mob = hostile(bot, 10)
    if (!mob) return
    ctx.state.note = 'flee ' + String(mob.name || 'mob')
    await fleeHostile(bot, mob)
  }
}

async function runFollow(bot, ctx, still) {
  const state = ctx.state
  if (state.chatMode === 'come') {
    await comeNow(bot, state, state.chatUser, state.chatExtra || null)
    if (state.chatMode === 'come') state.chatMode = null
    return
  }
  while (still() && state.chatMode === 'follow' && !state.dead) {
    const ent = findPlayerNamed(bot, state.chatUser)
    if (ent) startFollow(bot, ent, 5)
    else stopPath(bot)
    state.phase = 'follow'
    state.note = 'chat follow ' + (state.chatUser || '')
    await new Promise((r) => setTimeout(r, 400))
  }
}

async function runCollect(bot, ctx, still) {
  const state = ctx.state
  while (still() && !state.dead) {
    if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
      await leaveSpawnForGather(bot, state)
      if (!still()) return
    }
    const name = state.collectName || 'sand'
    if (!name || name === 'sand' || name === 'red_sand') await huntSand(bot, state)
    else await huntBlock(bot, state, name)
    await new Promise((r) => setTimeout(r, 400))
  }
}

async function runIdle(bot, ctx, still) {
  while (still() && !ctx.state.dead) {
    await idleTick(bot, ctx.state)
  }
}

export function startStateMachine(bot, state) {
  const { StateTransition, BotStateMachine, NestedStateMachine, BehaviorIdle, BehaviorFollowEntity } = smApi(stateMachine)
  const ctx = { state, bot }
  const targets = {}

  const escape = new SkillState('escape', bot, ctx, runEscape)
  const flee = new SkillState('flee', bot, ctx, runFlee)
  const collect = new SkillState('collect', bot, ctx, runCollect)

  const idle = new BehaviorIdle()
  idle.stateName = 'idle'
  idle.onStateEntered = function () {
    ctx.state.phase = 'idle'
    ctx.state.smState = 'idle'
    ctx.state.note = 'sm idle'
    plog('state enter idle')
    const gen = (idle._gen = (idle._gen || 0) + 1)
    runIdle(bot, ctx, () => idle.active && idle._gen === gen).catch((err) => plog('state idle fail ' + (err && err.message)))
  }
  idle.onStateExited = function () {
    idle._gen = (idle._gen || 0) + 1
    try { stopPath(bot) } catch {}
    plog('state exit idle')
  }

  const follow = new BehaviorFollowEntity(bot, targets)
  follow.stateName = 'follow'
  follow.followDistance = 5
  follow.onStateEntered = function () {
    ctx.state.phase = state.chatMode === 'come' ? 'chat-come' : 'follow'
    ctx.state.smState = 'follow'
    ctx.state.note = 'sm follow'
    plog('state enter follow mode=' + (state.chatMode || 'none') + ' user=' + (state.chatUser || ''))
    const gen = (follow._gen = (follow._gen || 0) + 1)
    const ent = findPlayerNamed(bot, state.chatUser)
    targets.entity = ent || null
    runFollow(bot, ctx, () => follow.active && follow._gen === gen).catch((err) => plog('state follow fail ' + (err && err.message)))
  }
  follow.onStateExited = function () {
    follow._gen = (follow._gen || 0) + 1
    try { stopPath(bot) } catch {}
    targets.entity = null
    plog('state exit follow')
  }

  const workTransitions = [
    new StateTransition({
      parent: idle,
      child: follow,
      name: 'idle->follow',
      shouldTransition: () => wantFollow(state),
      onTransition: () => plog('transition idle->follow')
    }),
    new StateTransition({
      parent: idle,
      child: collect,
      name: 'idle->collect',
      shouldTransition: () => shouldCollect(state, bot),
      onTransition: () => plog('transition idle->collect')
    }),
    new StateTransition({
      parent: collect,
      child: follow,
      name: 'collect->follow',
      shouldTransition: () => wantFollow(state),
      onTransition: () => plog('transition collect->follow')
    }),
    new StateTransition({
      parent: collect,
      child: idle,
      name: 'collect->idle',
      shouldTransition: () => !shouldCollect(state, bot) && !wantFollow(state),
      onTransition: () => plog('transition collect->idle')
    }),
    new StateTransition({
      parent: follow,
      child: idle,
      name: 'follow->idle',
      shouldTransition: () => !wantFollow(state) && !shouldCollect(state, bot),
      onTransition: () => plog('transition follow->idle')
    }),
    new StateTransition({
      parent: follow,
      child: collect,
      name: 'follow->collect',
      shouldTransition: () => !wantFollow(state) && shouldCollect(state, bot),
      onTransition: () => plog('transition follow->collect')
    })
  ]

  const work = new NestedStateMachine(workTransitions, idle)
  work.stateName = 'work'

  const rootTransitions = [
    new StateTransition({
      parent: work,
      child: escape,
      name: 'work->escape',
      shouldTransition: () => hole(bot),
      onTransition: () => plog('transition work->escape')
    }),
    new StateTransition({
      parent: work,
      child: flee,
      name: 'work->flee',
      shouldTransition: () => !hole(bot) && !!hostile(bot, 8),
      onTransition: () => plog('transition work->flee')
    }),
    new StateTransition({
      parent: escape,
      child: flee,
      name: 'escape->flee',
      shouldTransition: () => !hole(bot) && !!hostile(bot, 8),
      onTransition: () => plog('transition escape->flee')
    }),
    new StateTransition({
      parent: escape,
      child: work,
      name: 'escape->work',
      shouldTransition: () => !hole(bot) && !hostile(bot, 8),
      onTransition: () => plog('transition escape->work')
    }),
    new StateTransition({
      parent: flee,
      child: escape,
      name: 'flee->escape',
      shouldTransition: () => hole(bot),
      onTransition: () => plog('transition flee->escape')
    }),
    new StateTransition({
      parent: flee,
      child: work,
      name: 'flee->work',
      shouldTransition: () => !hole(bot) && !hostile(bot, 8),
      onTransition: () => plog('transition flee->work')
    })
  ]

  const root = new NestedStateMachine(rootTransitions, work)
  root.stateName = 'root'

  const machine = new BotStateMachine(bot, root)
  machine.on('stateChanged', () => {
    let name = 'root'
    try {
      let n = root
      while (n && n.activeState) {
        if (n.activeState.stateName) name = n.activeState.stateName
        n = n.activeState
      }
    } catch {}
    state.smState = name
    plog('state now ' + name)
  })

  state.useMachine = true
  state.smState = 'work'
  plog('state machine live nested=work(idle,follow,collect) root(escape,flee,work) no auto-follow')
  return machine
}
