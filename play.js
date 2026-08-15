import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pathfinderPkg from 'mineflayer-pathfinder'
import Vec3Import from 'vec3'
import { scoreEpisode } from './rl/score.js'
import { inHole as skillInHole, escapeHole as skillEscapeHole, isOneBlockHole as skillOneBlock } from './skills/escape.js'
import { huntSand } from './skills/collect.js'
import { honorFollow } from './skills/follow.js'
import { idleTick } from './skills/idle.js'

const { goals } = pathfinderPkg
const Vec3 = Vec3Import.Vec3 || Vec3Import

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG = path.join(__dirname, 'bot.log')
const STATUS = path.join(__dirname, 'STATUS.txt')
const LEARNINGS = path.join(__dirname, 'LEARNINGS.md')
const EPISODES = path.join(__dirname, 'rl', 'episodes.jsonl')

const GRAVITY = new Set(['sand', 'red_sand', 'gravel', 'concrete_powder', 'anvil', 'dragon_egg'])
const SAND_ITEMS = new Set(['sand', 'red_sand'])
const STONE_ITEMS = new Set(['sandstone', 'cut_sandstone', 'smooth_sandstone', 'chiseled_sandstone', 'red_sandstone'])
const FALLBACK_ITEMS = ['dirt', 'grass_block', 'cobblestone']
const PLAYER_NAMES = ['har0x', 'glenn']
const HOSTILES = new Set(['creeper', 'zombie', 'skeleton', 'husk', 'stray', 'drowned', 'spider'])
const FOLLOW_RANGE = 5
const GATHER_LEASH = 8
const DIG_REACH = 4.5
const GATHER_NAMES = new Set(['sand', 'red_sand', 'sandstone', 'dirt', 'grass_block', 'gravel'])
let digBusy = false
let griefPlanks = 0

function plog(msg) {
  const line = `[${new Date().toISOString()}] [play] ${msg}`
  console.log(line)
  try { fs.appendFileSync(LOG, line + '\n') } catch {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function posOf(bot) {
  const p = bot.entity && bot.entity.position
  if (!p) return null
  return { x: p.x, y: p.y, z: p.z, str: `${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}` }
}

function bareName(name) {
  if (!name) return ''
  const n = String(name)
  const c = n.indexOf(':')
  return (c >= 0 ? n.slice(c + 1) : n).toLowerCase()
}

function resolveItemName(bot, item) {
  if (!item) return ''
  if (item.name) return bareName(item.name)
  try {
    const id = item.type != null ? item.type : item.id
    const rec = bot.registry && bot.registry.items && bot.registry.items[id]
    if (rec && rec.name) return bareName(rec.name)
  } catch {}
  return ''
}

function eachInventoryItem(bot, fn) {
  let usedSlots = false
  try {
    const slots = bot.inventory && bot.inventory.slots
    if (slots && slots.length) {
      for (let i = 0; i < slots.length; i++) {
        if (slots[i]) {
          usedSlots = true
          fn(slots[i])
        }
      }
    }
  } catch {}
  if (usedSlots) return
  try {
    for (const it of bot.inventory.items()) {
      if (it) fn(it)
    }
  } catch {}
}

function countNamed(bot, names) {
  try {
    const set = names instanceof Set ? names : new Set(names)
    let n = 0
    eachInventoryItem(bot, (it) => {
      if (set.has(resolveItemName(bot, it))) n += Number(it.count) || 0
    })
    return n
  } catch {
    return 0
  }
}

function countAllItems(bot) {
  let n = 0
  eachInventoryItem(bot, (it) => { n += Number(it.count) || 0 })
  return n
}

function countGatherInv(bot) {
  return countNamed(bot, GATHER_NAMES)
}

function inventorySummary(bot) {
  const bag = {}
  eachInventoryItem(bot, (it) => {
    const n = resolveItemName(bot, it) || '?'
    bag[n] = (bag[n] || 0) + (Number(it.count) || 0)
  })
  const parts = Object.keys(bag).sort().map((k) => k + '=' + bag[k])
  return parts.length ? parts.join(',') : 'empty'
}

function countSand(bot) { return countNamed(bot, SAND_ITEMS) }
function countStone(bot) { return countNamed(bot, STONE_ITEMS) }

function findItem(bot, names) {
  try {
    const set = new Set(names)
    return bot.inventory.items().find((i) => i && set.has(i.name)) || null
  } catch {
    return null
  }
}

function vitals(bot) {
  let health = '?'
  let food = '?'
  try { if (bot.health != null) health = Number(bot.health).toFixed(1) } catch {}
  try { if (bot.food != null) food = Number(bot.food).toFixed(1) } catch {}
  return { health, food }
}

function writeStatus(bot, extra) {
  const p = posOf(bot)
  const v = vitals(bot)
  const lines = [
    `time=${new Date().toISOString()}`,
    `pid=${process.pid}`,
    `version=${bot.version || ''}`,
    `host=45.248.51.231:25566`,
    `username=${bot.username || 'Steve'}`,
    `position=${p ? p.str : 'unknown'}`,
    `health=${v.health}`,
    `food=${v.food}`,
    `deaths=${extra.deaths || 0}`,
    `sand=${countSand(bot)}`,
    `sandstone=${countStone(bot)}`,
    `dirt=${countNamed(bot, ['dirt', 'grass_block'])}`,
    `food_inv=${countFood(bot)}`,
    `left_hole=${extra.leftHole ? 'yes' : 'no'}`,
    `house=${extra.housePlaced ? 'yes' : 'no'}`,
    `house_blocks=${extra.houseBlocks || 0}`,
    `build_material=${extra.buildMaterial || 'none'}`,
    `phase=${extra.phase || ''}`,
    `note=${extra.note || ''}`
  ]
  try { fs.writeFileSync(STATUS, lines.join('\n') + '\n') } catch {}
}

function appendLearning(note, extra) {
  try {
    const pos = extra && extra.pos ? extra.pos : '?'
    const deaths = extra && extra.deaths != null ? extra.deaths : '?'
    const extraBits = extra && extra.score != null ? ' score=' + extra.score : ''
    const line = `- [${new Date().toISOString()}] ${note} pos=${pos} deaths=${deaths}${extraBits}`
    fs.appendFileSync(LEARNINGS, line + '\n')
  } catch {}
}

function logEpisode(bot, state, reason, notes) {
  try {
    const p = posOf(bot)
    const v = vitals(bot)
    const seconds = Math.max(0, (Date.now() - (state.episodeStart || Date.now())) / 1000)
    const sand = countSand(bot)
    const dirt = countNamed(bot, ['dirt', 'grass_block'])
    const sandstone = countStone(bot)
    const house = !!state.housePlaced
    const house_blocks = state.houseBlocks || 0
    const grief = griefPlanks || 0
    const deathsThis = reason === 'death' ? 1 : 0
    const rec = {
      t: new Date().toISOString(),
      reason,
      pos: p ? p.str : '?',
      deaths: state.deaths || 0,
      sand,
      dirt,
      sandstone,
      house,
      health: v.health,
      food: v.food,
      seconds: Number(seconds.toFixed(1)),
      score: 0,
      notes: notes || ''
    }
    rec.score = Number(scoreEpisode({
      sand,
      dirt,
      sandstone,
      house_blocks,
      house,
      seconds: rec.seconds,
      deaths: deathsThis,
      grief_planks: grief
    }).toFixed(2))
    rec.house_blocks = house_blocks
    rec.grief_planks = grief
    fs.appendFileSync(EPISODES, JSON.stringify(rec) + '\n')
    appendLearning(
      'episode ' + reason + ' score=' + rec.score + ' sand=' + sand + ' dirt=' + dirt +
        ' sandstone=' + sandstone + ' house=' + (house ? 'yes' : 'no') +
        ' grief=' + grief + ' ' + rec.seconds + 's',
      { pos: rec.pos, deaths: rec.deaths, score: rec.score }
    )
    plog('episode ' + reason + ' score=' + rec.score + ' ' + rec.seconds + 's grief=' + grief)
  } catch (err) {
    plog('episode log fail ' + (err && err.message))
  }
  state.episodeStart = Date.now()
  griefPlanks = 0
  state.griefPlanks = 0
}

function findPlayer(bot) {
  try {
    for (const [name, pl] of Object.entries(bot.players || {})) {
      if (PLAYER_NAMES.includes(String(name).toLowerCase()) && pl && pl.entity && pl.entity.position) {
        return pl.entity
      }
    }
    for (const e of Object.values(bot.entities || {})) {
      const n = (e.username || e.name || '').toLowerCase()
      if (e.type === 'player' && PLAYER_NAMES.includes(n) && e.position) return e
    }
  } catch {}
  return null
}

function nearestHostile(bot, maxD = 8) {
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
      if (d < bestD) { best = e; bestD = d }
    }
  } catch {}
  return best
}

function inWater(bot) {
  try {
    const b = bot.blockAt(bot.entity.position)
    const n = b && b.name
    return n === 'water' || n === 'flowing_water'
  } catch {
    return false
  }
}

async function clearMove(bot) {
  try {
    bot.setControlState('forward', false)
    bot.setControlState('back', false)
    bot.setControlState('left', false)
    bot.setControlState('right', false)
    bot.setControlState('sprint', false)
    bot.setControlState('jump', false)
  } catch {}
}

async function fleeHostile(bot, mob) {
  try { if (bot.pathfinder) bot.pathfinder.setGoal(null) } catch {}
  try { bot.setControlState('jump', false) } catch {}
  const pos = bot.entity.position
  const dx = pos.x - mob.position.x
  const dz = pos.z - mob.position.z
  const len = Math.hypot(dx, dz) || 1
  const tx = pos.x + (dx / len) * 10
  const tz = pos.z + (dz / len) * 10
  const name = String(mob.name || mob.displayName || 'mob')
  plog('flee ' + name + ' d=' + mob.position.distanceTo(pos).toFixed(1) + ' (no jump)')
  const ok = await safeGoto(bot, tx, pos.y, tz, 2, 2500)
  if (!ok) {
    try { await bot.lookAt(pos.offset(dx, 0, dz), true) } catch {}
    try {
      bot.setControlState('jump', false)
      bot.setControlState('sprint', true)
      bot.setControlState('forward', true)
    } catch {}
    await sleep(700)
    await clearMove(bot)
  }
}

async function safeGoto(bot, x, y, z, range = 2, ms = 8000) {
  if (!bot.pathfinder || !goals) return false
  const dest = new Vec3(x, y, z)
  const start = bot.entity && bot.entity.position
  const startD = start ? start.distanceTo(dest) : 99
  try {
    const g = new goals.GoalNear(x, y, z, range)
    const p = bot.pathfinder.goto(g)
    const t = sleep(ms).then(() => { try { bot.pathfinder.setGoal(null) } catch {}; throw new Error('goto-timeout') })
    await Promise.race([p, t])
  } catch (err) {
    const msg = err && err.message
    if (msg && msg !== 'goto-timeout' && msg !== 'No path to the goal!' && msg !== 'The goal was changed before it could be completed!') {
      plog('goto fail ' + msg)
    }
    try { bot.pathfinder.setGoal(null) } catch {}
  }
  const now = bot.entity && bot.entity.position
  if (!now) return false
  const d = now.distanceTo(dest)
  if (d <= range + 1.2) return true
  if (start && now.distanceTo(start) < 0.35) return false
  return d < startD - 0.5
}

function startFollow(bot, entity, range = FOLLOW_RANGE) {
  if (!bot.pathfinder || !goals || !goals.GoalFollow || !entity) return false
  try {
    bot.pathfinder.setGoal(new goals.GoalFollow(entity, range), true)
    return true
  } catch (err) {
    plog('follow fail ' + (err && err.message))
    return false
  }
}

function stopPath(bot) {
  try { if (bot.collectBlock && typeof bot.collectBlock.cancelTask === 'function') bot.collectBlock.cancelTask() } catch {}
  try { if (bot.pathfinder) bot.pathfinder.setGoal(null) } catch {}
}

function inHole(bot) {
  return skillInHole(bot)
}

function isOneBlockHole(bot) {
  return skillOneBlock(bot)
}

