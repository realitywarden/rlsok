'use strict';
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { homedir } = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

try {
  if (process.platform !== 'win32') throw new Error('Use the Windows download on Windows 10 or 11.');
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--no-open')) throw new Error('Double-click Run example.cmd to start.');
  const root = resolve(__dirname, '..');
  const parent = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'), 'RLSOK', 'Local Check', 'Reports');
  fs.mkdirSync(parent, { recursive: true });
  const output = fs.mkdtempSync(join(parent, 'Example-'));
  const reports = join(output, 'results');
  console.log('RLSOK Local Check: running the included example...');
  const result = spawnSync(process.execPath, [join(root, 'lib/rlsok/dist/apps/cli/rlsok.js'), 'profile', 'demo', '--output', reports], {
    encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  fs.writeFileSync(join(output, 'example.log'), `${result.stdout || ''}\n${result.stderr || ''}`, { flag: 'wx' });
  if (result.error || result.status !== 0) throw new Error(`The example could not finish. Details: ${join(output, 'example.log')}`);
  const baseline = JSON.parse(fs.readFileSync(join(reports, 'baseline/report.json'), 'utf8'));
  const changed = JSON.parse(fs.readFileSync(join(reports, 'changed-calibration/report.json'), 'utf8'));
  if (baseline.decision !== 'WOULD_ALLOW' || changed.decision !== 'WOULD_BLOCK') throw new Error(`Unexpected example result. Keep the reports in ${output} for support.`);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const guide = pathToFileURL(join(root, 'START-HERE.html')).href;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your first RLSOK result</title>
<style>body{font:17px/1.6 system-ui,sans-serif;color:#172333;background:#f2f5f9;margin:0;padding:40px 20px}main{max-width:780px;margin:auto}h1{font-size:36px;line-height:1.2}article{background:white;border:1px solid #d7dfe9;border-radius:14px;padding:24px;margin:20px 0}h2{margin-top:0}a{color:#174b9d}small{color:#465569}.label{font-weight:700;color:#345578}.ok{border-left:5px solid #278052}.changed{border-left:5px solid #b7781d}code{overflow-wrap:anywhere}</style>
<main><p class="label">RLSOK LOCAL CHECK ${escape(fs.readFileSync(join(root, 'VERSION'), 'utf8').trim())}</p><h1>Your first check is complete</h1><p>The example compared a reviewed setup with a copy containing a changed calibration.</p>
<article class="ok"><h2>1. Original settings match</h2><p>The example setup matches the reviewed copy.</p><a href="results/baseline/report.md">Read the matching report</a> · <a href="results/baseline/report.json">JSON</a></article>
<article class="changed"><h2>2. Changed calibration detected</h2><p>The second copy uses different calibration data. RLSOK flagged the change for review.</p><a href="results/changed-calibration/report.md">Read the changed report</a> · <a href="results/changed-calibration/report.json">JSON</a></article>
<p>This used included example files. It did not connect to a robot or send commands. A matching report is not permission to operate a real robot.</p><p><a href="${escape(guide)}">Next: check your own saved files</a></p><small>Reports stay on this computer: <code>${escape(output)}</code>. No account or upload was used.</small></main></html>`;
  const page = join(output, 'index.html');
  fs.writeFileSync(page, html, { flag: 'wx' });
  console.log(`Example complete. Matching settings and changed calibration both checked.\n${page}`);
  if (!args.includes('--no-open')) {
    const browser = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [page], { detached: true, stdio: 'ignore', windowsHide: true });
    browser.on('error', () => console.error(`Open this file to see your result: ${page}`));
    browser.unref();
  }
} catch (error) {
  console.error(`RLSOK: ${error.message}`);
  process.exitCode = 1;
}
