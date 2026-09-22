'use strict';
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const args = process.argv.slice(2);
if (!args.length || ['--help', '-h', 'help'].includes(args[0])) args.splice(0, args.length, 'profile', 'help');
if (!['profile', 'setup-assistant', 'verify-evidence', '--version', '-V', 'version'].includes(args[0])) {
  console.error('Use setup-assistant, profile commands, or verify-evidence.');
  process.exit(2);
}
const result = spawnSync(process.execPath, [join(__dirname, '../lib/rlsok/dist/apps/cli/rlsok.js'), ...args], { stdio: 'inherit', windowsHide: true });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
