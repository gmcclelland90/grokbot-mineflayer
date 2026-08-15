import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { plog, sleep, horizFromOrigin, countNamed, countLogs, countSand, SPAWN_SAFE_R } from './lib.js'
import { countFood } from './food.js'
import { loadStorage, extrasToDump } from './storage.js'
import { myName } from './cluster.js'
import { leaveSpawnForGather } from './collect.js'
import { runGather, missingTargets } from './gather.js'
import { depositExtras, catalogNearby } from './chest.js'
import { runCamp } from './camp.js'
import { runFarm } from './farm.js'
import { gotoNear } from './lib.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(__dirname, '..', 'rl', 'jobs.json')
const LOCK = path.join(__dirname, '..', 'rl', 'jobs.lock')
const LOCK_MS = 8000

// Queen (chat + keep-alive) writes colony goals. Workers only claim.
// A worker may seed only foraging jobs if the board is empty.
const FORAGE = [
  { id: 'leave-spawn', type: 'gather', priority: 100 },
  { id: 'gather-stock', type: 'gather', priority: 90 },
  { id: 'deposit', type: 'deposit', priority: 80 },
  { id: 'place-camp', type: 'build', schematic: 'camp', priority: 70 },
  { id: 'tend-farm', type: 'farm', priority: 60 },
  { id: 'guard-camp', type: 'guard', priority: 50 }
]

function emptyBoard() {
  return {
    queen: 'chat+keepalive',
    workers: ['Steve'],
    jobs: [],
    updated: new Date().toISOString()
  }
}

function tryLock() {
  try {
    fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, t: Date.now() }), { flag: 'wx' })
    return true
  } catch {
    try {
      const j = JSON.parse(fs.readFileSync(LOCK, 'utf8'))
      if (!j || Date.now() - Number(j.t || 0) > LOCK_MS) {
        try { fs.unlinkSync(LOCK) } catch {}
        fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, t: Date.now() }), { flag: 'wx' })
        return true
      }
    } catch {}
    return false
  }
}

function unlock() {
  try { fs.unlinkSync(LOCK) } catch {}
}

async function withLock(fn) {
  const start = Date.now()
  while (Date.now() - start < 4000) {
    if (tryLock()) {
      try { return await fn() } finally { unlock() }
    }
    await sleep(50)
  }
  return fn()
}

export function loadJobs() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    if (j && typeof j === 'object') {
      j.jobs = Array.isArray(j.jobs) ? j.jobs : []
      if (!j.queen) j.queen = 'chat+keepalive'
      if (!j.workers) j.workers = ['Steve']
      return j
    }
  } catch {}
  return emptyBoard()
}

export function saveJobs(data) {
  const out = data || emptyBoard()
  out.updated = new Date().toISOString()
  if (!out.queen) out.queen = 'chat+keepalive'
  try { fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n') } catch (err) {
    plog('jobs write fail ' + (err && err.message))
  }
  return out
}

function jobOpen(j) {
  return j && (j.status === 'open' || !j.status)
}

function nowIso() {
  return new Date().toISOString()
}

function upsertForage(board, id, extra) {
  const proto = FORAGE.find((x) => x.id === id)
  if (!proto) return
  let row = board.jobs.find((j) => j.id === id)
  if (!row) {
    row = { id, type: proto.type, status: 'open', claimedBy: null, priority: proto.priority, updated: nowIso() }
    if (proto.schematic) row.schematic = proto.schematic
    board.jobs.push(row)
  }
  Object.assign(row, extra || {})
  row.updated = nowIso()
}

