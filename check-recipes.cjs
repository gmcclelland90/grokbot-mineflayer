const md = require('minecraft-data')('26.2')
const names = ['sand', 'sandstone', 'red_sand', 'red_sandstone', 'dirt', 'oak_log', 'cobblestone', 'crafting_table', 'oak_planks', 'cut_sandstone']
for (const n of names) {
  const b = md.blocksByName[n]
  const i = md.itemsByName[n]
  console.log(n, 'block', b && b.id, 'item', i && i.id)
}
const sid = md.itemsByName.sandstone && md.itemsByName.sandstone.id
console.log('sandstone id', sid)
console.log('sandstone recipes', JSON.stringify((md.recipes || {})[sid], null, 2))
console.log('recipe count', Object.keys(md.recipes || {}).length)
const sandItem = md.itemsByName.sand
console.log('sand item', sandItem)
