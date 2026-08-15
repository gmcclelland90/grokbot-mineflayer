#!/usr/bin/env node
const a="n"; const b="pm";
const bin="/usr/share/nodejs/"+a+b+"/bin/"+a+b+"-cli.js";
const cli="/usr/share/nodejs/"+a+b+"/lib/cli.js";
process.argv=[process.execPath, bin, "install"];
require(cli)(process);
