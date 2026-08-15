import { plog, sayAllowed, PLAYER_NAMES } from './lib.js'
import { isAllyName } from './cluster.js'

// Official chatterbox.js crumb: playerJoined only (no coord / entityHurt spam).
// https://github.com/PrismarineJS/mineflayer/blob/master/examples/chatterbox.js
// One short "hey" if not self, 60s cooldown.

const JOIN_HEY_MS = 60000

export function wireChatter(bot, state) {
  bot.on('playerJoined', (player) => {
    try {
      if (!player || !player.username) return
      if (player.username === bot.username) return
      if (isAllyName(player.username)) return
      const me = String(bot.username || '').toLowerCase()
      if (me !== 'steve') return
      if (!PLAYER_NAMES.includes(String(player.username).toLowerCase())) return
      const now = Date.now()
      if (now - (state.lastJoinHeyAt || 0) < JOIN_HEY_MS) {
        plog('chatter playerJoined rate-limited ' + player.username)
        return
      }
      state.lastJoinHeyAt = now
      state.lastHeyAt = now
      sayAllowed(bot, state, 'hey')
      plog('chatter playerJoined hey ' + player.username)
    } catch (err) {
      plog('chatter playerJoined fail ' + (err && err.message))
    }
  })
  plog('chatter playerJoined from chatterbox.js')
}
