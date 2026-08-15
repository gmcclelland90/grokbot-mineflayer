import { plog, sayAllowed, countNamed } from './lib.js'

const COME_PHRASES = /\bover here\b|\bthis way\b|\bcome look\b|\bcome see\b|\blook here\b/

export function parseLocalCmd(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const t = raw.toLowerCase()
  if (COME_PHRASES.test(t)) return { cmd: 'come' }

  let core = t
    .replace(/^!+/, '')
    .replace(/[!?.]+$/g, '')
    .trim()
  core = core.replace(/^steve[,:\s]+/, '').replace(/\s+steve$/, '').trim()
  core = core.replace(/^!+/, '').trim()

  if (core === 'come' || core === 'here' || core === 'come here' || core === 'come to me') return { cmd: 'come' }
  if (core === 'follow' || core === 'follow me') return { cmd: 'follow' }
  const followM = core.match(/^follow\s+(\S+)$/)
  if (followM) return { cmd: 'follow', user: followM[1] }
  if (core === 'stop' || core === 'stay' || core === 'stand still') return { cmd: 'stay' }
  if (core === 'hungry' || core === 'eat' || core === 'food') return { cmd: 'hungry' }
  const col = core.match(/^collect(?:\s+([a-z0-9_]+))?$/)
  if (col) return { cmd: 'collect', block: col[1] || 'sand' }
  if (/\b(hi|hey|hello)\b/.test(t)) return { cmd: 'hi' }
  return null
}

export function cmdName(cmd) {
  if (!cmd) return ''
  if (typeof cmd === 'string') return cmd
  return String(cmd.cmd || '')
}

export async function sayHungry(bot, state) {
  let food = 20
  try { if (bot.food != null) food = Number(bot.food) } catch {}
  const inv = countNamed(bot, [
    'sweet_berries', 'glow_berries', 'apple', 'bread',
    'carrot', 'potato', 'baked_potato', 'melon_slice',
    'porkchop', 'cooked_porkchop', 'beef', 'cooked_beef',
    'chicken', 'cooked_chicken', 'mutton', 'cooked_mutton'
  ])
  try {
    if (food < 18 && bot.autoEat && typeof bot.autoEat.eat === 'function' && inv > 0) {
      await bot.autoEat.eat()
      sayAllowed(bot, state, 'eating')
      plog('cmd hungry ate food=' + bot.food)
      return
    }
  } catch (err) {
    plog('cmd hungry eat fail ' + (err && err.message))
  }
  if (food < 18) sayAllowed(bot, state, 'hungry')
  else sayAllowed(bot, state, "I'm good")
  plog('cmd hungry food=' + food + ' inv=' + inv)
}