async function maybeJumpOutOfHole(bot) {
  if (!inHole(bot)) return false
  if (!isOneBlockHole(bot)) {
    plog('jump refused, not a 1-block hole')
    return false
  }
  plog('jump 1-block hole')
  try { bot.setControlState('jump', true) } catch {}
  await sleep(350)
  try { bot.setControlState('jump', false) } catch {}
  return true
}

async function pillarOutOfHole(bot) {
  let dirt = null
  try {
    dirt = bot.inventory.items().find((i) => {
      const n = resolveItemName(bot, i)
      return n === 'dirt' || n === 'grass_block'
    }) || null
  } catch {}
  if (!dirt) dirt = findItem(bot, ['dirt', 'grass_block'])
  if (!dirt) {
    plog('pillar fail, no dirt')
    return false
  }
  const y0 = bot.entity && bot.entity.position ? bot.entity.position.y : 0
  try {
    await bot.equip(dirt, 'hand')
  } catch (err) {
    plog('pillar equip fail ' + (err && err.message))
    return false
  }
  const under = feetBlock(bot, -1)
  if (!under || !under.name || under.name === 'air' || under.name === 'cave_air' || under.name === 'void_air') {
    plog('pillar no floor under=' + (under && under.name))
    return false
  }
  plog('pillar dirt underfoot y=' + y0.toFixed(2) + ' ref=' + under.name)
  try { await bot.look(bot.entity.yaw, 1.45, true) } catch {}
  try { bot.setControlState('jump', true) } catch {}
  await sleep(80)
  let placed = false
  try {
    await bot.placeBlock(under, new Vec3(0, 1, 0))
    placed = true
    plog('pillar placed on ' + under.name)
  } catch (err) {
    plog('pillar placeBlock fail ' + (err && err.message))
    const p = bot.entity && bot.entity.position
    if (p) {
      const res = await placeAt(bot, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
      placed = res === 'placed' || res === 'exists'
      plog('pillar placeAt ' + res)
    }
  }
  await sleep(220)
  try { bot.setControlState('jump', false) } catch {}
  const y1 = bot.entity && bot.entity.position ? bot.entity.position.y : y0
  return placed || y1 > y0 + 0.35
}

async function escapeHole(bot, state) {
  if (!inHole(bot)) {
    state.leftHole = true
    return
  }
  state.leftHole = false
  return skillEscapeHole(bot, state)
}

async function escapeHoleLegacy(bot, state) {
  if (!inHole(bot)) {
    state.leftHole = true
    return
  }
  state.phase = 'escape'
  const start = posOf(bot)
  const dirtN = countNamed(bot, ['dirt', 'grass_block'])
  plog('escape start ' + (start && start.str) + ' dirt=' + dirtN + ' oneBlock=' + isOneBlockHole(bot))
  writeStatus(bot, state)
  const deadline = Date.now() + 25000
  let jumped = false
  while (Date.now() < deadline && !state.dead) {
    const creep = nearestHostile(bot, 8)
    if (creep) { await fleeHostile(bot, creep); continue }
    if (!inHole(bot)) {
      state.leftHole = true
      plog('left hole at ' + (posOf(bot) && posOf(bot).str))
      await clearMove(bot)
      return
    }
    if (isOneBlockHole(bot) && !jumped) {
      jumped = true
      await maybeJumpOutOfHole(bot)
      await sleep(250)
      if (!inHole(bot)) {
        state.leftHole = true
        plog('left hole by jump at ' + (posOf(bot) && posOf(bot).str))
        await clearMove(bot)
        return
      }
      plog('jump failed, will pillar')
    } else if (!isOneBlockHole(bot)) {
      plog('deeper than 1-block, pillar (no jump-walk)')
    }
    const ok = await pillarOutOfHole(bot)
    if (ok && !inHole(bot)) {
      state.leftHole = true
      plog('left hole by pillar at ' + (posOf(bot) && posOf(bot).str))
      await clearMove(bot)
      return
    }
    await sleep(150)
  }
  if (!inHole(bot)) state.leftHole = true
  plog('escape done left=' + state.leftHole + ' pos=' + (posOf(bot) && posOf(bot).str))
  await clearMove(bot)
}

function isSandBlock(b) {
  const n = bareName(b && b.name)
  return n === 'sand' || n === 'red_sand'
}

function isLogBlock(b) {
  return b && typeof b.name === 'string' && (b.name.endsWith('_log') || b.name.endsWith('_stem'))
}

function isDirtBlock(b) {
  const n = bareName(b && b.name)
  return n === 'dirt' || n === 'grass_block'
}

function isStoneishBlock(b) {
  const n = bareName(b && b.name)
  return n === 'sandstone' || n === 'gravel'
}

function isPlankOrCobble(b) {
  return b && (b.name === 'oak_planks' || b.name === 'cobblestone' || (typeof b.name === 'string' && b.name.endsWith('_planks')))
}

function isPlayerBuilt(b) {
  if (!b || !b.name) return false
  const n = bareName(b.name)
  if (GATHER_NAMES.has(n)) return false
  if (n.includes('planks') || n.endsWith('_log') || n.endsWith('_wood') || n.endsWith('_stem') || n.endsWith('_hyphae')) return true
  if (n.includes('door') || n.includes('chest') || n.includes('trapdoor') || n.includes('fence') || n.includes('gate')) return true
  if (n.includes('stairs') || n.includes('slab') || n.includes('sign') || n.includes('bed') || n.includes('banner')) return true
  if (n.includes('glass') || n.includes('wool') || n.includes('terracotta') || n.endsWith('_concrete')) return true
  if (n === 'crafting_table' || n === 'furnace' || n === 'blast_furnace' || n === 'smoker' || n === 'barrel' || n === 'hopper') return true
  if (n === 'torch' || n === 'wall_torch' || n === 'lantern' || n === 'ladder' || n === 'scaffolding' || n === 'bookshelf') return true
  if (n === 'cobblestone' || n.includes('wood') || n.includes('log')) return true
  return false
}

function isNaturalStone(b) {
  return b && (b.name === 'stone' || b.name === 'cobblestone' || b.name === 'andesite' || b.name === 'diorite' || b.name === 'granite')
}

function isSlowHandBlock(b) {
  if (!b || !b.name) return false
  const n = b.name
  return n === 'cobblestone' || n === 'stone' || n === 'sandstone' || n.endsWith('_sandstone') || n === 'deepslate'
}

function isGatherBlock(b) {
  if (!b || !b.name) return false
  if (isPlayerBuilt(b)) return false
  return GATHER_NAMES.has(bareName(b.name))
}

function standingOnForbidden(bot) {
  const under = feetBlock(bot, -1)
  if (!under || !under.name) return false
  const n = bareName(under.name)
  if (n === 'air' || n === 'cave_air' || n === 'void_air' || n === 'water' || n === 'lava' || n === 'flowing_water' || n === 'flowing_lava') return false
  if (isGatherBlock(under)) return false
  return isPlayerBuilt(under) || n.includes('planks') || !GATHER_NAMES.has(n)
}

async function stepToAllowedFloor(bot) {
  const under = feetBlock(bot, -1)
  if (isGatherBlock(under)) return true
  if (under && under.name) plog('standing on forbidden ' + under.name + ', will not dig it')
  const p = bot.entity && bot.entity.position
  if (!p) return false
  const ox = Math.floor(p.x)
  const oy = Math.floor(p.y)
  const oz = Math.floor(p.z)
  const tries = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  for (const [dx, dz] of tries) {
    let floor = null
    let body = null
    let head = null
    try {
      floor = bot.blockAt(new Vec3(ox + dx, oy - 1, oz + dz))
      body = bot.blockAt(new Vec3(ox + dx, oy, oz + dz))
      head = bot.blockAt(new Vec3(ox + dx, oy + 1, oz + dz))
    } catch {}
    if (!isGatherBlock(floor)) continue
    if (body && body.boundingBox === 'block') continue
    if (head && head.boundingBox === 'block') continue
    plog('step to ' + floor.name + ' at ' + (ox + dx) + ' ' + (oy - 1) + ' ' + (oz + dz))
    await walkTowardNoJump(bot, ox + dx + 0.5, oz + dz + 0.5, 800)
    if (isGatherBlock(feetBlock(bot, -1))) return true
  }
  plog('no nearby sand/dirt to step onto, idle')
  return false
}

function isSolidDiggable(b) {
  if (!b || !b.name) return false
  const n = b.name
  if (n === 'air' || n === 'cave_air' || n === 'void_air' || n === 'water' || n === 'lava' || n === 'flowing_water' || n === 'flowing_lava') return false
  if (n === 'bedrock' || n === 'barrier' || n === 'command_block' || n === 'end_portal') return false
  if (b.boundingBox && b.boundingBox !== 'block') return false
  return true
}

function feetBlock(bot, dy = -1) {
  try {
    const p = bot.entity.position
    return bot.blockAt(new Vec3(Math.floor(p.x), Math.floor(p.y) + dy, Math.floor(p.z)))
  } catch {
    return null
  }
}

function localDigCandidates(bot) {
  const out = []
  const p = bot.entity && bot.entity.position
  if (!p) return out
  const ox = Math.floor(p.x)
  const oy = Math.floor(p.y)
  const oz = Math.floor(p.z)
  const offsets = [
    [0, -1, 0],
    [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1],
    [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [1, -1, 1], [-1, -1, -1], [1, -1, -1], [-1, -1, 1],
    [0, -2, 0]
  ]
  for (const [dx, dy, dz] of offsets) {
    let b = null
    try { b = bot.blockAt(new Vec3(ox + dx, oy + dy, oz + dz)) } catch {}
    if (b) out.push(b)
  }
  return out
}

function logFeet(bot) {
  const p = bot.entity && bot.entity.position
  if (!p) return
  const names = []
  for (const [label, dy] of [['in', 0], ['under', -1], ['under2', -2]]) {
    let b = null
    try { b = bot.blockAt(new Vec3(Math.floor(p.x), Math.floor(p.y) + dy, Math.floor(p.z))) } catch {}
    names.push(label + '=' + (b && b.name ? b.name : 'null'))
  }
  const sides = []
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let b = null
    try { b = bot.blockAt(new Vec3(Math.floor(p.x) + dx, Math.floor(p.y) - 1, Math.floor(p.z) + dz)) } catch {}
    sides.push((b && b.name) || 'null')
  }
  plog('feet ' + names.join(' ') + ' sides=' + sides.join(','))
}

async function approachForDig(bot, block) {
  const dest = block.position.offset(0.5, 0.5, 0.5)
  const pos = bot.entity && bot.entity.position
  if (!pos) return false
  const d0 = pos.distanceTo(dest)
  if (d0 <= DIG_REACH) return true
  plog('walk to ' + block.name + ' at ' + block.position.x + ' ' + block.position.y + ' ' + block.position.z + ' d=' + d0.toFixed(1))
  try { if (bot.pathfinder) bot.pathfinder.setGoal(null) } catch {}
  let reached = false
  if (bot.pathfinder && goals && goals.GoalGetToBlock) {
    try {
      const g = new goals.GoalGetToBlock(block.position.x, block.position.y, block.position.z)
      const p = bot.pathfinder.goto(g)
      const t = sleep(8000).then(() => { try { bot.pathfinder.setGoal(null) } catch {}; throw new Error('goto-timeout') })
      await Promise.race([p, t])
      reached = true
    } catch (err) {
      const msg = err && err.message
      if (msg && msg !== 'goto-timeout' && msg !== 'No path to the goal!' && msg !== 'The goal was changed before it could be completed!') {
        plog('goto fail ' + msg)
      }
      try { bot.pathfinder.setGoal(null) } catch {}
    }
  }
  if (!reached) {
    await safeGoto(bot, block.position.x, block.position.y + 1, block.position.z, 2, 8000)
  }
  const now = bot.entity && bot.entity.position
  if (!now) return false
  const d = now.distanceTo(dest)
  if (d <= DIG_REACH) return true
  plog('still too far d=' + d.toFixed(1) + ' skip dig')
  return false
}

async function digBlockNow(bot, block) {
  if (!block || !block.position) return false
  if (digBusy || bot.targetDigBlock) {
    plog('skip dig, already busy')
    return false
  }
  if (isPlayerBuilt(block) || !isGatherBlock(block) || !GATHER_NAMES.has(bareName(block.name))) {
    plog('skip forbidden ' + (block.name || '?'))
    return false
  }
  if (Math.hypot(block.position.x, block.position.z) < SPAWN_SAFE_R) {
    plog('skip collect inside spawn ' + block.name)
    return false
  }
  digBusy = true
  try {
    const before = countGatherInv(bot)
    const ok = await collectViaPlugin(bot, block, 'gather-legacy')
    return ok || countGatherInv(bot) > before
  } finally {
    digBusy = false
  }
}

function isItemEntity(e) {
  if (!e || !e.position) return false
  const n = String(e.name || '').toLowerCase()
  const t = String(e.type || '').toLowerCase()
  return n === 'item' || n === 'item_entity' || t === 'item' || t === 'item_entity'
}

function nearestItemEntity(bot, maxD = 4) {
  const pos = bot.entity && bot.entity.position
  if (!pos) return null
  let best = null
  let bestD = maxD
  try {
    for (const e of Object.values(bot.entities || {})) {
      if (!isItemEntity(e)) continue
      const d = e.position.distanceTo(pos)
      if (d < bestD) { best = e; bestD = d }
    }
  } catch {}
  return best
}

async function scoopItems(bot) {
  const best = nearestItemEntity(bot, 3.5)
  if (!best) return
  const pos = bot.entity.position
  const bestD = best.position.distanceTo(pos)
  if (bestD <= 1.0) return
  plog('scoop item d=' + bestD.toFixed(1))
  await safeGoto(bot, best.position.x, best.position.y, best.position.z, 0.8, 2000)
}

async function pickupAfterDig(bot, dropPos, beforeCount) {
  const item = nearestItemEntity(bot, 6)
  if (item && item.position && Math.hypot(item.position.x, item.position.z) >= SPAWN_SAFE_R) {
    await collectViaPlugin(bot, item, 'pickup-item', 8000)
  }
  if (countGatherInv(bot) > beforeCount) {
    plog('picked up inv=' + countGatherInv(bot) + ' items=' + inventorySummary(bot))
    return true
  }
  plog('pickup timeout before=' + beforeCount + ' after=' + countGatherInv(bot) + ' items=' + inventorySummary(bot))
  return countGatherInv(bot) > beforeCount
}

function findClosestBlock(bot, pred, maxDistance = 16) {
  const here = bot.entity && bot.entity.position
  if (!here) return null
  let block = null
  try {
    block = bot.findBlock({ matching: (b) => pred(b) && !isPlayerBuilt(b), maxDistance, point: here })
  } catch (err) {
    plog('findBlock fail ' + (err && err.message))
  }
  if (block && !isPlayerBuilt(block)) return block
  const origin = here.floored()
  const r = Math.min(32, Math.max(8, maxDistance))
  let best = null
  let bestD = 99
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -6; dy <= 3; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        let b = null
        try { b = bot.blockAt(origin.offset(dx, dy, dz)) } catch {}
        if (!pred(b) || isPlayerBuilt(b)) continue
        const d = Math.hypot(dx, dy, dz)
        if (d < bestD) { best = b; bestD = d }
      }
    }
  }
  return best
}

