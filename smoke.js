import { createRequire } from 'module'
import mineflayer from 'mineflayer'
import { pathfinder } from 'mineflayer-pathfinder'
import collectBlockPkg from 'mineflayer-collectblock'
import pvpPkg from 'mineflayer-pvp'
import { loader as autoEat } from 'mineflayer-auto-eat'

const require = createRequire(import.meta.url)

function ver(name) {
  return require(name + '/package.json').version
}

function pluginType(mod) {
  if (typeof mod === 'function') return 'function'
  if (mod && typeof mod.plugin === 'function') return 'plugin'
  if (mod && typeof mod.default === 'function') return 'default'
  return typeof mod
}

console.log('smoke: loading packages without connecting')
console.log('mineflayer', ver('mineflayer'), typeof mineflayer.createBot)
console.log('pathfinder', ver('mineflayer-pathfinder'), typeof pathfinder)
console.log('collectblock', ver('mineflayer-collectblock'), pluginType(collectBlockPkg))
console.log('pvp', ver('mineflayer-pvp'), pluginType(pvpPkg))
console.log('auto-eat', ver('mineflayer-auto-eat'), typeof autoEat)

if (typeof mineflayer.createBot !== 'function') {
  console.error('smoke FAIL: createBot missing')
  process.exit(1)
}
if (typeof pathfinder !== 'function') {
  console.error('smoke FAIL: pathfinder plugin missing')
  process.exit(1)
}
if (typeof autoEat !== 'function') {
  console.error('smoke FAIL: auto-eat loader missing')
  process.exit(1)
}

console.log('smoke OK — packages load; no server connection attempted')
