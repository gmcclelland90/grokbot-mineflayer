/** Validate rl/matrix.json: shape, unique ids, deps exist, no cycles, current is a skill. */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATUSES = new Set(['todo', 'doing', 'done'])

function fail(msg) {
  console.error('matrix FAIL: ' + msg)
  process.exit(1)
}

const raw = fs.readFileSync(path.join(__dirname, 'matrix.json'), 'utf8')
let matrix
try {
  matrix = JSON.parse(raw)
} catch (err) {
  fail('invalid JSON: ' + err.message)
}

if (!matrix || typeof matrix !== 'object') fail('root must be an object')
if (typeof matrix.current !== 'string' || !matrix.current) fail('current must be a non-empty string')
if (!Array.isArray(matrix.skills) || matrix.skills.length === 0) fail('skills must be a non-empty array')

const ids = new Set()
for (const s of matrix.skills) {
  if (!s || typeof s !== 'object') fail('skill must be an object')
  if (typeof s.id !== 'string' || !s.id) fail('skill missing id')
  if (ids.has(s.id)) fail('duplicate skill id ' + s.id)
  ids.add(s.id)
  if (typeof s.name !== 'string' || !s.name) fail(s.id + ' missing name')
  if (!STATUSES.has(s.status)) fail(s.id + ' bad status ' + s.status)
  if (!Array.isArray(s.deps)) fail(s.id + ' deps must be an array')
}

if (!ids.has(matrix.current)) fail('current ' + matrix.current + ' is not a skill id')

const adj = new Map()
for (const s of matrix.skills) {
  const deps = []
  for (const d of s.deps) {
    if (typeof d !== 'string' || !d) fail(s.id + ' empty dep')
    if (d === s.id) fail(s.id + ' depends on itself')
    if (!ids.has(d)) fail(s.id + ' unknown dep ' + d)
    deps.push(d)
  }
  adj.set(s.id, deps)
}

const WHITE = 0
const GRAY = 1
const BLACK = 2
const color = new Map([...ids].map((id) => [id, WHITE]))

function visit(id, stack) {
  color.set(id, GRAY)
  stack.push(id)
  for (const d of adj.get(id) || []) {
    const c = color.get(d)
    if (c === GRAY) fail('cycle: ' + stack.concat(d).join(' -> '))
    if (c === WHITE) visit(d, stack)
  }
  stack.pop()
  color.set(id, BLACK)
}

for (const id of ids) {
  if (color.get(id) === WHITE) visit(id, [])
}

console.log('matrix OK: ' + ids.size + ' skills, current=' + matrix.current)
