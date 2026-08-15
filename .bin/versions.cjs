#!/usr/bin/env node
const path = require('path')
const fs = require('fs')
const mf = require('mineflayer/package.json')
const mcp = require('minecraft-protocol/package.json')
let supported = []
try {
  const p = require.resolve('minecraft-data/minecraft-data/data/pc/common/protocolVersions.json')
  const data = JSON.parse(fs.readFileSync(p, 'utf8'))
  supported = data.slice(0, 15).map(v => ({ version: v.minecraftVersion, protocol: v.version }))
} catch (e) {
  console.error('protocolVersions', e.message)
}
try {
  const { supportedVersions } = require('minecraft-protocol')
  console.log('mcp.supportedVersions', supportedVersions && supportedVersions.slice(-20))
} catch (e) {
  console.error('supportedVersions', e.message)
}
console.log(JSON.stringify({ mineflayer: mf.version, protocol: mcp.version, recent: supported }, null, 2))
