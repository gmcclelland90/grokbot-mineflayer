const fs=require('fs'); const path=require('path');
const feat='/home/box/minecraft-bot/node_modules/prismarine-physics/lib/features.json';
let f=fs.readFileSync(feat,'utf8');
f=f.replace('"1.21", "26.1"]','"1.21", "26.1", "26.2"]');
fs.writeFileSync(feat,f);
const game='/home/box/minecraft-bot/node_modules/mineflayer/lib/plugins/game.js';
let g=fs.readFileSync(game,'utf8');
if(!g.includes('player_loaded')){
  g=g.replace('function inject (bot, options) {\n','function inject (bot, options) {\n  bot.once(\'spawn\', () => {\n    try { bot._client.write(\'player_loaded\', {}) } catch (err) {}\n  })\n\n');
  fs.writeFileSync(game,g);
}
const time='/home/box/minecraft-bot/node_modules/mineflayer/lib/plugins/time.js';
fs.writeFileSync(time, );
const ent='/home/box/minecraft-bot/node_modules/mineflayer/lib/plugins/entities.js';
let e=fs.readFileSync(ent,'utf8');
if(!e.includes('attackUsesOwnPacket')){
  e=e.replace('  function attack (target, swing = true) {\n    // arm animation comes before the use_entity packet on 1.8\n','  function attack (target, swing = true) {\n    if (bot.supportFeature(\'attackUsesOwnPacket\')) {\n      if (swing) {\n        swingArm()\n      }\n      bot._client.write(\'attack\', { entityId: target.id })\n      return\n    }\n    // arm animation comes before the use_entity packet on 1.8\n');
  e=e.replace('  function useEntity (target, leftClick, x, y, z) {\n    const sneaking = bot.getControlState(\'sneak\')\n    if (x && y && z) {\n','  function useEntity (target, leftClick, x, y, z) {\n    const sneaking = bot.getControlState(\'sneak\')\n    if (bot.supportFeature(\'attackUsesOwnPacket\')) {\n      const hand = 0\n      const location = (x !== undefined && y !== undefined && z !== undefined)\n        ? { x, y, z }\n        : { x: 0, y: 0, z: 0 }\n      bot._client.write(\'use_entity\', {\n        target: target.id,\n        hand,\n        location,\n        sneaking\n      })\n      return\n    }\n    if (x && y && z) {\n');
  fs.writeFileSync(ent,e);
}
fs.writeFileSync('/home/box/minecraft-bot/config.json', JSON.stringify({host:'45.248.51.231',port:25566,username:'Steve',auth:'offline',version:'26.2'},null,2)+'\n');
console.log('patched physics 26.2', fs.readFileSync(feat,'utf8').includes('26.2'));
console.log('patched player_loaded', fs.readFileSync(game,'utf8').includes('player_loaded'));
console.log('patched clockUpdates', fs.readFileSync(time,'utf8').includes('clockUpdates'));
console.log('patched attackUsesOwnPacket', fs.readFileSync(ent,'utf8').includes('attackUsesOwnPacket'));
console.log('config', fs.readFileSync('/home/box/minecraft-bot/config.json','utf8'));

