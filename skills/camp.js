import { Vec3, plog, sleep, posOf, countNamed, countLogs, inventorySummary, horizFromOrigin, findItemByNames, gotoNear, stopPath, sayAllowed, SPAWN_SAFE_R } from './lib.js'
import { leaveSpawnForGather, huntBlock } from './collect.js'
import { punchTree } from './wood.js'
import { placeAt } from './place.js'
import { buildNamedAt, countBuildMaterials, findGroundY, schemSolidCount } from './build.js'
import { craftByName, craftSticks } from './craft.js'
import { CAMP_XZ, markCamp } from './storage.js'

export function campSolidCount() {
  return schemSolidCount('camp') || 46
}

export function campXZ() {
  return { x: CAMP_XZ.x, z: CAMP_XZ.z }
}

export function resolveCampOrigin(bot, guessY) {
  const x = CAMP_XZ.x
  const z = CAMP_XZ.z
  const p = bot.entity && bot.entity.position
  const g = guessY != null ? guessY : (p ? p.y : 64)
  const y = findGroundY(bot, x + 3, z + 3, g)
  return { x, y, z }
}

async function gatherWalls(bot, state, need) {
  let have = countBuildMaterials(bot)
  if (have >= need) return have
  plog('camp gather walls have=' + have + ' need=' + need)
  for (let i = 0; i < 8 && have < need && !state.dead; i++) {
    if (state.chatMode && state.chatMode !== 'camp' && state.chatMode !== 'build') break
    if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
      await leaveSpawnForGather(bot, state)
    }
    const dirt = countNamed(bot, ['dirt', 'grass_block', 'cobblestone'])
    if (dirt < need) {
      try { await huntBlock(bot, state, 'dirt') } catch {}
    }
    have = countBuildMaterials(bot)
    if (have >= need) break
    if (countLogs(bot) < 2) {
      try { await punchTree(bot, state) } catch {}
    }
    have = countBuildMaterials(bot)
  }
  return countBuildMaterials(bot)
}

async function maybeTorches(bot, state, origin) {
  let torches = countNamed(bot, ['torch'])
  if (torches < 1) {
    const fuel = countNamed(bot, ['coal', 'charcoal'])
    if (fuel >= 1) {
      try { await craftSticks(bot, state, 1) } catch {}
      if (countNamed(bot, ['stick']) >= 1) {
        try { await craftByName(bot, state, 'torch', 4) } catch {}
      }
    }
  }
  torches = countNamed(bot, ['torch'])
  if (torches < 1) {
    plog('camp skip torches (none)')
    return 0
  }
  const item = findItemByNames(bot, ['torch'])
  if (!item) return 0
  try { if (typeof bot.equip === 'function') await bot.equip(item, 'hand') } catch {}
  const corners = [[0, 2, 0], [6, 2, 0], [0, 2, 6], [6, 2, 6]]
  let n = 0
  for (const [dx, dy, dz] of corners) {
    const x = origin.x + dx
    const y = origin.y + dy
    const z = origin.z + dz
    if (Math.hypot(x, z) < SPAWN_SAFE_R) continue
    try { await gotoNear(bot, x, y, z, 3, 4000) } catch {}
    const res = await placeAt(bot, x, y, z)
    if (res === true) n++
    await sleep(80)
  }
  plog('camp torches placed=' + n)
  return n
}

export async function runCamp(bot, state) {
  state.phase = 'camp'
  state.note = 'camp gather/build at 32,surface,0'
  state.buildName = 'camp'
  if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
    await leaveSpawnForGather(bot, state)
    if (horizFromOrigin(bot) < SPAWN_SAFE_R) {
      plog('camp refuse spawn, wait')
      await sleep(2000)
      return false
    }
  }
  const need = campSolidCount()
  const have = await gatherWalls(bot, state, need)
  const origin = resolveCampOrigin(bot)
  if (Math.hypot(origin.x, origin.z) < SPAWN_SAFE_R) {
    plog('camp origin inside spawn, abort')
    return false
  }
  state.campOrigin = origin
  markCamp(origin)
  if (have < Math.min(8, need)) {
    state.note = 'camp gathering dirt have=' + have + ' need=' + need
    plog(state.note + ' pos=' + (posOf(bot) && posOf(bot).str))
    return false
  }
  plog('camp build at ' + origin.x + ' ' + origin.y + ' ' + origin.z + ' have=' + have + ' need=' + need)
  const ok = await buildNamedAt(bot, state, 'camp', origin)
  if (ok) {
    state.campBuilt = true
    state.guardPos = { x: origin.x + 3, y: origin.y, z: origin.z + 3 }
    try { await maybeTorches(bot, state, origin) } catch (err) {
      plog('camp torch skip ' + (err && err.message))
    }
    state.note = 'camp up at ' + origin.x + ' ' + origin.y + ' ' + origin.z
    sayAllowed(bot, state, 'camp up')
  }
  plog('camp done ok=' + !!ok + ' inv=' + inventorySummary(bot))
  return !!ok
}

export async function run(bot, state) {
  return runCamp(bot, state)
}
