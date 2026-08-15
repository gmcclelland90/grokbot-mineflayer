#!/usr/bin/env node
const https = require('https')
function get(name) {
  return new Promise((resolve, reject) => {
    https.get('https://registry.npmjs.org/' + name, { headers: { accept: 'application/json' } }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try {
          const j = JSON.parse(d)
          resolve({ name, latest: j['dist-tags'] && j['dist-tags'].latest, versions: Object.keys(j.versions || {}).slice(-8) })
        } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}
Promise.all(['mineflayer', 'minecraft-protocol', 'minecraft-data'].map(get)).then(r => {
  console.log(JSON.stringify(r, null, 2))
}).catch(e => { console.error(e); process.exit(1) })
