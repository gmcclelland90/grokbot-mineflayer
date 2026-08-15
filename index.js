import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mineflayer from 'mineflayer'
import { pathfinder, Movements } from 'mineflayer-pathfinder'
import { startPlayLoop } from './play.js'
import collectBlockPkg from 'mineflayer-collectblock'
import pvpPkg from 'mineflayer-pvp'
import { loader as autoEat } from 'mineflayer-auto-eat'
import toolPkg from 'mineflayer-tool'
import armorManagerPkg from 'mineflayer-armor-manager'
import stateMachine from 'mineflayer-statemachine'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function log(level, msg, extra) {
  const ts = new Date().toISOString()
  if (extra !== undefined) {
    console.log(`[${ts}] [${level}] ${msg}`, extra)
  } else {
    console.log(`[${ts}] [${level}] ${msg}`)
  }
  try {
    const line = extra !== undefined
      ? `[${ts}] [${level}] ${msg} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`
      : `[${ts}] [${level}] ${msg}`
    fs.appendFileSync(process.env.STEVE_LOG || path.join(__dirname, 'bot.log'), line + '\n')
  } catch {}
}

function keepAlive(reason) {
  log('info', reason + ' Process staying up until killed (Ctrl+C / SIGTERM).')
  if (!keepAlive._timer) {
    keepAlive._timer = setInterval(() => {
      log('info', 'Still running; waiting to be killed. No active Minecraft connection.')
    }, 60000)
  }
}

function defined(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')
  )
}

function loadConfig() {
  const defaults = {
    host: undefined,
    port: 25565,
    version: undefined,
    username: 'Steve',
    auth: 'offline'
  }

  let fileCfg = {}
  const configPath = path.join(__dirname, 'config.json')
  if (fs.existsSync(configPath)) {
    try {
      fileCfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      log('info', 'Loaded config from ' + configPath)
    } catch (err) {
      log('error', 'Failed to parse config.json: ' + err.message)
      return { error: 'invalid-config' }
    }
  }

  const envCfg = {
    host: process.env.MC_HOST,
    port: process.env.MC_PORT !== undefined && process.env.MC_PORT !== '' ? Number(process.env.MC_PORT) : undefined,
    version: process.env.MC_VERSION,
    username: process.env.MC_USERNAME,
    auth: process.env.MC_AUTH
  }

  const cfg = { ...defaults, ...defined(fileCfg), ...defined(envCfg) }
  cfg.port = Number(cfg.port)
  if (!Number.isFinite(cfg.port) || cfg.port <= 0) cfg.port = 25565
  cfg.auth = String(cfg.auth || 'offline').toLowerCase()
  if (cfg.version) cfg.version = String(cfg.version)
  return cfg
}

function pluginOf(mod, name) {
  if (typeof mod === 'function') return mod
  if (mod && typeof mod.plugin === 'function') return mod.plugin
  if (mod && typeof mod.default === 'function') return mod.default
  if (mod && mod.default && typeof mod.default.plugin === 'function') return mod.default.plugin
  throw new Error('Could not find plugin export on ' + name)
}

function formatReason(reason) {
  if (reason == null) return '(no reason)'
  if (typeof reason === 'string') return reason
  try {
    return JSON.stringify(reason)
  } catch {
    return String(reason)
  }
}

function hintForError(err) {
  const msg = String(err && err.message ? err.message : err || '').toLowerCase()
  const code = String(err && err.code ? err.code : '')
  if (code === 'ECONNREFUSED' || msg.includes('econnrefused')) {
    log('error', 'Hint: connection refused — host/port may be wrong or the server is not running.')
  } else if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || msg.includes('timeout')) {
    log('error', 'Hint: timeout/unreachable — check host, firewall, and that the server is publicly reachable.')
  } else if (msg.includes('version') || msg.includes('protocol') || msg.includes('not supported')) {
    log('error', 'Hint: Minecraft version mismatch — set MC_VERSION to the exact server version (example: 1.21.4).')
  } else if (msg.includes('online-mode') || msg.includes('encryption') || msg.includes('invalid session') || msg.includes('authentication')) {
    log('error', 'Hint: auth mismatch — if the server is online-mode, use MC_AUTH=microsoft; if offline, use MC_AUTH=offline.')
  }
}

