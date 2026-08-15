import stateMachine from 'mineflayer-statemachine'
import { escapeHole, holeActive, playerPreemptsEscape } from './escape.js'
import { huntSand, huntBlock, leaveSpawnForGather } from './collect.js'
import { startFollow, comeNow } from './follow.js'
import { idleTick } from './idle.js'
import { nearestHostile, fleeHostile } from './flee.js'
import { lookAtNearest } from './look.js'
import { shouldGuard, runGuard, wireHurt, nearestCreeper, stopGuard } from './guard.js'
import { runSleep } from './sleep.js'
import { runCraft } from './craft.js'
import { gatherWood } from './wood.js'
import { placeHeld } from './place.js'
import { buildNamed } from './build.js'
import { runCamp } from './camp.js'
import { runFarm } from './farm.js'
import { plog, sleep, stopPath, findPlayerNamed, horizFromOrigin, SPAWN_SAFE_R } from './lib.js'

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

function wantFarm(state) {
  return state.chatMode === 'farm'
}

function wantSleep(state) {
  return state.chatMode === 'sleep'
}

function wantSkill(state) {
  return wantWood(state) || wantCraft(state) || wantPlace(state) || wantBuild(state) || wantSleep(state) || wantFarm(state)
}

function shouldCollect(state, bot) {
  if (state.chatMode === 'stay' || state.chatMode === 'follow' || state.chatMode === 'come') return false
  if (wantSkill(state)) return false
  return state.chatMode === 'collect'
}

function hole(bot, state) {
  try { return holeActive(bot, state) } catch { return false }
}

function hostile(bot, d = 8) {
  try { return nearestHostile(bot, d) } catch { return null }
}

function creeper(bot, d = 8) {
  try { return nearestCreeper(bot, d) } catch { return null }
}

function guardNow(bot, state) {
  try { return shouldGuard(bot, state) } catch { return false }
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
  while (still() && hole(bot, ctx.state) && !ctx.state.dead) {
    if (playerPreemptsEscape(ctx.state)) {
      plog('escape abort, player cmd ' + ctx.state.chatMode)
      return
    }
    const ok = await escapeHole(bot, ctx.state)
    if (!ok) return
  }
}

async function runFlee(bot, ctx, still) {
  while (still() && !ctx.state.dead) {
    const mob = creeper(bot, 10)
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
    const name = state.buildName || 'hut'
    if (name === 'camp') await runCamp(bot, state)
    else if (name === 'wheat' || name === 'trees') {
      state.farmKind = name
      await runFarm(bot, state)
    } else await buildNamed(bot, state, name)
  } catch (err) {
    plog('build skill fail ' + (err && err.message))
  }
  if (state.chatMode === 'build') state.chatMode = null
}

async function runFarmSkill(bot, ctx, still) {
  const state = ctx.state
  if (!still() || state.dead) return
  try {
    await runFarm(bot, state)
  } catch (err) {
    plog('farm skill fail ' + (err && err.message))
  }
  if (state.chatMode === 'farm') state.chatMode = null
}

