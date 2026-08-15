import stateMachine from 'mineflayer-statemachine'
import { inHole, escapeHole } from './escape.js'
import { huntSand, huntBlock, leaveSpawnForGather } from './collect.js'
import { startFollow, comeNow } from './follow.js'
import { idleTick } from './idle.js'
import { nearestHostile, fleeHostile } from './flee.js'
import { runCraft } from './craft.js'
import { gatherWood } from './wood.js'
import { placeHeld } from './place.js'
import { buildNamed } from './build.js'
import { plog, sleep, stopPath, findPlayerNamed, horizFromOrigin, countSand, SPAWN_SAFE_R } from './lib.js'

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

function wantWood(state) {
  return state.chatMode === 'wood'
}

function wantCraft(state) {
  const m = state.chatMode
  return m === 'craft' || m === 'table' || m === 'shovel' || m === 'pick'
}

function wantPlace(state) {
  return state.chatMode === 'place'
}

function wantBuild(state) {
  return state.chatMode === 'build'
}

function wantSkill(state) {
  return wantWood(state) || wantCraft(state) || wantPlace(state) || wantBuild(state)
}

function shouldCollect(state, bot) {
  if (state.chatMode === 'stay' || state.chatMode === 'follow' || state.chatMode === 'come') return false
  if (wantSkill(state)) return false
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

async function runWood(bot, ctx, still) {
  const state = ctx.state
  while (still() && state.chatMode === 'wood' && !state.dead) {
    const done = await gatherWood(bot, state)
    if (done) break
    await sleep(400)
  }
  if (state.chatMode === 'wood') state.chatMode = null
}

async function runCraftSkill(bot, ctx, still) {
  const state = ctx.state
  if (!still() || state.dead) return
  try {
    await runCraft(bot, state)
  } catch (err) {
    plog('craft skill fail ' + (err && err.message))
  }
  if (wantCraft(state)) state.chatMode = null
}

async function runPlace(bot, ctx, still) {
  const state = ctx.state
  if (!still() || state.dead) return
  try {
    await placeHeld(bot, state)
  } catch (err) {
    plog('place skill fail ' + (err && err.message))
  }
  if (state.chatMode === 'place') state.chatMode = null
}

async function runBuild(bot, ctx, still) {
  const state = ctx.state
  if (!still() || state.dead) return
  try {
    await buildNamed(bot, state, state.buildName || 'hut')
  } catch (err) {
    plog('build skill fail ' + (err && err.message))
  }
  if (state.chatMode === 'build') state.chatMode = null
}

export function startStateMachine(bot, state) {
  const { StateTransition, BotStateMachine, NestedStateMachine, BehaviorIdle, BehaviorFollowEntity } = smApi(stateMachine)
  const ctx = { state, bot }
  const targets = {}

  const escape = new SkillState('escape', bot, ctx, runEscape)
  const flee = new SkillState('flee', bot, ctx, runFlee)
  const collect = new SkillState('collect', bot, ctx, runCollect)
  const wood = new SkillState('wood', bot, ctx, runWood)
  const craft = new SkillState('craft', bot, ctx, runCraftSkill)
  const place = new SkillState('place', bot, ctx, runPlace)
  const build = new SkillState('build', bot, ctx, runBuild)

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
    }),
    new StateTransition({
      parent: idle,
      child: wood,
      name: 'idle->wood',
      shouldTransition: () => wantWood(state),
      onTransition: () => plog('transition idle->wood')
    }),
    new StateTransition({
      parent: idle,
      child: craft,
      name: 'idle->craft',
      shouldTransition: () => wantCraft(state),
      onTransition: () => plog('transition idle->craft')
    }),
    new StateTransition({
      parent: idle,
      child: place,
      name: 'idle->place',
      shouldTransition: () => wantPlace(state),
      onTransition: () => plog('transition idle->place')
    }),
    new StateTransition({
      parent: collect,
      child: wood,
      name: 'collect->wood',
      shouldTransition: () => wantWood(state),
      onTransition: () => plog('transition collect->wood')
    }),
    new StateTransition({
      parent: collect,
      child: craft,
      name: 'collect->craft',
      shouldTransition: () => wantCraft(state),
      onTransition: () => plog('transition collect->craft')
    }),
    new StateTransition({
      parent: collect,
      child: place,
      name: 'collect->place',
      shouldTransition: () => wantPlace(state),
      onTransition: () => plog('transition collect->place')
    }),
    new StateTransition({
      parent: follow,
      child: wood,
      name: 'follow->wood',
      shouldTransition: () => !wantFollow(state) && wantWood(state),
      onTransition: () => plog('transition follow->wood')
    }),
    new StateTransition({
      parent: follow,
      child: craft,
      name: 'follow->craft',
      shouldTransition: () => !wantFollow(state) && wantCraft(state),
      onTransition: () => plog('transition follow->craft')
    }),
    new StateTransition({
      parent: follow,
      child: place,
      name: 'follow->place',
      shouldTransition: () => !wantFollow(state) && wantPlace(state),
      onTransition: () => plog('transition follow->place')
    }),
    new StateTransition({
      parent: wood,
      child: follow,
      name: 'wood->follow',
      shouldTransition: () => wantFollow(state),
      onTransition: () => plog('transition wood->follow')
    }),
    new StateTransition({
      parent: wood,
      child: idle,
      name: 'wood->idle',
      shouldTransition: () => !wantWood(state) && !wantFollow(state) && !shouldCollect(state, bot) && !wantCraft(state) && !wantPlace(state) && !wantBuild(state),
      onTransition: () => plog('transition wood->idle')
    }),
    new StateTransition({
      parent: wood,
      child: collect,
      name: 'wood->collect',
      shouldTransition: () => !wantWood(state) && !wantFollow(state) && shouldCollect(state, bot),
      onTransition: () => plog('transition wood->collect')
    }),
    new StateTransition({
      parent: craft,
      child: follow,
      name: 'craft->follow',
      shouldTransition: () => wantFollow(state),
      onTransition: () => plog('transition craft->follow')
    }),
    new StateTransition({
      parent: craft,
      child: idle,
      name: 'craft->idle',
      shouldTransition: () => !wantCraft(state) && !wantFollow(state) && !shouldCollect(state, bot) && !wantWood(state) && !wantPlace(state) && !wantBuild(state),
      onTransition: () => plog('transition craft->idle')
    }),
    new StateTransition({
      parent: craft,
      child: collect,
      name: 'craft->collect',
      shouldTransition: () => !wantCraft(state) && !wantFollow(state) && shouldCollect(state, bot),
      onTransition: () => plog('transition craft->collect')
    }),
    new StateTransition({
      parent: place,
      child: follow,
      name: 'place->follow',
      shouldTransition: () => wantFollow(state),
      onTransition: () => plog('transition place->follow')
    }),
    new StateTransition({
      parent: place,
      child: idle,
      name: 'place->idle',
      shouldTransition: () => !wantPlace(state) && !wantFollow(state) && !shouldCollect(state, bot) && !wantWood(state) && !wantCraft(state) && !wantBuild(state),
      onTransition: () => plog('transition place->idle')
    }),
    new StateTransition({
      parent: place,
      child: collect,
      name: 'place->collect',
      shouldTransition: () => !wantPlace(state) && !wantFollow(state) && shouldCollect(state, bot),
      onTransition: () => plog('transition place->collect')
    }),

    new StateTransition({
      parent: idle,
      child: build,
      name: 'idle->build',
      shouldTransition: () => wantBuild(state),
      onTransition: () => plog('transition idle->build')
    }),
    new StateTransition({
      parent: collect,
      child: build,
      name: 'collect->build',
      shouldTransition: () => wantBuild(state),
      onTransition: () => plog('transition collect->build')
    }),
    new StateTransition({
      parent: follow,
      child: build,
      name: 'follow->build',
      shouldTransition: () => !wantFollow(state) && wantBuild(state),
      onTransition: () => plog('transition follow->build')
    }),
    new StateTransition({
      parent: wood,
      child: build,
      name: 'wood->build',
      shouldTransition: () => !wantWood(state) && wantBuild(state),
      onTransition: () => plog('transition wood->build')
    }),
    new StateTransition({
      parent: craft,
      child: build,
      name: 'craft->build',
      shouldTransition: () => !wantCraft(state) && wantBuild(state),
      onTransition: () => plog('transition craft->build')
    }),
    new StateTransition({
      parent: place,
      child: build,
      name: 'place->build',
      shouldTransition: () => !wantPlace(state) && wantBuild(state),
      onTransition: () => plog('transition place->build')
    }),
    new StateTransition({
      parent: build,
      child: follow,
      name: 'build->follow',
      shouldTransition: () => wantFollow(state),
      onTransition: () => plog('transition build->follow')
    }),
    new StateTransition({
      parent: build,
      child: idle,
      name: 'build->idle',
      shouldTransition: () => !wantBuild(state) && !wantFollow(state) && !shouldCollect(state, bot) && !wantWood(state) && !wantCraft(state) && !wantPlace(state),
      onTransition: () => plog('transition build->idle')
    }),
    new StateTransition({
      parent: build,
      child: collect,
      name: 'build->collect',
      shouldTransition: () => !wantBuild(state) && !wantFollow(state) && shouldCollect(state, bot),
      onTransition: () => plog('transition build->collect')
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
  plog('state machine live nested=work(idle,follow,collect,wood,craft,place,build) root(escape,flee,work) no auto-follow')
  return machine
}