function shutdown(bot, signal) {
  log('info', 'Received ' + signal + ', quitting...')
  try {
    if (bot && typeof bot.quit === 'function') bot.quit('bye')
  } catch {}
  setTimeout(() => process.exit(0), 500).unref()
}

function applySafeMovements(bot) {
  const mv = new Movements(bot)
  mv.canDig = false
  mv.allow1by1towers = false
  mv.allowParkour = false
  mv.allowSprinting = false
  mv.maxDropDown = 1
  mv.scafoldingBlocks = []
  bot.pathfinder.setMovements(mv)
  log('info', 'Safe movements: no-parkour, maxDropDown=1, no jump, no dig')
}

function connect(cfg) {
  const options = {
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    auth: cfg.auth,
    hideErrors: false
  }
  if (cfg.version) options.version = cfg.version

  log('info', 'Connecting to Minecraft server...', {
    host: options.host,
    port: options.port,
    username: options.username,
    auth: options.auth,
    version: options.version || '(autodetect)'
  })

  let bot
  try {
    bot = mineflayer.createBot(options)
  } catch (err) {
    log('error', 'Failed to create bot: ' + err.message)
    if (err.stack) console.error(err.stack)
    hintForError(err)
    keepAlive('createBot threw.')
    return
  }

  try {
    bot.loadPlugin(pathfinder)
    bot.loadPlugin(pluginOf(collectBlockPkg, 'collectblock'))
    bot.loadPlugin(pluginOf(pvpPkg, 'pvp'))
    bot.loadPlugin(pluginOf(toolPkg, 'tool'))
    bot.loadPlugin(pluginOf(armorManagerPkg, 'armor-manager'))
    const sm = stateMachine && (stateMachine.BotStateMachine || stateMachine.StateTransition || (stateMachine.default && stateMachine.default.BotStateMachine))
    log('info', 'Loaded plugins: pathfinder, collectblock, pvp, tool, armor-manager statemachine=' + !!sm + ' (BotStateMachine starts in play)')
  } catch (err) {
    log('error', 'Plugin load failed: ' + err.message)
    console.error(err)
  }

  bot.on('login', () => {
    log('info', 'Logged in as ' + bot.username)
  })

  bot.once('spawn', () => {
    log('info', 'Spawned in world. version=' + bot.version)
    let posStr = 'unknown'
    try {
      const pos = bot.entity && bot.entity.position
      if (pos) {
        const x = Number(pos.x).toFixed(2)
        const y = Number(pos.y).toFixed(2)
        const z = Number(pos.z).toFixed(2)
        posStr = x + ' ' + y + ' ' + z
        log('info', 'Position: ' + posStr)
      } else {
        log('info', 'Position: unavailable (no bot.entity.position)')
      }
    } catch (err) {
      log('error', 'Failed to read position: ' + err.message)
    }
    try {
      const dim = bot.game && bot.game.dimension
      log('info', 'Dimension: ' + (dim != null && dim !== '' ? dim : 'unavailable'))
    } catch (err) {
      log('error', 'Failed to read dimension: ' + err.message)
    }
    try {
      applySafeMovements(bot)
    } catch (err) {
      log('error', 'pathfinder Movements setup failed: ' + err.message)
    }
    try {
      bot.loadPlugin(autoEat)
      if (bot.autoEat && typeof bot.autoEat.enableAuto === 'function') bot.autoEat.enableAuto()
      log('info', 'Loaded plugin: auto-eat (enabled)')
    } catch (err) {
      log('error', 'auto-eat load failed: ' + err.message)
    }
    try {
      log('info', 'Skipping spawn chat')
    } catch (err) {
      log('error', 'Spawn chat threw: ' + err.message)
    }
    try {
      startPlayLoop(bot)
      log('info', 'Play loop started')
    } catch (err) {
      log('error', 'Play loop failed: ' + err.message)
    }
  })

  let lastHealth = null
  bot.on('death', () => {
    let posStr = 'unknown'
    try {
      const pos = bot.entity && bot.entity.position
      if (pos) posStr = Number(pos.x).toFixed(2) + ' ' + Number(pos.y).toFixed(2) + ' ' + Number(pos.z).toFixed(2)
    } catch {}
    log('warn', 'DEATH pos=' + posStr + ' health=' + bot.health + ' food=' + bot.food)
  })

  bot.on('respawn', () => {
    let posStr = 'unknown'
    try {
      const pos = bot.entity && bot.entity.position
      if (pos) posStr = Number(pos.x).toFixed(2) + ' ' + Number(pos.y).toFixed(2) + ' ' + Number(pos.z).toFixed(2)
    } catch {}
    log('info', 'RESPAWN pos=' + posStr + ' health=' + bot.health + ' food=' + bot.food)
    try { applySafeMovements(bot) } catch (err) { log('error', 'respawn movements failed: ' + err.message) }
    try {
      if (bot.autoEat && typeof bot.autoEat.enableAuto === 'function') bot.autoEat.enableAuto()
    } catch {}
    try {
      if (bot.armorManager && typeof bot.armorManager.equipAll === 'function') bot.armorManager.equipAll()
    } catch {}
  })

  bot.on('health', () => {
    const h = bot.health
    const f = bot.food
    if (lastHealth != null && h < lastHealth) {
      let posStr = 'unknown'
      try {
        const pos = bot.entity && bot.entity.position
        if (pos) posStr = Number(pos.x).toFixed(2) + ' ' + Number(pos.y).toFixed(2) + ' ' + Number(pos.z).toFixed(2)
      } catch {}
      log('warn', 'Health drop ' + lastHealth + ' -> ' + h + ' food=' + f + ' pos=' + posStr)
    }
    lastHealth = h
  })

  bot.on('kicked', (reason, loggedIn) => {
    log('error', 'Kicked (loggedIn=' + loggedIn + '): ' + formatReason(reason))
  })

  bot.on('error', (err) => {
    log('error', 'Error: ' + (err && err.message ? err.message : err))
    if (err && err.code) log('error', 'Error code: ' + err.code)
    hintForError(err)
  })

  bot.on('end', (reason) => {
    log('info', 'Disconnected: ' + formatReason(reason))
    keepAlive('Disconnected from server.')
  })

  process.on('SIGINT', () => shutdown(bot, 'SIGINT'))
  process.on('SIGTERM', () => shutdown(bot, 'SIGTERM'))
}

process.on('uncaughtException', (err) => {
  log('error', 'uncaughtException: ' + (err && err.message ? err.message : err))
  if (err && err.stack) console.error(err.stack)
  hintForError(err)
  keepAlive('Uncaught exception (process not exiting).')
})

process.on('unhandledRejection', (err) => {
  log('error', 'unhandledRejection: ' + (err && err.message ? err.message : err))
  if (err && err.stack) console.error(err.stack)
  hintForError(err)
})

const cfg = loadConfig()
if (!cfg || cfg.error) {
  process.exitCode = 1
  keepAlive('Invalid config.json.')
} else if (!cfg.host) {
  log('error', 'No host configured. Set MC_HOST or put "host" in config.json (see config.example.json).')
  log('info', 'Still needed from Glenn: server host, port (default 25565), Minecraft version, and whether the server is online-mode (MC_AUTH=microsoft) or offline (MC_AUTH=offline).')
  process.exit(1)
} else if (cfg.auth !== 'offline' && cfg.auth !== 'microsoft') {
  log('error', 'Unsupported auth "' + cfg.auth + '". Use "offline" or "microsoft".')
  process.exit(1)
} else {
  connect(cfg)
}
