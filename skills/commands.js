import { plog, sayAllowed, countNamed } from './lib.js'
import { tryEat, countFood } from './food.js'

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
  const craftM = core.match(/^craft(?:\s+([a-z0-9_]+))?$/)
  if (craftM) return { cmd: 'craft', item: craftM[1] || 'sandstone' }
  if (core === 'wood' || core === 'tree' || core === 'chop' || core === 'logs') return { cmd: 'wood' }
  if (core === 'place') return { cmd: 'place' }
  if (core === 'table' || core === 'crafting table' || core === 'crafting_table' || core === 'workbench') return { cmd: 'table' }
  if (core === 'shovel' || core === 'wooden shovel' || core === 'wooden_shovel') return { cmd: 'shovel' }
  if (core === 'pick' || core === 'pickaxe' || core === 'wooden pick' || core === 'wooden pickaxe' || core === 'wooden_pickaxe') return { cmd: 'pick' }
  if (core === 'hut' || core === 'house' || core === 'build hut') return { cmd: 'build', name: 'hut' }
  if (core === 'commands' || core === 'help') return { cmd: 'commands' }
  const buildM = core.match(/^build(?:\s+([a-z0-9_]+))?$/)
  if (buildM) return { cmd: 'build', name: buildM[1] || 'hut' }
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
  const inv = countFood(bot)
  try {
    if (food < 18 && inv > 0) {
      const ate = await tryEat(bot)
      if (ate) {
        sayAllowed(bot, state, 'eating')
        plog('cmd hungry ate food=' + bot.food)
        return
      }
    }
  } catch (err) {
    plog('cmd hungry eat fail ' + (err && err.message))
  }
  if (food < 18) sayAllowed(bot, state, 'hungry')
  else sayAllowed(bot, state, "I'm good")
  plog('cmd hungry food=' + food + ' inv=' + inv)
}
