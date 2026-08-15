import { plog, sleep, gotoNear, stopPath, sayAllowed } from './lib.js'

// Official sleeper.js: findBlock(isABed) then bot.sleep / bot.wake.
// https://github.com/PrismarineJS/mineflayer/blob/master/examples/sleeper.js
// Path to the bed first (pathfinder). Skip if no bed or monsters nearby.

export function isNightOrThunder(bot) {
  try {
    const thunder = !!(bot.isRaining && bot.thunderState > 0)
    if (thunder) return true
    const tod = bot.time && bot.time.timeOfDay
    if (tod == null) return !!(bot.time && bot.time.isDay === false)
    return tod >= 12541 && tod <= 23458
  } catch {
    return false
  }
}

export function findBed(bot) {
  if (!bot || typeof bot.findBlock !== 'function' || typeof bot.isABed !== 'function') return null
  try {
    return bot.findBlock({
      matching: (block) => block && bot.isABed(block),
      maxDistance: 32
    })
  } catch {
    return null
  }
}

export function shouldSleep(bot) {
  if (!isNightOrThunder(bot)) return false
  return !!findBed(bot)
}

export async function wakeUp(bot, state) {
  if (!bot.isSleeping) return false
  try {
    await bot.wake()
    plog('sleep wake morning')
    return true
  } catch (err) {
    plog('sleep wake fail ' + (err && err.message))
    return false
  }
}

export async function goToSleep(bot, state) {
  if (bot.isSleeping) {
    if (!isNightOrThunder(bot)) return wakeUp(bot, state)
    return true
  }
  if (!isNightOrThunder(bot)) {
    plog('sleep skip not night/thunder')
    return false
  }
  const bed = findBed(bot)
  if (!bed || !bed.position) {
    plog('sleep skip no bed')
    return false
  }
  plog('sleep path to bed')
  stopPath(bot)
  const p = bed.position
  await gotoNear(bot, p.x, p.y, p.z, 2, 8000)
  const again = findBed(bot) || bed
  try {
    await bot.sleep(again)
    plog('sleep sleeping')
    if (state) {
      state.phase = 'sleep'
      state.note = 'sleeping'
    }
    return true
  } catch (err) {
    const msg = String(err && err.message || err)
    if (/monsters nearby/i.test(msg)) plog('sleep skip monsters nearby')
    else if (/too far/i.test(msg)) plog('sleep skip bed too far')
    else if (/not night/i.test(msg)) plog('sleep skip not night/thunder')
    else plog('sleep fail ' + msg)
    return false
  }
}

export async function runSleep(bot, ctx, still) {
  const state = ctx.state
  plog('sleep skill from sleeper.js')
  while (still() && !state.dead && state.chatMode === 'sleep') {
    if (bot.isSleeping && !isNightOrThunder(bot)) {
      await wakeUp(bot, state)
      break
    }
    const ok = await goToSleep(bot, state)
    if (!ok) break
    if (bot.isSleeping) {
      await sleep(800)
      continue
    }
    break
  }
  if (state.chatMode === 'sleep') state.chatMode = null
}

export async function run(bot, state) {
  return goToSleep(bot, state)
}
