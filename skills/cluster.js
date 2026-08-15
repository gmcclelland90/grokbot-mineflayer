import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { plog, sleep } from './lib.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const CFG = path.join(ROOT, 'cluster.json')
const LOCK = path.join(ROOT, 'rl', 'chest.lock')
const LOCK_MS = 15000

let _names = null

export function loadCluster() {
  try {
    const j = JSON.parse(fs.readFileSync(CFG, 'utf8'))
    if (j && typeof j === 'object') return j
  } catch {}
  return { count: 1, baseName: 'Steve', names: ['Steve'], auth: 'offline' }
}

export function clusterNames() {
  if (_names) return _names
  const cfg = loadCluster()
  const out = new Set(['steve'])
  for (const n of cfg.names || []) {
    if (n) out.add(String(n).toLowerCase())
  }
  const base = String(cfg.baseName || 'Steve')
  out.add(base.toLowerCase())
  for (let i = 2; i <= 8; i++) out.add((base + i).toLowerCase())
  const envName = process.env.STEVE_NAME || process.env.MC_USERNAME
  if (envName) out.add(String(envName).toLowerCase())
  _names = [...out]
  return _names
}

export function isAllyName(name) {
  const n = String(name || '').toLowerCase()
  if (!n) return false
  if (n === 'steve' || n.startsWith('steve')) return true
  return clusterNames().includes(n)
}

export function myName() {
  return String(process.env.STEVE_NAME || process.env.MC_USERNAME || 'Steve')
}

export function botLogPath() {
  return process.env.STEVE_LOG || path.join(ROOT, 'bot.log')
}

export function botStatusPath() {
  return process.env.STEVE_STATUS || path.join(ROOT, 'STATUS.txt')
}

function staleLock() {
  try {
    const j = JSON.parse(fs.readFileSync(LOCK, 'utf8'))
    if (!j || !j.t) return true
    return Date.now() - Number(j.t) > LOCK_MS
  } catch {
    return true
  }
}

function tryLock() {
  try {
    fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, t: Date.now(), name: myName() }) + '\n', { flag: 'wx' })
    return true
  } catch {
    if (staleLock()) {
      try { fs.unlinkSync(LOCK) } catch {}
      try {
        fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, t: Date.now(), name: myName() }) + '\n', { flag: 'wx' })
        return true
      } catch {
        return false
      }
    }
    return false
  }
}

function unlock() {
  try { fs.unlinkSync(LOCK) } catch {}
}

export async function withChestLock(fn) {
  const start = Date.now()
  while (Date.now() - start < 10000) {
    if (tryLock()) {
      try {
        return await fn()
      } finally {
        unlock()
      }
    }
    await sleep(200)
  }
  plog('chest lock timeout, skip')
  return false
}