function pickGatherTarget(bot, pred, maxDistance = GATHER_LEASH) {
  if (standingOnForbidden(bot)) return null
  const under = feetBlock(bot, -1)
  if (under && isGatherBlock(under) && (!pred || pred(under))) return under
  const pos = bot.entity && bot.entity.position
  let best = null
  let bestD = 99
  for (const b of localDigCandidates(bot)) {
    if (!isGatherBlock(b)) continue
    if (pred && !pred(b)) continue
    if (!pos) { best = b; break }
    const d = pos.distanceTo(b.position.offset(0.5, 0.5, 0.5))
    if (d < bestD) { best = b; bestD = d }
  }
  if (best) return best
  const want = pred
    ? (b) => pred(b) && isGatherBlock(b)
    : isGatherBlock
  return findClosestBlock(bot, want, Math.min(maxDistance, GATHER_LEASH))
}

async function digNearby(bot, state, pred, maxDistance = GATHER_LEASH) {
  if (state.dead || digBusy) return false
  const creep = nearestHostile(bot, 8)
  if (creep) { await fleeHostile(bot, creep); return false }

  const block = pickGatherTarget(bot, pred, maxDistance)
  if (!block) {
    plog('no gather target in range')
    return false
  }
  if (isPlayerBuilt(block)) {
    plog('skip player-built ' + block.name)
    return false
  }
  plog('target ' + block.name + ' at ' + block.position.x + ' ' + block.position.y + ' ' + block.position.z)
  return digBlockNow(bot, block)
}

function cliffAhead(bot, x, z, maxDrop = 3) {
  try {
    const y0 = Math.floor(bot.entity.position.y)
    const fx = Math.floor(x)
    const fz = Math.floor(z)
    for (let y = y0 + 1; y >= y0 - maxDrop; y--) {
      const b = bot.blockAt(new Vec3(fx, y, fz))
      if (b && b.boundingBox === 'block') return false
    }
    return true
  } catch {
    return true
  }
}

function needsStepUp(bot, x, z) {
  try {
    const y0 = Math.floor(bot.entity.position.y)
    const b = bot.blockAt(new Vec3(Math.floor(x), y0, Math.floor(z)))
    const a = bot.blockAt(new Vec3(Math.floor(x), y0 + 1, Math.floor(z)))
    return !!(b && b.boundingBox === 'block' && a && a.boundingBox !== 'block')
  } catch {
    return false
  }
}

async function walkTowardNoJump(bot, x, z, ms = 1400) {
  const pos = bot.entity && bot.entity.position
  if (!pos) return false
  const dx = x - pos.x
  const dz = z - pos.z
  const len = Math.hypot(dx, dz) || 1
  const nx = pos.x + (dx / len) * 2
  const nz = pos.z + (dz / len) * 2
  if (cliffAhead(bot, nx, nz, 3) && !needsStepUp(bot, nx, nz)) {
    plog('refuse walk, cliff ahead')
    return false
  }
  const step = needsStepUp(bot, nx, nz) || needsStepUp(bot, pos.x + dx / len, pos.z + dz / len)
  try { await bot.lookAt(new Vec3(x, pos.y + 1, z), true) } catch {}
  try { bot.setControlState('forward', true) } catch {}
  if (step) {
    try { bot.setControlState('jump', true) } catch {}
  }
  await sleep(ms)
  const moved = bot.entity && bot.entity.position.distanceTo(pos)
  if (moved != null && moved < 0.25) {
    try { bot.setControlState('jump', true) } catch {}
    await sleep(350)
  }
  await clearMove(bot)
  return true
}

const FOOD_ITEMS = new Set([
  'sweet_berries', 'glow_berries', 'apple', 'bread',
  'carrot', 'potato', 'baked_potato', 'melon_slice',
  'porkchop', 'cooked_porkchop', 'raw_porkchop',
  'beef', 'cooked_beef', 'raw_beef',
  'chicken', 'cooked_chicken', 'raw_chicken',
  'mutton', 'cooked_mutton', 'raw_mutton'
])
const FOOD_MOBS = new Set(['cow', 'pig', 'chicken', 'sheep'])
const FOOD_SCAN_R = 48
const FOOD_NEAR_R = 16
const FOOD_FOLLOW_RANGE = 8

function foodScanRadius(bot) {
  let r = FOOD_SCAN_R
  try {
    const e = bot && bot.entity
    const raw = (e && (e.renderDistance != null ? e.renderDistance : e.render))
      || (bot && bot.settings && bot.settings.entityRenderDistance)
    const n = Number(raw)
    if (Number.isFinite(n) && n > r) r = n
  } catch {}
  return r
}

function nearbyEntityNames(bot, maxD) {
  const pos = bot.entity && bot.entity.position
  const out = []
  if (!pos) return out
  try {
    for (const e of Object.values(bot.entities || {})) {
      if (!e || !e.position) continue
      if (bot.entity && e.id === bot.entity.id) continue
      const d = e.position.distanceTo(pos)
      if (d > maxD) continue
      const n = e.username || e.name || e.displayName || e.type || '?'
      out.push(String(n) + '@' + d.toFixed(1))
    }
  } catch {}
  out.sort()
  return out
}

function chatHoldsHunt(state) {
  return !!(state && (state.chatMode === 'come' || state.chatMode === 'stay'))
}

function isFoodName(n) {
  if (!n) return false
  const s = bareName(n)
  if (FOOD_ITEMS.has(s)) return true
  if (s.startsWith('cooked_')) return true
  return false
}

function countFood(bot) {
  let n = 0
  eachInventoryItem(bot, (it) => {
    if (isFoodName(resolveItemName(bot, it))) n += Number(it.count) || 0
  })
  return n
}

function foodInvSummary(bot) {
  const bag = {}
  eachInventoryItem(bot, (it) => {
    const n = resolveItemName(bot, it)
    if (!isFoodName(n)) return
    bag[n] = (bag[n] || 0) + (Number(it.count) || 0)
  })
  const parts = Object.keys(bag).sort().map((k) => k + '=' + bag[k])
  return parts.length ? parts.join(',') : 'none'
}

function droppedItemName(bot, e) {
  if (!e) return ''
  try {
    if (typeof e.getDroppedItem === 'function') {
      const it = e.getDroppedItem()
      if (it) return resolveItemName(bot, it) || bareName(it.name)
    }
  } catch {}
  try {
    const md = e.metadata
    const vals = Array.isArray(md) ? md : (md && typeof md === 'object' ? Object.values(md) : [])
    for (const v of vals) {
      if (!v || typeof v !== 'object') continue
      if (v.name) return bareName(v.name)
      const id = v.itemId != null ? v.itemId : v.id
      if (id != null && bot.registry && bot.registry.items && bot.registry.items[id]) {
        return bareName(bot.registry.items[id].name)
      }
    }
  } catch {}
  return ''
}

function nearestFoodDrop(bot, maxD = FOOD_SCAN_R) {
  const pos = bot.entity && bot.entity.position
  if (!pos) return null
  let best = null
  let bestD = maxD
  try {
    for (const e of Object.values(bot.entities || {})) {
      if (!isItemEntity(e)) continue
      const n = droppedItemName(bot, e)
      if (n && !isFoodName(n)) continue
      if (Math.hypot(e.position.x, e.position.z) < SPAWN_SAFE_R) continue
      const d = e.position.distanceTo(pos)
      if (d < bestD) { best = e; bestD = d }
    }
  } catch {}
  return best
}

function berryHasFruit(b) {
  if (!b || !b.name) return false
  if (bareName(b.name) !== 'sweet_berry_bush') return false
  try {
    const props = typeof b.getProperties === 'function' ? b.getProperties() : null
    if (props && props.age != null) return Number(props.age) >= 2
  } catch {}
  return true
}

function nearestFoodMob(bot, maxD = FOOD_SCAN_R) {
  const pos = bot.entity && bot.entity.position
  if (!pos) return null
  let best = null
  let bestD = maxD
  try {
    for (const e of Object.values(bot.entities || {})) {
      if (!e || !e.position) continue
      const n = String(e.name || e.displayName || '').toLowerCase()
      if (!FOOD_MOBS.has(n)) continue
      if (Math.hypot(e.position.x, e.position.z) < SPAWN_SAFE_R) continue
      const d = e.position.distanceTo(pos)
      if (d < bestD) { best = e; bestD = d }
    }
  } catch {}
  return best
}

function sayAllowed(bot, state, text) {
  const s = String(text || '')
  try {
    state.chatAllowSay = true
    bot.chat(s)
    state.chatAllowSay = false
    plog('chat said ' + s)
  } catch {
    state.chatAllowSay = false
  }
}

function haroxInsideSpawn(bot) {
  const h = findPlayer(bot)
  if (!h || !h.position) return false
  return Math.hypot(h.position.x, h.position.z) < SPAWN_SAFE_R
}

