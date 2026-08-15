import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { plog, sleep, horizFromOrigin, countNamed, countLogs, countPlanks, countSand, SPAWN_SAFE_R } from './lib.js'
import { countFood } from './food.js'
import { loadStorage, extrasToDump } from './storage.js'
import { myName } from './cluster.js'
import { leaveSpawnForGather } from './collect.js'
import { runGather, missingTargets } from './gather.js'
import { depositExtras, catalogNearby, ensureDumpChests } from './chest.js'
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
  { id: 'gather-wood', type: 'gather', item: 'logs', priority: 96 },
  { id: 'gather-cobble', type: 'gather', item: 'cobblestone', priority: 86 },
  { id: 'deposit', type: 'deposit', priority: 80 },
  { id: 'place-dump', type: 'dump', priority: 93 },
  { id: 'place-camp', type: 'build', schematic: 'camp', priority: 70 },
  { id: 'tend-farm', type: 'farm', priority: 60 },
  { id: 'guard-camp', type: 'guard', priority: 50 }
]

function emptyBoard() {
  return {
    queen: 'chat+keepalive',
    workers: ['Steve', 'Steve2', 'Steve3', 'Steve4', 'Steve5', 'Steve6'],
    jobs: [],
    updated: new Date().toISOString()
  }
}

function canCraftChest(bot) {
  return countNamed(bot, ['chest']) >= 1 || countPlanks(bot) >= 8 || countLogs(bot) >= 2
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
      j.queen = 'chat+keepalive'
      if (!j.workers) j.workers = ['Steve']
      return j
    }
  } catch {}
  return emptyBoard()
}

export function saveJobs(data) {
  const out = data || emptyBoard()
  out.updated = new Date().toISOString()
  out.queen = 'chat+keepalive'
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

function expireStaleClaims(board) {
  const now = Date.now()
  for (const j of board.jobs || []) {
    if (j.status !== 'claimed') continue
    const age = now - Date.parse(j.updated || 0)
    if (!Number.isFinite(age) || age > 40000) {
      j.status = 'open'
      j.claimedBy = null
      j.updated = nowIso()
    }
  }
}

function upsertForage(board, id, extra) {
  const proto = FORAGE.find((x) => x.id === id)
  if (!proto) return
  let row = board.jobs.find((j) => j.id === id)
  if (!row) {
    row = { id, type: proto.type, status: 'open', claimedBy: null, priority: proto.priority, updated: nowIso() }
    if (proto.schematic) row.schematic = proto.schematic
    if (proto.item) row.item = proto.item
    board.jobs.push(row)
  }
  // Never steal a live claim (N>1 hive).
  if (row.status === 'claimed' && row.claimedBy) {
    if (extra) {
      const keep = Object.assign({}, extra)
      delete keep.status
      delete keep.claimedBy
      Object.assign(row, keep)
    }
    row.updated = nowIso()
    return
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
  // Do not mark leave-spawn done for the hive just because THIS worker already left.

  if (Object.keys(missing).length) upsertForage(board, 'gather-stock', { status: 'open', claimedBy: null, item: Object.keys(missing)[0], count: missing[Object.keys(missing)[0]] })
  else {
    const row = board.jobs.find((j) => j.id === 'gather-stock')
    if (row && row.status === 'open') { row.status = 'done'; row.updated = nowIso() }
  }
  const logs = countLogs(bot)
  if (logs < 8) upsertForage(board, 'gather-wood', { status: 'open', claimedBy: null, item: 'logs', count: Math.max(8 - logs, 2) })
  if (missing.cobblestone) upsertForage(board, 'gather-cobble', { status: 'open', claimedBy: null, item: 'cobblestone', count: missing.cobblestone })

  if (extras.length && hasChest) upsertForage(board, 'deposit', { status: 'open', claimedBy: null })
  const roles = new Set((loadStorage().chests || []).map((c) => c && c.role).filter(Boolean))
  if (roles.size < 4 && canCraftChest(bot)) upsertForage(board, 'place-dump', { status: 'open', claimedBy: null })
  else {
    const dump = board.jobs.find((j) => j.id === 'place-dump')
    if (!dump) upsertForage(board, 'place-dump', { status: 'wait', claimedBy: null })
    else if (dump.status !== 'claimed') {
      dump.status = (roles.size < 4 && canCraftChest(bot)) ? 'open' : 'wait'
      dump.claimedBy = null
      dump.updated = nowIso()
    }
  }
  if (!campBuilt) upsertForage(board, 'place-camp', { status: 'open', claimedBy: null, schematic: 'camp' })
  else {
    const row = board.jobs.find((j) => j.id === 'place-camp')
    if (row && row.status !== 'done') { row.status = 'done'; row.updated = nowIso() }
    upsertForage(board, 'tend-farm', { status: jobOpen(board.jobs.find((j) => j.id === 'tend-farm')) ? 'open' : 'open', claimedBy: null })
    upsertForage(board, 'guard-camp', { status: 'open', claimedBy: null })
  }

  board.workers = ['Steve', 'Steve2', 'Steve3', 'Steve4', 'Steve5', 'Steve6']
  board.queen = 'chat+keepalive'
  const me = myName()
  if (!board.workers.map((w) => String(w).toLowerCase()).includes(me.toLowerCase())) board.workers.push(me)
  saveJobs(board)
  return board
}

export async function claimNextJob(bot, state) {
  return withLock(() => {
    const board = seedForageIfEmpty(bot, state)
    expireStaleClaims(board)
    const me = myName()
    const mine = board.jobs.find((j) => j.status === 'claimed' && String(j.claimedBy || '').toLowerCase() === me.toLowerCase())
    if (mine) {
      mine.updated = nowIso()
      saveJobs(board)
      return mine
    }
    let open = board.jobs.filter((j) => jobOpen(j)).sort((a, b) => (b.priority || 0) - (a.priority || 0))
    if (horizFromOrigin(bot) >= SPAWN_SAFE_R) open = open.filter((j) => j.id !== 'leave-spawn')
    if (!canCraftChest(bot)) open = open.filter((j) => j.id !== 'place-dump' && j.type !== 'dump')
    let job = open[0]
    if (countLogs(bot) < 2) {
      const wood = open.find((j) => j.id === 'gather-wood' || j.item === 'logs')
      if (wood) job = wood
    }
    if (!job) {
      const logs = countLogs(bot)
      const dirt = countNamed(bot, ['dirt', 'grass_block'])
      const chests = ((loadStorage().chests) || []).length
      if (logs < 8) job = { id: 'work-wood-' + me, type: 'gather', item: 'logs', count: 8, priority: 88, personal: true }
      else if (dirt < 8) job = { id: 'work-dirt-' + me, type: 'gather', item: 'dirt', count: 8, priority: 86, personal: true }
      else if (chests < 1) job = { id: 'work-dump-' + me, type: 'dump', priority: 84, personal: true }
      else job = { id: 'work-farm-' + me, type: 'farm', priority: 60, personal: true }
      board.jobs.push(job)
    }
    job.status = 'claimed'
    job.claimedBy = me
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
      if (row.id === 'tend-farm' || row.id === 'guard-camp' || row.id === 'gather-stock' || row.id === 'gather-wood' || row.id === 'place-dump') {
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
    if (job.id === 'place-dump' || job.type === 'dump') {
      if (!canCraftChest(bot)) {
        plog('jobs dump needs wood first logs=' + countLogs(bot))
        state.phase = 'wood'
        state.gatherName = 'logs'
        state.gatherCount = 8
        state.note = 'dump wait logs>=2, gather wood'
        return runGather(bot, state)
      }
      return ensureDumpChests(bot, state)
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
