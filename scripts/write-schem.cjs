const fs = require('fs')
const path = require('path')
const { Schematic } = require('prismarine-schematic')
const dir = path.join(__dirname, '..', 'schematics')
async function one(name) {
  const json = fs.readFileSync(path.join(dir, name + '.json'), 'utf8')
  const schem = Schematic.fromJSON(json)
  if (!schem) throw new Error('fromJSON failed ' + name)
  const buf = await schem.write()
  fs.writeFileSync(path.join(dir, name + '.schem'), buf)
  const solids = (JSON.parse(json).blocks || []).filter((x) => x !== 0).length
  console.log(name, 'size', schem.size, 'solids', solids, 'schemBytes', buf.length)
}
;(async () => {
  for (const n of ['camp', 'wheat', 'trees']) await one(n)
})().catch((e) => { console.error(e); process.exit(1) })