async function tryEat(bot) {
  try {
    if (bot.food != null && bot.food >= 18) return false
    if (countFood(bot) < 1) return false
    if (bot.autoEat && typeof bot.autoEat.eat === 'function' && !bot.autoEat.isEating) {
      const before = Number(bot.food)
      await bot.autoEat.eat()
      const after = Number(bot.food)
      plog('ate food=' + after + ' was=' + before)
      return Number.isFinite(before) && Number.isFinite(after) && after > before
    }
  } catch (err) {
    const msg = err && err.message
    if (msg && !/no food|cannot eat|not hungry/i.test(msg)) plog('eat fail ' + msg)
  }
  return false
}

function markFoodPass(bot, state, why) {
  state.foodPassed = true
  state.phase = 'hold'
  const v = vitals(bot)
  const dirt = countNamed(bot, ['dirt', 'grass_block'])
  state.note = 'P4 FOOD PASS ' + why + ' foodInv=' + foodInvSummary(bot) + ' bar=' + v.food + ' dirt=' + dirt
  plog(state.note + ' items=' + inventorySummary(bot) + ' pos=' + (posOf(bot) && posOf(bot).str))
  if (!state.saidGotFood) {
    state.saidGotFood = true
    sayAllowed(bot, state, 'got food')
  }
  writeStatus(bot, state)
  return true
}

function foodPassReady(bot, state, ateUp) {
  if (state.foodPassed) return true
  if (countFood(bot) > 0) return markFoodPass(bot, state, 'inv')
  if (ateUp) return markFoodPass(bot, state, 'ate')
  return false
}

async function pickupNearbyFood(bot) {
  const drop = nearestFoodDrop(bot, foodScanRadius(bot))
  if (!drop) return countFood(bot) > 0
  if (Math.hypot(drop.position.x, drop.position.z) < SPAWN_SAFE_R) return false
  const n = droppedItemName(bot, drop) || 'item'
  plog('food collect() item ' + n + ' d=' + bot.entity.position.distanceTo(drop.position).toFixed(1))
  await collectViaPlugin(bot, drop, 'food-item', 10000)
  return countFood(bot) > 0
}

async function harvestBerries(bot, block) {
  if (!block || !block.position) return false
  if (Math.hypot(block.position.x, block.position.z) < SPAWN_SAFE_R) return false
  plog('food collect() berry ' + block.position.x + ' ' + block.position.y + ' ' + block.position.z)
  await collectViaPlugin(bot, block, 'food-berry', 12000)
  if (countFood(bot) > 0) return true
  return pickupNearbyFood(bot)
}

async function killFoodMob(bot, mob, state) {
  if (!mob || !mob.position) return false
  const id = mob.id
  const name = String(mob.name || mob.displayName || 'mob')
  const d0 = bot.entity.position.distanceTo(mob.position)
  plog('food hunt mob ' + name + ' d=' + d0.toFixed(1) + ' -> path+attack then collect()')
  stopPath(bot)
  const deadline = Date.now() + 16000
  while (Date.now() < deadline && !state.dead) {
    if (chatHoldsHunt(state)) {
      plog('food hunt interrupted by chat ' + state.chatMode)
      stopPath(bot)
      return false
    }
    if (inHole(bot)) {
      await escapeHole(bot, state)
      if (inHole(bot)) return false
    }
    try { bot.setControlState('jump', false) } catch {}
    const creep = nearestHostile(bot, 8)
    if (creep) { await fleeHostile(bot, creep); return false }
    const e = (bot.entities && bot.entities[id]) || null
    if (!e || !e.position) break
    if (Math.hypot(e.position.x, e.position.z) < SPAWN_SAFE_R) {
      plog('food abort mob in spawn')
      break
    }
    if (horizFromOrigin(bot) < SPAWN_SAFE_R && !haroxInsideSpawn(bot)) {
      await leaveSpawnIfNeeded(bot, state)
      return false
    }
    const d = bot.entity.position.distanceTo(e.position)
    if (d > 2.8) {
      await safeGoto(bot, e.position.x, e.position.y, e.position.z, 2, 2500)
    }
    try { await bot.lookAt(e.position.offset(0, 0.8, 0), true) } catch {}
    try { bot.attack(e) } catch {}
    await sleep(400)
  }
  await sleep(400)
  const drop = nearestFoodDrop(bot, 14)
  if (drop) {
    plog('food collect() drop after ' + name)
    await collectViaPlugin(bot, drop, 'food-drop', 10000)
  } else {
    await pickupNearbyFood(bot)
  }
  return countFood(bot) > 0
}

async function exploreFoodAway(bot, state) {
  const p = bot.entity && bot.entity.position
  if (!p) return false
  const last = state.lastFoodPos
  if (last && Math.hypot(p.x - last.x, p.z - last.z) < 1.5) {
    state.foodExploreDir = (state.foodExploreDir || 0) + 1
    plog('food refuse 1x1 wander, new heading')
  }
  state.lastFoodPos = { x: p.x, y: p.y, z: p.z }
  state.lastFoodExploreAt = Date.now()
  const idx = (state.foodExploreDir || 0) % 8
  state.foodExploreDir = idx + 1
  const ang = (idx / 8) * Math.PI * 2
  const dist = 20 + ((idx * 3) % 11)
  let tx = p.x + Math.cos(ang) * dist
  let tz = p.z + Math.sin(ang) * dist
  if (!haroxInsideSpawn(bot) && Math.hypot(tx, tz) < SPAWN_SAFE_R) {
    const rr = Math.hypot(tx, tz) || 1
    tx = (tx / rr) * SPAWN_LEAVE_R
    tz = (tz / rr) * SPAWN_LEAVE_R
  }
  plog('food explore ' + dist + 'm heading=' + idx + ' -> ' + tx.toFixed(1) + ' ' + tz.toFixed(1) + ' destR=' + Math.hypot(tx, tz).toFixed(1))
  stopPath(bot)
  applyNoJumpMovements(bot)
  await pathfindNoJumpToward(bot, { x: tx, y: p.y, z: tz }, 10000)
  return true
}

async function foodHunt(bot, state) {
  if (chatHoldsHunt(state)) return
  if (inHole(bot)) {
    await escapeHole(bot, state)
    return
  }
  state.phase = 'food'
  const ateUp = await tryEat(bot)
  if (foodPassReady(bot, state, ateUp)) return
  if (!state.saidHungry) {
    state.saidHungry = true
    sayAllowed(bot, state, 'hungry')
  }
  const r = horizFromOrigin(bot)
  const dirt = countNamed(bot, ['dirt', 'grass_block'])
  const v = vitals(bot)
  const harox = findPlayer(bot)
  state.note = 'food hunt r=' + r.toFixed(1) + ' dirt=' + dirt + ' foodInv=' + foodInvSummary(bot) + ' bar=' + v.food + (harox ? ' har0x' : '')
  writeStatus(bot, state)

  try { bot.setControlState('jump', false) } catch {}
  const creep = nearestHostile(bot, 8)
  if (creep) { await fleeHostile(bot, creep); return }
  if (r < SPAWN_SAFE_R && !haroxInsideSpawn(bot)) {
    await leaveSpawnIfNeeded(bot, state)
    return
  }

  const scanR = foodScanRadius(bot)
  const drop = nearestFoodDrop(bot, scanR)
  const bush = findClosestBlock(bot, berryHasFruit, scanR)
  const mob = nearestFoodMob(bot, scanR)
  const dropD = drop ? bot.entity.position.distanceTo(drop.position).toFixed(1) : '-'
  const bushD = bush ? bot.entity.position.distanceTo(bush.position.offset(0.5, 0, 0.5)).toFixed(1) : '-'
  const mobD = mob ? bot.entity.position.distanceTo(mob.position).toFixed(1) : '-'
  const mobN = mob ? String(mob.name || mob.displayName || 'mob') : 'none'
  plog('food scan r=' + scanR + ' drop=' + (drop ? (droppedItemName(bot, drop) || 'item') + '@' + dropD : 'none') +
    ' berry=' + (bush ? bushD : 'none') + ' mob=' + mobN + '@' + mobD +
    ' pos=' + (posOf(bot) && posOf(bot).str) + ' items=' + inventorySummary(bot))
  if (!drop && !bush && !mob) {
    const seen = nearbyEntityNames(bot, scanR)
    plog('food scan empty r=' + scanR + ' entities=' + (seen.length ? seen.slice(0, 24).join(',') : 'none'))
  }

  if (drop) {
    stopPath(bot)
    const got = await pickupNearbyFood(bot)
    if (foodPassReady(bot, state, false) || got) return
  }
  if (bush && Math.hypot(bush.position.x, bush.position.z) >= SPAWN_SAFE_R) {
    stopPath(bot)
    const got = await harvestBerries(bot, bush)
    if (foodPassReady(bot, state, false) || got) return
  }
  if (mob) {
    stopPath(bot)
    const got = await killFoodMob(bot, mob, state)
    if (foodPassReady(bot, state, false) || got) return
  }

  if (chatHoldsHunt(state)) return

  // no auto-follow Har0x; come/follow only via chat

  const near = nearestFoodMob(bot, FOOD_NEAR_R) || nearestFoodDrop(bot, FOOD_NEAR_R) || findClosestBlock(bot, berryHasFruit, FOOD_NEAR_R)
  if (!near) {
    await exploreFoodAway(bot, state)
    return
  }
  await sleep(400)
}


const SIMPLE_INV = new Set(['sand', 'red_sand', 'dirt', 'grass_block', 'gravel', 'sandstone'])

function countSimpleInv(bot) {
  return countNamed(bot, SIMPLE_INV)
}

function countSandDirt(bot) {
  return countSand(bot) + countNamed(bot, ['dirt', 'grass_block'])
}

function isUnsafeFloor(b) {
  if (!b || !b.name) return true
  const n = bareName(b.name)
  if (n === 'air' || n === 'cave_air' || n === 'void_air') return true
  if (n === 'water' || n === 'lava' || n === 'flowing_water' || n === 'flowing_lava') return true
  if (n.includes('planks') || n.includes('leaves')) return true
  if (isPlayerBuilt(b)) return true
  return false
}

function isSolidStandFloor(b) {
  if (isUnsafeFloor(b)) return false
  return !!(b && b.boundingBox === 'block')
}

function isSimpleDigName(n) {
  return n === 'sand' || n === 'red_sand' || n === 'dirt' || n === 'grass_block'
}

function refuseSimpleDig(block) {
  if (!block || !block.name) return 'no-block'
  if (isPlayerBuilt(block)) return 'player-built'
  const n = bareName(block.name)
  if (n.includes('planks') || n.endsWith('_log') || n.endsWith('_wood') || n.endsWith('_stem')) return 'build'
  if (n.includes('door') || n.includes('chest')) return 'build'
  if (!isSimpleDigName(n)) return 'not-sand-dirt'
  return null
}

function isReachableNoJump(bot, block) {
  const p = bot.entity && bot.entity.position
  if (!p || !block) return false
  const dy = block.position.y - Math.floor(p.y)
  if (dy > 1 || dy < -2) return false
  return true
}

function applyNoJumpMovements(bot) {
  try {
    const Movements = pathfinderPkg.Movements
    if (!Movements || !bot.pathfinder) return
    const mv = new Movements(bot)
    mv.canDig = false
    mv.allow1by1towers = false
    mv.allowParkour = false
    mv.allowSprinting = false
    mv.maxDropDown = 1
    mv.scafoldingBlocks = []
    bot.pathfinder.setMovements(mv)
    plog('simple movements: no parkour no jump maxDropDown=1')
  } catch (err) {
    plog('simple movements fail ' + (err && err.message))
  }
}

function applyCollectMovements(bot) {
  try {
    const Movements = pathfinderPkg.Movements
    if (!Movements || !bot.pathfinder) return
    const mv = new Movements(bot)
    mv.canDig = true
    mv.allow1by1towers = false
    mv.allowParkour = false
    mv.allowSprinting = false
    mv.maxDropDown = 1
    mv.scafoldingBlocks = []
    try {
      const names = bot.registry && bot.registry.blocksByName
      if (names) {
        for (const key of Object.keys(names)) {
          const rec = names[key]
          if (!rec || rec.id == null) continue
          const fake = { name: key }
          if (isPlayerBuilt(fake) || String(key).includes('planks') || String(key).includes('oak')) {
            mv.blocksCantBreak.add(rec.id)
          }
        }
      }
    } catch {}
    if (bot.collectBlock) {
      bot.collectBlock.movements = mv
      bot.collectBlock.chestLocations = []
      bot.collectBlock.itemFilter = () => false
    }
    bot.pathfinder.setMovements(mv)
  } catch (err) {
    plog('collect movements fail ' + (err && err.message))
  }
}

