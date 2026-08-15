#!/usr/bin/env node
process.argv = [process.execPath, "/usr/share/nodejs/npm/bin/npm-cli.js", "ci"]
require("/usr/share/nodejs/npm/lib/cli.js")(process)
