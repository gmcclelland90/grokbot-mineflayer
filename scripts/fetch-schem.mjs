#!/usr/bin/env node
// Download a direct Sponge/WorldEdit .schem URL into schematics/<name>.schem
// Usage: node scripts/fetch-schem.mjs <url> <name>
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { Schematic } = require('prismarine-schematic')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'schematics')

function usage() {
  console.error('usage: node scripts/fetch-schem.mjs <https://...schem> <name>')
  process.exit(2)
}

const url = process.argv[2]
const name = String(process.argv[3] || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
if (!url || !name) usage()
if (!/^https?:\/\//i.test(url)) {
  console.error('url must be http(s)')
  process.exit(2)
}

const dest = path.join(OUT, name + '.schem')

const res = await fetch(url, { redirect: 'follow' })
if (!res.ok) {
  console.error('fetch fail ' + res.status + ' ' + res.statusText)
  process.exit(1)
}
const ctype = String(res.headers.get('content-type') || '')
const buf = Buffer.from(await res.arrayBuffer())
if (buf.length < 16) {
  console.error('too small, not a schematic')
  process.exit(1)
}
if (ctype.includes('text/html') || buf.slice(0, 20).toString('utf8').includes('<html')) {
  console.error('got HTML, not a schematic')
  process.exit(1)
}
const gzip = buf[0] === 0x1f && buf[1] === 0x8b
const nbt = buf[0] === 0x0a
if (!gzip && !nbt) {
  console.error('not gzip/nbt schematic magic')
  process.exit(1)
}
let schem
try {
  schem = await Schematic.read(buf)
} catch (err) {
  console.error('prismarine-schematic read fail: ' + (err && err.message))
  process.exit(1)
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(dest, buf)
let solids = 0
try {
  await schem.forEach((block) => {
    const n = String((block && block.name) || '')
    if (n && n !== 'air' && n !== 'cave_air' && n !== 'void_air') solids++
  })
} catch {}
console.log('saved ' + dest)
console.log('size ' + schem.size.x + 'x' + schem.size.y + 'x' + schem.size.z + ' solids=' + solids + ' bytes=' + buf.length)
if (solids > 200) console.log('note: over 200 solids — Steve may not finish this in survival')