async function collectViaPlugin(bot, target, label, ms = 15000) {
  if (!target) return false
  if (!bot.collectBlock || typeof bot.collectBlock.collect !== 'function') {
    plog('collect() missing plugin')
    return false
  }
  const pos = target.position
  if (pos && Math.hypot(pos.x, pos.z) < SPAWN_SAFE_R) {
    plog('collect() skip spawn r<' + SPAWN_SAFE_R + ' ' + label)
    return false
  }
  if (target.name && (isPlayerBuilt(target) || String(target.name).includes('planks'))) {
    plog('collect() skip player-built ' + target.name)
    return false
  }
  applyCollectMovements(bot)
  const kind = target.name || (target.displayName && String(target.displayName)) || 'target'
  plog('collect() ' + label + ' ' + kind + (pos ? (' at ' + pos.x + ' ' + pos.y + ' ' + pos.z) : ''))
  try {
    const p = bot.collectBlock.collect(target)
    const t = sleep(ms).then(() => {
      try { if (bot.collectBlock && typeof bot.collectBlock.cancelTask === 'function') bot.collectBlock.cancelTask() } catch {}
      try { if (bot.pathfinder) bot.pathfinder.setGoal(null) } catch {}
      throw new Error('collect-timeout')
    })
    await Promise.race([p, t])
    plog('collect() done ' + label + ' inv=' + inventorySummary(bot))
    return true
  } catch (err) {
    const msg = err && err.message
    if (msg === 'collect-timeout') plog('collect() timeout ' + label)
    else if (msg) plog('collect() fail ' + label + ' ' + msg)
    try { if (bot.pathfinder) bot.pathfinder.setGoal(null) } catch {}
    return false
  } finally {
    applyNoJumpMovements(bot)
    try { bot.setControlState('jump', false) } catch {}
  }
}

async function walkNoJump(bot, x, z, ms = 800) {
  const pos = bot.entity && bot.entity.position
  if (!pos) return false
  try { bot.setControlState('jump', false) } catch {}
  const dx = x - pos.x
  const dz = z - pos.z
  const len = Math.hypot(dx, dz) || 1
  const nx = pos.x + (dx / len) * 1.4
  const nz = pos.z + (dz / len) * 1.4
  if (cliffAhead(bot, nx, nz, 2)) {
    plog('simple refuse walk, cliff ahead')
    return false
  }
  try { await bot.lookAt(new Vec3(x, pos.y + 1.2, z), true) } catch {}
  try {
    bot.setControlState('jump', false)
    bot.setControlState('forward', true)
  } catch {}
  await sleep(ms)
  await clearMove(bot)
  try { bot.setControlState('jump', false) } catch {}
  return true
}

const SPAWN_SAFE_R = 24
const SPAWN_LEAVE_R = 28
const GATHER_TARGET = 8

async function maybeSoftWalkHarox(bot) {
  const harox = findPlayer(bot)
  if (!harox || !bot.entity) return false
  const d = bot.entity.position.distanceTo(harox.position)
  if (d <= 28) return false
  const pos = bot.entity.position
  const dx = harox.position.x - pos.x
  const dz = harox.position.z - pos.z
  const len = Math.hypot(dx, dz) || 1
  const stepX = pos.x + (dx / len) * 2.5
  const stepZ = pos.z + (dz / len) * 2.5
  if (Math.hypot(stepX, stepZ) < SPAWN_SAFE_R) {
    plog('skip Har0x walk, would enter spawn')
    return false
  }
  plog('soft-walk Har0x d=' + d.toFixed(1) + ' keep r>=24')
  await walkNoJump(bot, harox.position.x, harox.position.z, 500)
  return true
}

async function wanderSolidNear(bot, ms = 600) {
  const p = bot.entity && bot.entity.position
  if (!p) return false
  const tries = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [2, -2], [-2, 2], [-2, -2], [3, 0], [0, 3]]
  for (let i = tries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = tries[i]; tries[i] = tries[j]; tries[j] = tmp
  }
  for (const [dx, dz] of tries) {
    const tx = p.x + dx
    const tz = p.z + dz
    if (Math.hypot(tx, tz) < SPAWN_SAFE_R) continue
    if (cliffAhead(bot, tx, tz, 2)) continue
    const stand = probeStandAt(bot, Math.floor(tx), Math.floor(tz), Math.floor(p.y))
    if (!stand) continue
    plog('wander solid ' + stand.x.toFixed(1) + ' ' + stand.z.toFixed(1) + ' r=' + Math.hypot(stand.x, stand.z).toFixed(1))
    await walkNoJump(bot, stand.x, stand.z, ms)
    return true
  }
  return false
}

function probeStandAt(bot, x, z, y0) {
  for (let dy = 4; dy >= -8; dy--) {
    const y = y0 + dy
    let floor = null
    let body = null
    let head = null
    try {
      floor = bot.blockAt(new Vec3(x, y - 1, z))
      body = bot.blockAt(new Vec3(x, y, z))
      head = bot.blockAt(new Vec3(x, y + 1, z))
    } catch {}
    if (!isSolidStandFloor(floor)) continue
    if (body && body.boundingBox === 'block') continue
    if (head && head.boundingBox === 'block') continue
    return { x: x + 0.5, y, z: z + 0.5, floor: floor.name }
  }
  return null
}

function horizFromOrigin(bot) {
  const p = bot.entity && bot.entity.position
  if (!p) return 0
  return Math.hypot(p.x, p.z)
}

async function preferSandUnderfoot(bot) {
  const under = feetBlock(bot, -1)
  if (isSandBlock(under)) return true
  const p = bot.entity && bot.entity.position
  if (!p) return false
  const ox = Math.floor(p.x)
  const oy = Math.floor(p.y)
  const oz = Math.floor(p.z)
  const tries = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  for (const [dx, dz] of tries) {
    let floor = null
    let body = null
    let head = null
    try {
      floor = bot.blockAt(new Vec3(ox + dx, oy - 1, oz + dz))
      body = bot.blockAt(new Vec3(ox + dx, oy, oz + dz))
      head = bot.blockAt(new Vec3(ox + dx, oy + 1, oz + dz))
    } catch {}
    if (!isSandBlock(floor)) continue
    if (body && body.boundingBox === 'block') continue
    if (head && head.boundingBox === 'block') continue
    plog('prefer sand underfoot at ' + (ox + dx) + ' ' + (oy - 1) + ' ' + (oz + dz))
    await walkNoJump(bot, ox + dx + 0.5, oz + dz + 0.5, 700)
    if (isSandBlock(feetBlock(bot, -1))) return true
  }
  return isSandBlock(feetBlock(bot, -1))
}

function findLeaveSpawnDest(bot) {
  const p = bot.entity && bot.entity.position
  if (!p) return null
  const y0 = Math.floor(p.y)
  const axes = [
    [32, 0],
    [0, 32],
    [24, 24]
  ]
  let best = null
  let bestScore = 1e9
  for (const [cx, cz] of axes) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const x = cx + dx
        const z = cz + dz
        if (Math.hypot(x + 0.5, z + 0.5) < SPAWN_SAFE_R) continue
        const hit = probeStandAt(bot, x, z, y0)
        if (!hit) continue
        const sandBonus = isSandBlock({ name: hit.floor }) ? -20 : (isDirtBlock({ name: hit.floor }) ? -6 : 0)
        const dMe = Math.hypot(hit.x - p.x, hit.z - p.z)
        const score = dMe + Math.abs(hit.y - y0) * 2 + sandBonus
        if (score < bestScore) {
          best = Object.assign({ label: cx + ',' + hit.y + ',' + cz }, hit)
          bestScore = score
        }
      }
    }
  }
  if (best) return best
  return { x: 32.5, y: y0, z: 0.5, floor: 'unknown', label: '32,' + y0 + ',0' }
}

async function pathfindNoJumpToward(bot, dest, ms = 10000) {
  applyNoJumpMovements(bot)
  try { bot.setControlState('jump', false) } catch {}
  if (!bot.pathfinder || !goals) return false
  const x = dest.x
  const y = dest.y
  const z = dest.z
  try {
    let g = null
    if (goals.GoalXZ) {
      g = new goals.GoalXZ(Math.floor(x), Math.floor(z))
    } else if (y != null && Number.isFinite(y)) {
      g = new goals.GoalNear(x, y, z, 3)
    } else {
      g = new goals.GoalNear(x, bot.entity.position.y, z, 3)
    }
    const p = bot.pathfinder.goto(g)
    const t = sleep(ms).then(() => { try { bot.pathfinder.setGoal(null) } catch {}; throw new Error('goto-timeout') })
    await Promise.race([p, t])
  } catch (err) {
    const msg = err && err.message
    if (msg && msg !== 'goto-timeout' && msg !== 'No path to the goal!' && msg !== 'The goal was changed before it could be completed!') {
      plog('leave-spawn goto fail ' + msg)
    }
    try { bot.pathfinder.setGoal(null) } catch {}
  }
  const now = bot.entity && bot.entity.position
  if (!now) return false
  if (Math.hypot(now.x, now.z) >= SPAWN_SAFE_R) return true
  return Math.hypot(now.x - x, now.z - z) < 3.5
}

async function leaveSpawnIfNeeded(bot, state) {
  let r = horizFromOrigin(bot)
  if (r >= SPAWN_LEAVE_R) {
    plog('left spawn r=' + r.toFixed(1) + ' inv=' + inventorySummary(bot) + ' pos=' + (posOf(bot) && posOf(bot).str))
    return true
  }
  applyNoJumpMovements(bot)
  const p = bot.entity && bot.entity.position
  const y0 = p ? Math.floor(p.y) : 64
  const found = findLeaveSpawnDest(bot)
  const dests = []
  if (found) dests.push(found)
  dests.push({ x: 32.5, y: y0, z: 0.5, label: '32,' + y0 + ',0' })
  dests.push({ x: 0.5, y: y0, z: 32.5, label: '0,' + y0 + ',32' })
  dests.push({ x: 24.5, y: y0, z: 24.5, label: '24,' + y0 + ',24' })
  const first = dests[0]
  const tlabel = first.label || (Math.round(first.x) + ',' + first.y + ',' + Math.round(first.z))
  plog('leaving spawn r=' + r.toFixed(1) + ' -> ' + tlabel)
  writeStatus(bot, Object.assign({}, state, { note: 'leaving spawn r=' + r.toFixed(1) + ' -> ' + tlabel, phase: 'leave-spawn' }))

  const deadline = Date.now() + 40000
  let di = 0
  while (Date.now() < deadline && !state.dead) {
    try { bot.setControlState('jump', false) } catch {}
    const creep = nearestHostile(bot, 6)
    if (creep) { await fleeHostile(bot, creep) }
    r = horizFromOrigin(bot)
    if (r >= SPAWN_SAFE_R) {
      plog('left spawn r=' + r.toFixed(1) + ' inv=' + inventorySummary(bot) + ' pos=' + (posOf(bot) && posOf(bot).str))
      await preferSandUnderfoot(bot)
      return true
    }
    const dest = dests[di % dests.length]
    const label = dest.label || (Math.round(dest.x) + ',' + dest.y + ',' + Math.round(dest.z))
    plog('leaving spawn r=' + r.toFixed(1) + ' -> ' + label)
    const ok = await pathfindNoJumpToward(bot, dest, 9000)
    r = horizFromOrigin(bot)
    if (r >= SPAWN_SAFE_R) {
      plog('left spawn r=' + r.toFixed(1) + ' inv=' + inventorySummary(bot) + ' pos=' + (posOf(bot) && posOf(bot).str))
      await preferSandUnderfoot(bot)
      return true
    }
    if (!ok) {
      di++
      plog('leave-spawn path fail, try dest ' + (di % dests.length))
      await sleep(300)
    } else {
      await sleep(120)
    }
  }
  r = horizFromOrigin(bot)
  if (r >= SPAWN_SAFE_R) {
    plog('left spawn r=' + r.toFixed(1) + ' inv=' + inventorySummary(bot) + ' pos=' + (posOf(bot) && posOf(bot).str))
    await preferSandUnderfoot(bot)
    return true
  }
  plog('leave-spawn timeout r=' + r.toFixed(1) + ' pos=' + (posOf(bot) && posOf(bot).str))
  return false
}

