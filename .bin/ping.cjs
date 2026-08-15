#!/usr/bin/env node
const mc = require('minecraft-protocol')
mc.ping({ host: '45.248.51.231', port: 25566 }, (err, result) => {
  if (err) {
    console.error('PING_ERROR', err && err.message ? err.message : err)
    if (err && err.stack) console.error(err.stack)
    process.exit(1)
  }
  console.log(JSON.stringify(result, null, 2))
})
