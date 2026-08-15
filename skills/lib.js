import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pathfinderPkg from 'mineflayer-pathfinder'
import Vec3Import from 'vec3'

const { goals } = pathfinderPkg
export const Vec3 = Vec3Import.Vec3 || Vec3Import
export { goals, pathfinderPkg }

export const SPAWN_SAFE_R = 24
export const SPAWN_LEAVE_R = 28
export const SAND_SCAN_R = 48
export const SAND_ITEMS = new Set(['sand', 'red_sand'])
export const PLAYER_NAMES = ['har0x', 'glenn']

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG = path.join(__dirname, '..', 'bot.log')

export function plog(msg) {
  const line = `[${new Date().toISOString()}] [play] ${msg}`
  console.log(line)
  try { fs.appendFileSync(LOG, line + '\n') } catch {}
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export function posOf(bot) {
  const p = bot.entity && bot.entity.position
  if (!p) return null
  return { x: p.x, y: p.y, z: p.z, str: `${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}` }
}

export function bareName(name) {
  if (!name) return ''
  const n = String(name)
  const c = n.indexOf(':')
  return (c >= 0 ? n.slice(c + 1) : n).toLowerCase()
}

export function isSolid(b) {
  return !!(b && b.boundingBox === 'block')
}

export function horizFromOrigin(bot) {
  const p = bot.entity && bot.entity.position
  if (!p) return 0
  return Math.hypot(p.x, p.z)
}

export function resolveItemName(bot, item) {
  if (!item) return ''
  if (item.name) return bareName(item.name)
  try {
    const id = item.type != null ? item.type : item.id
    const rec = bot.registry && bot.registry.items && bot.registry.items[id]
    if (rec && rec.name) return bareName(rec.name)
  } catch {}
  return ''
}

export function eachInventoryItem(bot, fn) {
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

export function countNamed(bot, names) {
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

export function countSand(bot) { return countNamed(bot, SAND_ITEMS) }

export function inventorySummary(bot) {
  const bag = {}
  eachInventoryItem(bot, (it) => {
    const n = resolveItemName(bot, it) || '?'
    bag[n] = (bag[n] || 0) + (Number(it.count) || 0)
  })
  const parts = Object.keys(bag).sort().map((k) => k + '=' + bag[k])
  return parts.length ? parts.join(',') : 'empty'
}

export function isPlayerBuilt(b) {
  if (!b || !b.name) return false
  const n = bareName(b.name)
  if (SAND_ITEMS.has(n) || n === 'dirt' || n === 'grass_block' || n === 'gravel' || n === 'sandstone') return false
  if (n.includes('planks') || n.endsWith('_log') || n.endsWith('_wood') || n.endsWith('_stem') || n.endsWith('_hyphae')) return true
  if (n.includes('door') || n.includes('chest') || n.includes('trapdoor') || n.includes('fence') || n.includes('gate')) return true
  if (n.includes('stairs') || n.includes('slab') || n.includes('sign') || n.includes('bed') || n.includes('banner')) return true
  if (n.includes('glass') || n.includes('wool') || n.includes('terracotta') || n.endsWith('_concrete')) return true
  if (n === 'crafting_table' || n === 'furnace' || n === 'blast_furnace' || n === 'smoker' || n === 'barrel' || n === 'hopper') return true
  if (n === 'torch' || n === 'wall_torch' || n === 'lantern' || n === 'ladder' || n === 'scaffolding' || n === 'bookshelf') return true
  if (n === 'cobblestone' || n.includes('wood') || n.includes('log')) return true
  return false
}

export function isSandBlock(b) {
  const n = bareName(b && b.name)
  return n === 'sand' || n === 'red_sand'
}

export async function clearMove(bot) {
  try {
    bot.setControlState('forward', false)
    bot.setControlState('back', false)
    bot.setControlState('left', false)
    bot.setControlState('right', false)
    bot.setControlState('sprint', false)
    bot.setControlState('jump', false)
  } catch {}
}

export function stopPath(bot) {
  try { if (bot.collectBlock && typeof bot.collectBlock.cancelTask === 'function') bot.collectBlock.cancelTask() } catch {}
  try { if (bot.pathfinder) bot.pathfinder.setGoal(null) } catch {}
}

export function sayAllowed(bot, state, text) {
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

export function findPlayerNamed(bot, name) {
  const want = name ? String(name).toLowerCase() : ''
  try {
    for (const [n, pl] of Object.entries(bot.players || {})) {
      const ln = String(n).toLowerCase()
      if (want && ln !== want) continue
      if (!want && !PLAYER_NAMES.includes(ln)) continue
      if (pl && pl.entity && pl.entity.position) return pl.entity
    }
    for (const e of Object.values(bot.entities || {})) {
      const n = (e.username || e.name || '').toLowerCase()
      if (e.type === 'player' && e.position) {
        if (want && n === want) return e
        if (!want && PLAYER_NAMES.includes(n)) return e
      }
    }
  } catch {}
  return null
}