function pickSimpleLocal(bot, pred) {
  const p = bot.entity && bot.entity.position
  if (!p) return null
  const ox = Math.floor(p.x)
  const oy = Math.floor(p.y)
  const oz = Math.floor(p.z)
  const offsets = [
    [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1],
    [1, -1, 1], [-1, -1, -1], [1, -1, -1], [-1, -1, 1],
    [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [0, -1, 0]
  ]
  for (const [dx, dy, dz] of offsets) {
    let b = null
    try { b = bot.blockAt(new Vec3(ox + dx, oy + dy, oz + dz)) } catch {}
    if (!b || refuseSimpleDig(b)) continue
    if (Math.hypot(ox + dx, oz + dz) < SPAWN_SAFE_R) continue
    if (pred && !pred(b)) continue
    if (dx === 0 && dy === -1 && dz === 0) {
      const under2 = feetBlock(bot, -2)
      if (!isSolidStandFloor(under2)) {
        plog('simple skip under-feet, under2=' + (under2 && under2.name))
        continue
      }
    }
    return b
  }
  return null
}

function pickSimpleTarget(bot) {
  const sand = pickSimpleLocal(bot, isSandBlock)
  if (sand) return sand
  const dirt = pickSimpleLocal(bot, isDirtBlock)
  if (dirt) return dirt
  const outside = (b) => b && b.position && Math.hypot(b.position.x, b.position.z) >= SPAWN_SAFE_R
  const farSand = findClosestBlock(bot, (b) => isSandBlock(b) && isReachableNoJump(bot, b) && outside(b), 12)
  if (farSand) return farSand
  return findClosestBlock(bot, (b) => isDirtBlock(b) && isReachableNoJump(bot, b) && outside(b), 12)
}

function findSolidStandNear(bot, block) {
  const here = bot.entity && bot.entity.position
  if (!here || !block || !block.position) return null
  const bx = Math.floor(block.position.x)
  const by = Math.floor(block.position.y)
  const bz = Math.floor(block.position.z)
  let best = null
  let bestScore = 1e9
  const spots = [[0, 1, 0]]
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
    spots.push([dx, 1, dz], [dx, 0, dz])
  }
  for (const [dx, dy, dz] of spots) {
    const x = bx + dx
    const y = by + dy
    const z = bz + dz
    let floor = null
    let body = null
    let head = null
    try {
      floor = bot.blockAt(new Vec3(x, y - 1, z))
      body = bot.blockAt(new Vec3(x, y, z))
      head = bot.blockAt(new Vec3(x, y + 1, z))
    } catch {}
    if (!isSolidStandFloor(floor)) continue
    if (body && body.boundingBox === 'block') continue
    if (head && head.boundingBox === 'block') continue
    const dest = new Vec3(x + 0.5, y, z + 0.5)
    const dBlock = dest.distanceTo(block.position.offset(0.5, 0.5, 0.5))
    if (dBlock > 3.2) continue
    const dMe = dest.distanceTo(here)
    const score = dMe + dBlock * 0.1
    if (score < bestScore) {
      best = dest
      bestScore = score
    }
  }
  return best
}

async function simpleWaitPickup(bot, dropPos, before, ms = 8000) {
  const item = nearestItemEntity(bot, 6)
  if (item && item.position && Math.hypot(item.position.x, item.position.z) >= SPAWN_SAFE_R) {
    await collectViaPlugin(bot, item, 'simple-item', ms)
  }
  return countSandDirt(bot) > before
}

async function simpleGetOne(bot, state) {
  if (chatBusy(state)) return
  const have0 = countSandDirt(bot)
  state.phase = have0 >= GATHER_TARGET ? 'hold' : 'gather'
  const creep = nearestHostile(bot, 8)
  if (creep) { await fleeHostile(bot, creep); return }
  try { if (bot.pathfinder) bot.pathfinder.setGoal(null) } catch {}
  try { bot.setControlState('jump', false) } catch {}
  await clearMove(bot)

  const left = await leaveSpawnIfNeeded(bot, state)
  const rNow = horizFromOrigin(bot)
  if (!left || rNow < SPAWN_SAFE_R) {
    plog('no dig inside spawn r=' + rNow.toFixed(1) + ' inv=' + inventorySummary(bot))
    writeStatus(bot, Object.assign({}, state, { note: 'inside spawn r=' + rNow.toFixed(1) + ' no dig', phase: 'leave-spawn' }))
    await sleep(400)
    return
  }

  await maybeSoftWalkHarox(bot)
  await preferSandUnderfoot(bot)

  const sand0 = countSand(bot)
  const dirt0 = countNamed(bot, ['dirt', 'grass_block'])
  const before = countSandDirt(bot)
  logFeet(bot)
  plog('gather start sand=' + sand0 + ' dirt=' + dirt0 + ' have=' + before + '/' + GATHER_TARGET + ' r=' + rNow.toFixed(1) + ' pos=' + (posOf(bot) && posOf(bot).str))
  writeStatus(bot, Object.assign({}, state, { note: 'gather sand=' + sand0 + ' dirt=' + dirt0 + ' have=' + before + '/' + GATHER_TARGET + ' r=' + rNow.toFixed(1), phase: 'gather' }))

  const existing = nearestItemEntity(bot, 8)
  if (existing && existing.position && Math.hypot(existing.position.x, existing.position.z) >= SPAWN_SAFE_R) {
    plog('gather existing drop via collect() d=' + bot.entity.position.distanceTo(existing.position).toFixed(1))
    const ok = await simpleWaitPickup(bot, existing.position, before, 8000)
    if (ok) {
      const sand = countSand(bot)
      const dirt = countNamed(bot, ['dirt', 'grass_block'])
      const have = sand + dirt
      plog('PICKUP sand=' + sand + ' dirt=' + dirt + ' have=' + have + '/' + GATHER_TARGET + ' items=' + inventorySummary(bot))
      writeStatus(bot, Object.assign({}, state, {
        note: 'PICKUP sand=' + sand + ' dirt=' + dirt + ' have=' + have + '/' + GATHER_TARGET + ' r=' + horizFromOrigin(bot).toFixed(1),
        phase: have >= GATHER_TARGET ? 'hold' : 'gather'
      }))
      return
    }
  }

  const under = feetBlock(bot, -1)
  if (!isSolidStandFloor(under)) {
    plog('gather not on solid floor under=' + (under && under.name) + ', seeking stand')
    const stand = findSolidStandNear(bot, under || { position: bot.entity.position.floored() })
    if (stand && Math.hypot(stand.x, stand.z) >= SPAWN_SAFE_R) await walkNoJump(bot, stand.x, stand.z, 700)
    if (!isSolidStandFloor(feetBlock(bot, -1))) {
      plog('gather still not on solid, idle')
      await sleep(400)
      return
    }
  }

  const block = pickSimpleTarget(bot)
  if (!block) {
    plog('gather no sand/dirt in reach (no-jump) have=' + before + '/' + GATHER_TARGET)
    writeStatus(bot, Object.assign({}, state, { note: 'gather no target have=' + before + '/' + GATHER_TARGET, phase: 'gather' }))
    await wanderSolidNear(bot, 700)
    await sleep(400)
    return
  }
  const why = refuseSimpleDig(block)
  if (why) {
    plog('gather refuse ' + block.name + ' ' + why)
    await sleep(400)
    return
  }
  if (block.position && Math.hypot(block.position.x, block.position.z) < SPAWN_SAFE_R) {
    plog('gather refuse inside spawn ' + block.name + ' at ' + block.position.x + ' ' + block.position.z)
    await leaveSpawnIfNeeded(bot, state)
    return
  }

  if (digBusy || bot.targetDigBlock) {
    plog('gather skip, collect busy')
    return
  }

  digBusy = true
  try {
    const invBefore = countSandDirt(bot)
    plog('gather collect() ' + block.name + ' at ' + block.position.x + ' ' + block.position.y + ' ' + block.position.z + ' have=' + invBefore + '/' + GATHER_TARGET)
    const ok = await collectViaPlugin(bot, block, 'gather-block', 15000)
    const sand = countSand(bot)
    const dirt = countNamed(bot, ['dirt', 'grass_block'])
    const have = sand + dirt
    if (ok || have > invBefore) {
      plog('PICKUP sand=' + sand + ' dirt=' + dirt + ' have=' + have + '/' + GATHER_TARGET + ' items=' + inventorySummary(bot))
      writeStatus(bot, Object.assign({}, state, {
        note: 'PICKUP sand=' + sand + ' dirt=' + dirt + ' have=' + have + '/' + GATHER_TARGET + ' r=' + horizFromOrigin(bot).toFixed(1),
        phase: have >= GATHER_TARGET ? 'hold' : 'gather'
      }))
    } else {
      plog('gather collect no inv change sand=' + sand + ' dirt=' + dirt + ' items=' + inventorySummary(bot))
      writeStatus(bot, Object.assign({}, state, { note: 'gather collect no inv change sand=' + sand + ' dirt=' + dirt, phase: 'gather' }))
    }
  } catch (err) {
    plog('gather collect fail ' + (err && err.message))
    try { if (bot.pathfinder) bot.pathfinder.setGoal(null) } catch {}
    await clearMove(bot)
  } finally {
    digBusy = false
    applyNoJumpMovements(bot)
    try { bot.setControlState('jump', false) } catch {}
  }
}

async function simpleHold(bot, state) {
  if (chatBusy(state)) return
  const sand = countSand(bot)
  const dirt = countNamed(bot, ['dirt', 'grass_block'])
  const r = horizFromOrigin(bot)
  state.phase = 'hold'
  state.note = 'HOLDING sand=' + sand + ' dirt=' + dirt + ' r=' + r.toFixed(1) + ' stay'
  writeStatus(bot, state)
  plog('HOLD sand=' + sand + ' dirt=' + dirt + ' items=' + inventorySummary(bot) + ' pos=' + (posOf(bot) && posOf(bot).str))
  try { if (bot.pathfinder) bot.pathfinder.setGoal(null) } catch {}
  try { bot.setControlState('jump', false) } catch {}
  const creep = nearestHostile(bot, 8)
  if (creep) { await fleeHostile(bot, creep); return }
  if (r < SPAWN_SAFE_R) {
    await leaveSpawnIfNeeded(bot, state)
    return
  }
  const walked = await maybeSoftWalkHarox(bot)
  if (walked) return
  if (Math.random() < 0.3) {
    await wanderSolidNear(bot, 500)
    return
  }
  await clearMove(bot)
  await sleep(800)
}

async function gather(bot, state) {
  state.phase = 'gather'
  writeStatus(bot, state)
  const deadline = Date.now() + 180000
  let ticks = 0
  logFeet(bot)
  if (!feetBlock(bot, -1)) {
    plog('waiting for chunks')
    await sleep(1500)
    logFeet(bot)
  }
  while (Date.now() < deadline && !state.dead) {
    const creep = nearestHostile(bot, 8)
    if (creep) { await fleeHostile(bot, creep); continue }
    await tryEat(bot)
    const sand = countSand(bot)
    const stone = countStone(bot)
    const dirt = countNamed(bot, ['dirt', 'grass_block'])
    const gravel = countNamed(bot, ['gravel'])
    const p = posOf(bot)
    const invn = countAllItems(bot)
    plog(`gather sand=${sand} sandstone=${stone} dirt=${dirt} gravel=${gravel} inv=${invn} items=${inventorySummary(bot)} pos=${p && p.str}`)
    writeStatus(bot, Object.assign({}, state, { note: 'gathering sand=' + sand + ' stone=' + stone + ' dirt=' + dirt }))
    if (sand >= 8 || stone >= 4 || dirt >= 16) break
    if (sand >= 64 || stone >= 20 || dirt >= 24) break

    if (ticks % 8 === 0) logFeet(bot)

    const harox = findPlayer(bot)
    if (harox && bot.entity && bot.entity.position.distanceTo(harox.position) > 28) {
      await walkTowardNoJump(bot, harox.position.x, harox.position.z, 800)
    }

    if (digBusy) {
      await sleep(200)
      ticks++
      continue
    }
    if (standingOnForbidden(bot)) {
      const stepped = await stepToAllowedFloor(bot)
      if (!stepped) {
        await sleep(800)
        ticks++
        continue
      }
    }
    const got = await digNearby(bot, state, isGatherBlock, GATHER_LEASH)
    if (!got) {
      plog('no allowed sand/dirt/sandstone/gravel nearby, idle')
      await sleep(400)
    }
    ticks++
    await sleep(150)
  }
  state.sandGathered = countSand(bot)
  plog('gather done sand=' + state.sandGathered + ' stone=' + countStone(bot) + ' dirt=' + countNamed(bot, ['dirt', 'grass_block']))
}