// Worker may only add foraging jobs, never city-scale goals.
export function seedForageIfEmpty(bot, state) {
  const board = loadJobs()
  const missing = missingTargets(bot)
  const extras = extrasToDump(bot)
  const r = horizFromOrigin(bot)
  const campBuilt = !!(state && state.campBuilt)
  const hasChest = (loadStorage().chests || []).length > 0

  if (r < SPAWN_SAFE_R) upsertForage(board, 'leave-spawn', { status: 'open', claimedBy: null })
  else {
    const row = board.jobs.find((j) => j.id === 'leave-spawn')
    if (row && row.status !== 'done') { row.status = 'done'; row.updated = nowIso() }
  }

  if (Object.keys(missing).length) upsertForage(board, 'gather-stock', { status: 'open', claimedBy: null, item: Object.keys(missing)[0], count: missing[Object.keys(missing)[0]] })
  else {
    const row = board.jobs.find((j) => j.id === 'gather-stock')
    if (row && row.status === 'open') { row.status = 'done'; row.updated = nowIso() }
  }

  if (extras.length && hasChest) upsertForage(board, 'deposit', { status: 'open', claimedBy: null })
  if (!campBuilt) upsertForage(board, 'place-camp', { status: 'open', claimedBy: null, schematic: 'camp' })
  else {
    const row = board.jobs.find((j) => j.id === 'place-camp')
    if (row && row.status !== 'done') { row.status = 'done'; row.updated = nowIso() }
    upsertForage(board, 'tend-farm', { status: jobOpen(board.jobs.find((j) => j.id === 'tend-farm')) ? 'open' : 'open', claimedBy: null })
    upsertForage(board, 'guard-camp', { status: 'open', claimedBy: null })
  }

  board.workers = board.workers || ['Steve']
  const me = myName()
  if (!board.workers.map((w) => String(w).toLowerCase()).includes(me.toLowerCase())) board.workers.push(me)
  saveJobs(board)
  return board
}

export async function claimNextJob(bot, state) {
  return withLock(() => {
    const board = seedForageIfEmpty(bot, state)
    const open = board.jobs.filter((j) => jobOpen(j)).sort((a, b) => (b.priority || 0) - (a.priority || 0))
    const job = open[0]
    if (!job) return null
    job.status = 'claimed'
    job.claimedBy = myName()
    job.updated = nowIso()
    saveJobs(board)
    plog('jobs claim ' + job.id + ' type=' + job.type + ' by=' + job.claimedBy)
    return job
  })
}

export async function finishJob(job, ok) {
  if (!job) return
  return withLock(() => {
    const board = loadJobs()
    const row = board.jobs.find((j) => j.id === job.id)
    if (!row) return
    if (ok) {
      row.status = 'done'
      // forage loops: re-open tend/guard so the colony keeps working
      if (row.id === 'tend-farm' || row.id === 'guard-camp' || row.id === 'gather-stock') {
        row.status = 'open'
        row.claimedBy = null
      }
    } else {
      row.status = 'open'
      row.claimedBy = null
    }
    row.updated = nowIso()
    saveJobs(board)
    plog('jobs ' + (ok ? 'done' : 'retry') + ' ' + job.id)
  })
}

export async function runClaimedJob(bot, state, job) {
  if (!job) return false
  state.jobId = job.id
  state.note = 'job ' + job.id
  try {
    if (job.id === 'leave-spawn' || (job.type === 'gather' && horizFromOrigin(bot) < SPAWN_SAFE_R && job.id === 'leave-spawn')) {
      return leaveSpawnForGather(bot, state)
    }
    if (job.id === 'gather-stock' || job.type === 'gather') {
      if (job.item) {
        state.gatherName = job.item
        state.gatherCount = job.count || 8
      }
      return runGather(bot, state)
    }
    if (job.id === 'deposit' || job.type === 'deposit') {
      const dumped = await depositExtras(bot, state)
      try { await catalogNearby(bot, state) } catch {}
      return !!dumped
    }
    if (job.id === 'place-camp' || (job.type === 'build' && job.schematic === 'camp')) {
      return runCamp(bot, state)
    }
    if (job.id === 'tend-farm' || job.type === 'farm') {
      state.farmKind = state.farmKind || 'tend'
      return runFarm(bot, state)
    }
    if (job.id === 'guard-camp' || job.type === 'guard') {
      const origin = (state && state.guardPos) || (state && state.campOrigin) || loadStorage().camp
      if (origin && origin.x != null) {
        state.guardPos = { x: origin.x + 3, y: origin.y || 64, z: origin.z + 3 }
        try { await gotoNear(bot, state.guardPos.x, state.guardPos.y, state.guardPos.z, 3, 8000) } catch {}
        state.note = 'guard camp'
        await sleep(1500)
        return true
      }
      return false
    }
  } catch (err) {
    plog('jobs run fail ' + job.id + ' ' + (err && err.message))
    return false
  }
  return false
}