async function runSleepSkill(bot, ctx, still) {
  await runSleep(bot, ctx, still)
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
  const farm = new SkillState('farm', bot, ctx, runFarmSkill)
  const sleepState = new SkillState('sleep', bot, ctx, runSleepSkill)
  const guard = new SkillState('guard', bot, ctx, runGuard)

  try { wireHurt(bot, state) } catch (err) { plog('guard wireHurt fail ' + (err && err.message)) }
  try { lookAtNearest(bot) } catch {}
  plog('look from looker.js; guard from guard.js+pvp; sleep from sleeper.js')

  const idle = new BehaviorIdle()
  idle.stateName = 'idle'
  idle.onStateEntered = function () {
    const stay = ctx.state.chatMode === 'stay'
    ctx.state.phase = stay ? 'idle' : 'fun'
    ctx.state.smState = stay ? 'idle' : 'fun'
    ctx.state.note = stay ? 'sm idle stay' : 'sm fun'
    plog('state enter ' + (stay ? 'idle stay' : 'fun'))
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
      shouldTransition: () => !wantWood(state) && !wantFollow(state) && !shouldCollect(state, bot) && !wantCraft(state) && !wantPlace(state) && !wantBuild(state) && !wantSleep(state) && !wantFarm(state),
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
      shouldTransition: () => !wantCraft(state) && !wantFollow(state) && !shouldCollect(state, bot) && !wantWood(state) && !wantPlace(state) && !wantBuild(state) && !wantSleep(state) && !wantFarm(state),
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
      shouldTransition: () => !wantPlace(state) && !wantFollow(state) && !shouldCollect(state, bot) && !wantWood(state) && !wantCraft(state) && !wantBuild(state) && !wantSleep(state) && !wantFarm(state),
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
      shouldTransition: () => !wantBuild(state) && !wantFollow(state) && !shouldCollect(state, bot) && !wantWood(state) && !wantCraft(state) && !wantPlace(state) && !wantSleep(state) && !wantFarm(state),
      onTransition: () => plog('transition build->idle')
    }),
    new StateTransition({
      parent: build,
      child: collect,
      name: 'build->collect',
      shouldTransition: () => !wantBuild(state) && !wantFollow(state) && shouldCollect(state, bot),
      onTransition: () => plog('transition build->collect')
    }),

    new StateTransition({
      parent: idle,
      child: sleepState,
      name: 'idle->sleep',
      shouldTransition: () => wantSleep(state),
      onTransition: () => plog('transition idle->sleep')
    }),
    new StateTransition({
      parent: collect,
      child: sleepState,
      name: 'collect->sleep',
      shouldTransition: () => wantSleep(state),
      onTransition: () => plog('transition collect->sleep')
    }),
    new StateTransition({
      parent: follow,
      child: sleepState,
      name: 'follow->sleep',
      shouldTransition: () => !wantFollow(state) && wantSleep(state),
      onTransition: () => plog('transition follow->sleep')
    }),
    new StateTransition({
      parent: wood,
      child: sleepState,
      name: 'wood->sleep',
      shouldTransition: () => !wantWood(state) && wantSleep(state),
      onTransition: () => plog('transition wood->sleep')
    }),
    new StateTransition({
      parent: craft,
      child: sleepState,
      name: 'craft->sleep',
      shouldTransition: () => !wantCraft(state) && wantSleep(state),
      onTransition: () => plog('transition craft->sleep')
    }),
    new StateTransition({
      parent: place,
      child: sleepState,
      name: 'place->sleep',
      shouldTransition: () => !wantPlace(state) && wantSleep(state),
      onTransition: () => plog('transition place->sleep')
    }),
    new StateTransition({
      parent: build,
      child: sleepState,
      name: 'build->sleep',
      shouldTransition: () => !wantBuild(state) && wantSleep(state),
      onTransition: () => plog('transition build->sleep')
    }),
    new StateTransition({
      parent: sleepState,
      child: follow,
      name: 'sleep->follow',
      shouldTransition: () => wantFollow(state),
      onTransition: () => plog('transition sleep->follow')
    }),
    new StateTransition({
      parent: sleepState,
      child: idle,
      name: 'sleep->idle',
      shouldTransition: () => !wantSleep(state) && !wantFollow(state) && !shouldCollect(state, bot) && !wantWood(state) && !wantCraft(state) && !wantPlace(state) && !wantBuild(state),
      onTransition: () => plog('transition sleep->idle')
    }),
    new StateTransition({
      parent: sleepState,
      child: collect,
      name: 'sleep->collect',
      shouldTransition: () => !wantSleep(state) && !wantFollow(state) && shouldCollect(state, bot),
      onTransition: () => plog('transition sleep->collect')
    }),

    new StateTransition({
      parent: idle,
      child: farm,
      name: 'idle->farm',
      shouldTransition: () => wantFarm(state),
      onTransition: () => plog('transition idle->farm')
    }),
    new StateTransition({
      parent: collect,
      child: farm,
      name: 'collect->farm',
      shouldTransition: () => wantFarm(state),
      onTransition: () => plog('transition collect->farm')
    }),
    new StateTransition({
      parent: follow,
      child: farm,
      name: 'follow->farm',
      shouldTransition: () => !wantFollow(state) && wantFarm(state),
      onTransition: () => plog('transition follow->farm')
    }),
    new StateTransition({
      parent: wood,
      child: farm,
      name: 'wood->farm',
      shouldTransition: () => !wantWood(state) && wantFarm(state),
      onTransition: () => plog('transition wood->farm')
    }),
    new StateTransition({
      parent: craft,
      child: farm,
      name: 'craft->farm',
      shouldTransition: () => !wantCraft(state) && wantFarm(state),
      onTransition: () => plog('transition craft->farm')
    }),
    new StateTransition({
      parent: place,
      child: farm,
      name: 'place->farm',
      shouldTransition: () => !wantPlace(state) && wantFarm(state),
      onTransition: () => plog('transition place->farm')
    }),
    new StateTransition({
      parent: build,
      child: farm,
      name: 'build->farm',
      shouldTransition: () => !wantBuild(state) && wantFarm(state),
      onTransition: () => plog('transition build->farm')
    }),
    new StateTransition({
      parent: sleepState,
      child: farm,
      name: 'sleep->farm',
      shouldTransition: () => !wantSleep(state) && wantFarm(state),
      onTransition: () => plog('transition sleep->farm')
    }),
    new StateTransition({
      parent: farm,
      child: follow,
      name: 'farm->follow',
      shouldTransition: () => wantFollow(state),
      onTransition: () => plog('transition farm->follow')
    }),
    new StateTransition({
      parent: farm,
      child: idle,
      name: 'farm->idle',
      shouldTransition: () => !wantFarm(state) && !wantFollow(state) && !shouldCollect(state, bot) && !wantWood(state) && !wantCraft(state) && !wantPlace(state) && !wantBuild(state) && !wantSleep(state) && !wantFarm(state),
      onTransition: () => plog('transition farm->idle')
    }),
    new StateTransition({
      parent: farm,
      child: collect,
      name: 'farm->collect',
      shouldTransition: () => !wantFarm(state) && !wantFollow(state) && shouldCollect(state, bot),
      onTransition: () => plog('transition farm->collect')
    }),
    new StateTransition({
      parent: farm,
      child: build,
      name: 'farm->build',
      shouldTransition: () => !wantFarm(state) && wantBuild(state),
      onTransition: () => plog('transition farm->build')
    })

  ]

  const work = new NestedStateMachine(workTransitions, idle)
  work.stateName = 'work'

  const rootTransitions = [
    new StateTransition({
      parent: work,
      child: escape,
      name: 'work->escape',
      shouldTransition: () => hole(bot, state),
      onTransition: () => plog('transition work->escape')
    }),
    new StateTransition({
      parent: work,
      child: flee,
      name: 'work->flee',
      shouldTransition: () => !hole(bot, state) && !!creeper(bot, 8),
      onTransition: () => plog('transition work->flee')
    }),
    new StateTransition({
      parent: work,
      child: guard,
      name: 'work->guard',
      shouldTransition: () => !hole(bot, state) && !creeper(bot, 8) && guardNow(bot, state),
      onTransition: () => plog('transition work->guard')
    }),
    new StateTransition({
      parent: escape,
      child: flee,
      name: 'escape->flee',
      shouldTransition: () => !hole(bot, state) && !!creeper(bot, 8),
      onTransition: () => plog('transition escape->flee')
    }),
    new StateTransition({
      parent: escape,
      child: guard,
      name: 'escape->guard',
      shouldTransition: () => !hole(bot, state) && !creeper(bot, 8) && guardNow(bot, state),
      onTransition: () => plog('transition escape->guard')
    }),
    new StateTransition({
      parent: escape,
      child: work,
      name: 'escape->work',
      shouldTransition: () => !hole(bot, state) && !creeper(bot, 8) && !guardNow(bot, state),
      onTransition: () => plog('transition escape->work')
    }),
    new StateTransition({
      parent: flee,
      child: escape,
      name: 'flee->escape',
      shouldTransition: () => hole(bot, state),
      onTransition: () => plog('transition flee->escape')
    }),
    new StateTransition({
      parent: flee,
      child: guard,
      name: 'flee->guard',
      shouldTransition: () => !hole(bot, state) && !creeper(bot, 8) && guardNow(bot, state),
      onTransition: () => plog('transition flee->guard')
    }),
    new StateTransition({
      parent: flee,
      child: work,
      name: 'flee->work',
      shouldTransition: () => !hole(bot, state) && !creeper(bot, 8) && !guardNow(bot, state),
      onTransition: () => plog('transition flee->work')
    }),
    new StateTransition({
      parent: guard,
      child: escape,
      name: 'guard->escape',
      shouldTransition: () => hole(bot, state),
      onTransition: () => { try { stopGuard(bot) } catch {}; plog('transition guard->escape') }
    }),
    new StateTransition({
      parent: guard,
      child: flee,
      name: 'guard->flee',
      shouldTransition: () => !hole(bot, state) && !!creeper(bot, 8),
      onTransition: () => { try { stopGuard(bot) } catch {}; plog('transition guard->flee') }
    }),
    new StateTransition({
      parent: guard,
      child: work,
      name: 'guard->work',
      shouldTransition: () => !hole(bot, state) && !creeper(bot, 8) && !guardNow(bot, state),
      onTransition: () => { try { stopGuard(bot) } catch {}; plog('transition guard->work') }
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
  plog('state machine live nested=work(fun,follow,collect,wood,craft,place,build,farm,sleep) root(escape,flee,guard,work) camp+farm looker+guard+sleeper no auto-follow')
  return machine
}