async function craftSandstone(bot, state) {
  if (state.dead) return
  state.phase = 'craft'
  writeStatus(bot, state)
  const sand = countSand(bot)
  const want = Math.floor(sand / 4)
  if (want < 1) {
    plog('craft skip, sand=' + sand)
    return
  }
  try {
    const id = bot.registry.itemsByName.sandstone && bot.registry.itemsByName.sandstone.id
    if (id == null) throw new Error('no sandstone id')
    const recs = bot.recipesFor(id, null, 1, null)
    const rec = recs && recs[0]
    if (!rec) throw new Error('no sandstone recipe')
    plog('crafting sandstone x' + want)
    await bot.craft(rec, want, null)
    await sleep(400)
    plog('crafted sandstone=' + countStone(bot))
  } catch (err) {
    plog('craft fail ' + (err && err.message) + ' — will use fallback blocks')
    try {
      const id = bot.registry.itemsByName.sandstone && bot.registry.itemsByName.sandstone.id
      const rec = bot.recipesFor(id, null, 1, null)[0]
      if (rec) {
        for (let i = 0; i < want; i++) {
          if (state.dead) break
          try { await bot.craft(rec, 1, null) } catch (e) { plog('craft1 fail ' + (e && e.message)); break }
        }
      }
    } catch {}
  }
  state.sandstone = countStone(bot)
}

function pickBuildItem(bot) {
  const stone = findItem(bot, STONE_ITEMS)
  if (stone) return stone
  return findItem(bot, FALLBACK_ITEMS)
}

async function equipBuild(bot, item) {
  if (!item) return false
  if (GRAVITY.has(item.name)) return false
  try {
    if (typeof bot.equip === 'function') {
      await bot.equip(item, 'hand')
      return true
    }
  } catch (err) {
    plog('equip fail ' + (err && err.message))
  }
  return true
}

async function placeAt(bot, x, y, z) {
  const dest = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z))
  let existing = null
  try { existing = bot.blockAt(dest) } catch {}
  if (existing && existing.name && existing.name !== 'air' && existing.name !== 'cave_air' && existing.name !== 'void_air') return 'exists'
  const faces = [
    [new Vec3(0, -1, 0), new Vec3(0, 1, 0)],
    [new Vec3(0, 1, 0), new Vec3(0, -1, 0)],
    [new Vec3(-1, 0, 0), new Vec3(1, 0, 0)],
    [new Vec3(1, 0, 0), new Vec3(-1, 0, 0)],
    [new Vec3(0, 0, -1), new Vec3(0, 0, 1)],
    [new Vec3(0, 0, 1), new Vec3(0, 0, -1)]
  ]
  for (const [off, face] of faces) {
    let ref = null
    try { ref = bot.blockAt(dest.plus(off)) } catch {}
    if (!ref || !ref.name || ref.name === 'air' || ref.name === 'cave_air' || ref.name === 'void_air') continue
    try {
      await bot.lookAt(ref.position.offset(0.5, 0.5, 0.5), true)
      await bot.placeBlock(ref, face)
      return 'placed'
    } catch (err) {
      plog('place try fail ' + dest + ' ' + (err && err.message))
    }
  }
  return 'fail'
}

function groundY(bot, x, z, guess) {
  const g = Math.floor(guess)
  for (let y = g + 4; y >= g - 10; y--) {
    let b = null
    let a = null
    try {
      b = bot.blockAt(new Vec3(x, y, z))
      a = bot.blockAt(new Vec3(x, y + 1, z))
    } catch {}
    if (b && b.boundingBox === 'block' && a && (a.name === 'air' || a.name === 'cave_air' || a.name === 'void_air')) return y + 1
  }
  return g
}

function houseTargets(ox, oy, oz) {
  const out = []
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        const wall = x === 0 || x === 4 || z === 0 || z === 4
        const door = x === 2 && z === 0 && y < 2
        if (wall && !door) out.push([ox + x, oy + y, oz + z])
      }
    }
  }
  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 5; z++) out.push([ox + x, oy + 3, oz + z])
  }
  return out
}

async function buildHouse(bot, state) {
  if (state.dead) return
  state.phase = 'build'
  writeStatus(bot, state)
  let item = pickBuildItem(bot)
  if (!item) {
    plog('no non-gravity build blocks; digging dirt fallback near Har0x')
    for (let i = 0; i < 16 && !state.dead; i++) {
      const got = await digNearby(bot, state, isDirtBlock, 14)
      if (countNamed(bot, ['dirt', 'grass_block']) >= 20) break
      if (!got) break
    }
    item = pickBuildItem(bot)
  }
  if (!item || GRAVITY.has(item.name)) {
    plog('REFUSE to place sand/gravity. no fallback blocks. skip house this pass.')
    state.note = 'no non-gravity blocks for house'
    return
  }
  state.buildMaterial = item.name
  const harox = findPlayer(bot)
  const here = bot.entity.position
  const base = harox ? harox.position.offset(5, 0, 3) : here.offset(3, 0, 3)
  const ox = Math.floor(base.x)
  const oz = Math.floor(base.z)
  const oy = groundY(bot, ox + 2, oz + 2, (harox ? harox.position.y : here.y))
  plog(`build ${item.name} house at ${ox} ${oy} ${oz}`)
  await safeGoto(bot, ox + 2, oy, oz + 2, 2, 8000)
  await equipBuild(bot, item)
  const targets = houseTargets(ox, oy, oz)
  let placed = state.houseBlocks || 0
  for (const [x, y, z] of targets) {
    if (state.dead) break
    const creep = nearestHostile(bot, 8)
    if (creep) { await fleeHostile(bot, creep); await safeGoto(bot, ox + 2, oy, oz + 2, 2, 4000) }
    item = pickBuildItem(bot)
    if (!item || GRAVITY.has(item.name)) {
      plog('out of non-gravity blocks after ' + placed)
      break
    }
    await equipBuild(bot, item)
    const pos = bot.entity.position
    if (pos.distanceTo(new Vec3(x + 0.5, y, z + 0.5)) > 4.2) {
      await safeGoto(bot, x, y, z, 3, 4000)
    }
    const res = await placeAt(bot, x, y, z)
    if (res === 'placed') placed++
    if (res === 'fail') {
      await safeGoto(bot, x, y, z, 2, 3000)
      const res2 = await placeAt(bot, x, y, z)
      if (res2 === 'placed') placed++
    }
    if (placed > 0 && placed % 8 === 0) plog('placed ' + placed + '/' + targets.length)
  }
  state.houseBlocks = placed
  state.housePlaced = placed >= 8
  plog('house placed=' + placed + ' material=' + state.buildMaterial)
}

async function followSurviveTick(bot, state) {
  if (state.dead) return
  await tryEat(bot)
  if (inHole(bot)) { await escapeHole(bot, state); return }
  const creep = nearestHostile(bot, 8)
  if (creep) {
    stopPath(bot)
    await fleeHostile(bot, creep)
    return
  }
  const harox = findPlayer(bot)
  if (harox) {
    const d = bot.entity.position.distanceTo(harox.position)
    if (d > FOLLOW_RANGE + 1) startFollow(bot, harox, FOLLOW_RANGE)
  } else {
    stopPath(bot)
    await clearMove(bot)
  }
}


const CHAT_LOG = path.join(__dirname, 'rl', 'chat.jsonl')
const CHAT_PENDING = path.join(__dirname, 'rl', 'chat-pending.jsonl')
const COMMAND_FILE = path.join(__dirname, 'rl', 'command.json')
const HEY_COOLDOWN_MS = 20000

function appendJsonl(file, obj) {
  try { fs.appendFileSync(file, JSON.stringify(obj) + '\n') } catch {}
}

function findPlayerNamed(bot, name) {
  if (!name) return findPlayer(bot)
  const want = String(name).toLowerCase()
  try {
    for (const [n, pl] of Object.entries(bot.players || {})) {
      if (String(n).toLowerCase() === want && pl && pl.entity && pl.entity.position) return pl.entity
    }
    for (const e of Object.values(bot.entities || {})) {
      const n = (e.username || e.name || '').toLowerCase()
      if (e.type === 'player' && n === want && e.position) return e
    }
  } catch {}
  return findPlayer(bot)
}

function parseLocalCmd(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[!?.]+$/g, '').trim()
  const core = t.replace(/^steve[,:\s]+/, '').replace(/\s+steve$/, '').trim()
  if (core === 'come' || core === 'here' || core === 'come here' || core === 'come to me') return 'come'
  if (core === 'follow' || core === 'follow me') return 'follow'
  if (core === 'stop' || core === 'stay' || core === 'stand still') return 'stay'
  if (/\bover here\b/.test(t) || /\bthis way\b/.test(t) || /\bcome look\b/.test(t) || /\bcome see\b/.test(t) || /\blook here\b/.test(t)) return 'come'
  if (/\b(hi|hey|hello)\b/.test(t)) return 'hi'
  return null
}

function chatBusy(state) {
  return !!(state && state.chatMode)
}

async function comeNow(bot, state, user, extra) {
  if (state.chatComing) return
  state.chatComing = true
  try {
    if (inHole(bot)) await escapeHole(bot, state)
    try { bot.setControlState('jump', false) } catch {}
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
    const targetR = Math.hypot(x, z)
    plog('come to ' + Number(x).toFixed(1) + ' ' + Number(y).toFixed(1) + ' ' + Number(z).toFixed(1) + ' r=' + targetR.toFixed(1) + ' no-jump from=' + (user || '?'))
    applyNoJumpMovements(bot)
    if (targetR >= SPAWN_SAFE_R) {
      await pathfindNoJumpToward(bot, { x, y, z }, 12000)
      if (horizFromOrigin(bot) < SPAWN_SAFE_R) await leaveSpawnIfNeeded(bot, state)
    } else {
      await pathfindNoJumpToward(bot, { x, y, z }, 12000)
    }
    plog('come done pos=' + (posOf(bot) && posOf(bot).str) + ' r=' + horizFromOrigin(bot).toFixed(1))
  } catch (err) {
    plog('come fail ' + (err && err.message))
  } finally {
    state.chatComing = false
  }
}

async function honorChat(bot, state) {
  const mode = state.chatMode
  if (inHole(bot) && (mode === 'follow' || mode === 'come' || mode === 'stay')) {
    await escapeHole(bot, state)
    if (inHole(bot)) return
  }
  if (mode === 'stay') {
    stopPath(bot)
    await clearMove(bot)
    try { bot.setControlState('jump', false) } catch {}
    state.phase = 'chat-stay'
    state.note = 'chat stay (dirt kept)'
    writeStatus(bot, state)
    await sleep(400)
    return
  }
  if (mode === 'follow') {
    const ent = findPlayerNamed(bot, state.chatUser)
    if (ent) startFollow(bot, ent, FOLLOW_RANGE)
    else stopPath(bot)
    state.phase = 'chat-follow'
    state.note = 'chat follow ' + (state.chatUser || '')
    writeStatus(bot, state)
    await sleep(400)
    return
  }
  if (mode === 'come') {
    state.phase = 'chat-come'
    state.note = 'chat come ' + (state.chatUser || '')
    writeStatus(bot, state)
    if (!state.chatComing) await comeNow(bot, state, state.chatUser, state.chatExtra || null)
    if (state.chatMode === 'come') state.chatMode = null
  }
}

