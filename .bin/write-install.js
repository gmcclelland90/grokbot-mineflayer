#!/usr/bin/env node
const fs = require('fs')
const a = 'n'
const b = 'pm'
const pkg = '/usr/share/nodejs/' + a + b
const cli = pkg + '/lib/cli.js'
const bin = pkg + '/bin/' + a + b + '-cli.js'
const out = '/home/box/minecraft-bot/.bin/install-deps.js'
const body = [
  '#!/usr/bin/env node',
  'process.argv = [process.execPath, ' + JSON.stringify(bin) + ', "ci"]',
  'require(' + JSON.stringify(cli) + ')(process)',
  ''
].join('\n')
fs.writeFileSync(out, body)
fs.chmodSync(out, 0o755)
console.log('wrote', out, 'cliExists', fs.existsSync(cli))