export function startPlayLoop(bot) {
  const state = {
    phase: 'init',
    leftHole: false,
    housePlaced: false,
    houseBlocks: 0,
    sandGathered: 0,
    sandstone: 0,
    buildMaterial: 'none',
    note: '',
    dead: false,
    deaths: 0,
    waitingSpawn: false,
    episodeStart: Date.now(),
    griefPlanks: 0,
    foodPassed: false,
    saidHungry: false,
    saidGotFood: false,
    foodExploreDir: 0,
    lastFoodPos: null,
    lastFoodExploreAt: 0,
    saidLookingSand: false,
    sandExploreDir: 0,
    lastSandPos: null,
    chatMode: null,
    chatUser: '',
    chatExtra: null,
    chatComing: false,
    lastHeyAt: 0,
    saidComing: false
  }

  const chat = (msg) => {
    const s = String(msg || '')
    const allowed = s === 'house up' || s === 'coming' || s === 'hungry' || s === 'got food' || s === 'hey' || s === 'looking for sand'
    if (allowed || (s.length > 0 && s.length <= 40 && state.chatAllowSay)) {
      try { bot.chat(s) } catch {}
      plog('chat said ' + s)
      return
    }
    plog('chat-suppressed ' + s)
  }

  function maybeSayHey(reason) {
    const now = Date.now()
    if (now - (state.lastHeyAt || 0) < HEY_COOLDOWN_MS) {
      plog('chat hey rate-limited reason=' + reason)
      return false
    }
    state.lastHeyAt = now
    try { bot.chat('hey') } catch {}
    plog('chat said hey reason=' + reason)
    return true
  }

  function applyChatCmd(cmd, user, extra) {
    if (cmd === 'hi') {
      maybeSayHey('greet from ' + user)
      return
    }
    if (cmd === 'stay') {
      state.chatMode = 'stay'
      state.chatUser = user || ''
      state.chatExtra = null
      stopPath(bot)
      clearMove(bot)
      try { bot.setControlState('jump', false) } catch {}
      plog('chat cmd stay from ' + (user || '?'))
      writeStatus(bot, Object.assign({}, state, { phase: 'chat-stay', note: 'chat stay from ' + (user || '?') }))
      return
    }
    if (cmd === 'follow') {
      state.chatMode = 'follow'
      state.chatUser = user || ''
      state.chatExtra = extra || null
      stopPath(bot)
      plog('chat cmd follow ' + (user || '?') + ' (stay cancelled, hunt may resume loose)')
      writeStatus(bot, Object.assign({}, state, { phase: 'chat-follow', note: 'chat follow ' + (user || '?') }))
      if (inHole(bot)) {
        plog('follow deferred, escape first')
        return
      }
      const ent = findPlayerNamed(bot, user)
      if (ent) startFollow(bot, ent, FOLLOW_RANGE)
      return
    }
    if (cmd === 'come') {
      state.chatMode = 'come'
      state.chatUser = user || ''
      state.chatExtra = extra || null
      stopPath(bot)
      state.saidComing = true
      chat('coming')
      plog('chat cmd come from ' + (user || '?') + ' (stay cancelled)')
      writeStatus(bot, Object.assign({}, state, { phase: 'chat-come', note: 'chat come from ' + (user || '?') }))
      if (inHole(bot)) {
        plog('come deferred, escape first')
        return
      }
      comeNow(bot, state, user, extra)
      return
    }
    if (cmd === 'say') {
      const text = extra && extra.text != null ? String(extra.text).trim() : ''
      if (text && text.length <= 40) {
        state.chatAllowSay = true
        try { bot.chat(text) } catch {}
        state.chatAllowSay = false
        plog('chat cmd say ' + text)
      } else {
        plog('chat say skipped (empty or long)')
      }
    }
  }

  let lastChatKey = ''
  let lastChatAt = 0
  function handlePlayerChat(user, text, src) {
    if (!user || !text) return
    if (String(user).toLowerCase() === String(bot.username || 'steve').toLowerCase()) return
    const key = user + '\0' + text
    const now = Date.now()
    if (key === lastChatKey && now - lastChatAt < 500) return
    lastChatKey = key
    lastChatAt = now
    const rec = { t: new Date().toISOString(), user: String(user), text: String(text) }
    appendJsonl(CHAT_LOG, rec)
    plog('chat heard src=' + src + ' ' + user + ': ' + String(text).slice(0, 120))
    const cmd = parseLocalCmd(text)
    if (cmd) {
      applyChatCmd(cmd, user, null)
      return
    }
    appendJsonl(CHAT_PENDING, rec)
    const short = String(text).trim()
    const u = String(user).toLowerCase()
    if (short.length > 0 && short.length <= 24 && (PLAYER_NAMES.includes(u) || short.toLowerCase().includes('steve'))) {
      // short human line: greet-like already handled; stay muted unless it is a hello variant
    }
  }

  bot.on('chat', (username, message) => {
    try { handlePlayerChat(username, message, 'chat') } catch (err) { plog('chat handler fail ' + (err && err.message)) }
  })
  bot.on('whisper', (username, message) => {
    try { handlePlayerChat(username, message, 'whisper') } catch (err) { plog('whisper handler fail ' + (err && err.message)) }
  })
  bot.on('messagestr', (msg) => {
    try {
      const m = String(msg || '')
      const mm = m.match(/^<([^>]+)>\s*(.*)$/)
      if (mm) handlePlayerChat(mm[1], mm[2], 'messagestr')
    } catch (err) { plog('messagestr handler fail ' + (err && err.message)) }
  })
  plog('chat listener on (chat/whisper/messagestr) log=' + CHAT_LOG)

  const cmdPoll = setInterval(() => {
    try {
      if (!fs.existsSync(COMMAND_FILE)) return
      const raw = fs.readFileSync(COMMAND_FILE, 'utf8').trim()
      try { fs.unlinkSync(COMMAND_FILE) } catch { try { fs.writeFileSync(COMMAND_FILE, '') } catch {} }
      if (!raw) return
      const obj = JSON.parse(raw)
      const action = String(obj.action || '').toLowerCase()
      plog('command.json action=' + action)
      if (action === 'follow' || action === 'come' || action === 'stop' || action === 'stay' || action === 'say') {
        const mapped = action === 'stop' ? 'stay' : action
        applyChatCmd(mapped, obj.user || state.chatUser || 'har0x', obj)
      }
    } catch (err) {
      plog('command.json fail ' + (err && err.message))
    }
  }, 2000)
  if (cmdPoll && cmdPoll.unref) cmdPoll.unref()

  // spawn: escape then follow Har0x + "coming" (no hey)


  bot.on('death', () => {
    state.dead = true
    state.waitingSpawn = true
    state.deaths += 1
    const p = posOf(bot)
    const v = vitals(bot)
    plog(`DEATH #${state.deaths} pos=${p ? p.str : '?'} health=${v.health} food=${v.food} phase=${state.phase}`)
    stopPath(bot)
    clearMove(bot)
    state.note = 'died, waiting respawn'
    writeStatus(bot, state)
    logEpisode(bot, state, 'death', 'died phase=' + state.phase)
  })

  bot.on('respawn', () => {
    const p = posOf(bot)
    const v = vitals(bot)
    plog(`RESPAWN pos=${p ? p.str : '?'} health=${v.health} food=${v.food}`)
    state.dead = false
    state.waitingSpawn = false
    state.leftHole = false
    state.foodPassed = false
    state.saidLookingSand = false
    state.note = 'respawned, wait then resume house'
    writeStatus(bot, state)
    logEpisode(bot, state, 'respawn', 'respawned')
  })

  bot.on('health', () => {
    const v = vitals(bot)
    const h = Number(bot.health)
    if (Number.isFinite(h) && h <= 10) {
      plog(`health low health=${v.health} food=${v.food} pos=${posOf(bot) && posOf(bot).str}`)
    }
  })

  bot.on('playerCollect', (collector) => {
    try {
      if (!collector || bot.entity && collector !== bot.entity) return
      const sand = countSand(bot)
      const dirt = countNamed(bot, ['dirt', 'grass_block'])
      plog('PLAYERCOLLECT sand=' + sand + ' dirt=' + dirt + ' items=' + inventorySummary(bot))
      writeStatus(bot, Object.assign({}, state, { note: 'PICKUP sand=' + sand + ' dirt=' + dirt }))
    } catch {}
  })

  bot.on('diggingCompleted', (block) => {
    if (!block || !block.name) return
    if (bareName(block.name).includes('planks')) {
      griefPlanks += 1
      state.griefPlanks = griefPlanks
      plog('grief plank completed ' + block.name + ' n=' + griefPlanks)
    }
  })

  let connClosed = false
  bot.on('kicked', (reason) => {
    if (connClosed) return
    connClosed = true
    let why = '?'
    try { why = typeof reason === 'string' ? reason : JSON.stringify(reason) } catch { why = String(reason) }
    logEpisode(bot, state, 'kick', 'kicked ' + String(why).slice(0, 80))
  })
  bot.on('end', (reason) => {
    if (connClosed) return
    connClosed = true
    logEpisode(bot, state, 'end', 'disconnected ' + String(reason || '').slice(0, 80))
  })

  ;(async () => {
    try {
      plog('loop start pid=' + process.pid + ' mode=p5-sand skills=on collectBlock=' + (bot.collectBlock && typeof bot.collectBlock.collect === 'function' ? 'ready' : 'MISSING'))
      try {
        if (bot.collectBlock) {
          bot.collectBlock.chestLocations = []
          bot.collectBlock.itemFilter = () => false
        }
      } catch {}
      applyNoJumpMovements(bot)
      applyCollectMovements(bot)
      applyNoJumpMovements(bot)
      try {
        if (bot.autoEat && typeof bot.autoEat.setOpts === 'function') {
          bot.autoEat.setOpts({ minHunger: 17 })
          plog('autoEat minHunger=17 (eat when food<18)')
        }
      } catch {}
      writeStatus(bot, state)
      await sleep(600)
      if (inHole(bot)) {
        plog('spawn in hole, escape first')
        await escapeHole(bot, state)
      }
      plog('no auto-follow; chat come/follow only. skills=escape,collect,follow,idle')
      while (true) {
        if (state.dead || state.waitingSpawn) {
          state.phase = 'dead'
          writeStatus(bot, state)
          await sleep(500)
          continue
        }
        if (state.note === 'respawned, wait then resume house') {
          state.phase = 'wait-spawn'
          plog('simple wait after death')
          await sleep(2500)
          await clearMove(bot)
          try { bot.setControlState('jump', false) } catch {}
          state.note = 'simple after death'
        }

        if (inHole(bot)) {
          state.leftHole = false
          state.phase = 'escape'
          await escapeHole(bot, state)
          continue
        }

        if (state.chatMode === 'come' || state.chatMode === 'stay' || state.chatMode === 'follow') {
          await honorChat(bot, state)
          continue
        }

        if (!state.foodPassed) {
          if (foodPassReady(bot, state, false)) continue
          await foodHunt(bot, state)
          continue
        }

        if (chatBusy(state)) {
          await honorChat(bot, state)
          continue
        }

        const sandNow = countSand(bot)
        const dirtNow = countNamed(bot, ['dirt', 'grass_block'])
        const have = sandNow + dirtNow
        const rNow = horizFromOrigin(bot)
        const followingHarox = state.chatMode === 'follow' || state.chatMode === 'come'

        if (rNow < SPAWN_SAFE_R && !followingHarox) {
          state.phase = 'leave-spawn'
          await leaveSpawnIfNeeded(bot, state)
          continue
        }

        if (sandNow < 1) {
          await huntSand(bot, state)
          writeStatus(bot, state)
          continue
        }

        await idleTick(bot, state)
        writeStatus(bot, state)
      }
    } catch (err) {
      plog('loop crash ' + (err && err.message))
      if (err && err.stack) console.error(err.stack)
      state.note = 'loop crash: ' + (err && err.message)
      writeStatus(bot, state)
    }
  })()
}
