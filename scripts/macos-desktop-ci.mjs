import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

assert.equal(process.platform, 'darwin');
const [action, resources] = process.argv.slice(2);
const evidence = process.env.RLSOK_CI_EVIDENCE;
assert.ok(evidence && resources);
const state = join(homedir(), 'Library', 'Application Support', 'RLSOK');
const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });

if (action === 'preserved') {
  const expected = JSON.parse(await readFile(join(state, 'installer-preservation.json'), 'utf8'));
  assert.equal(createHash('sha256').update(await readFile(join(state, 'desktop.json'))).digest('hex'), expected.configHash);
  const opened = await request('http://localhost:3000/api/auth/local', { method: 'POST', headers: { Origin: 'http://localhost:3000', 'x-rlsok-local-open': '1' } });
  assert.equal(opened.status, 200);
  const cookie = opened.headers.getSetCookie().find(value => value.startsWith('rlsok_session='));
  assert.ok(cookie);
  const token = cookie.split(';')[0].slice('rlsok_session='.length);
  const response = await request('http://127.0.0.1:8080/v1/artifacts', { headers: { Authorization: `Bearer ${token}`, 'x-rlsok-contract-version': 'rlsok-cloud/v1' } });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).artifacts.some(file => file.id === expected.id && file.sha256 === expected.sha256));
  await writeFile(join(evidence, 'reinstall-preservation.txt'), 'PASS: own file and private configuration retained after native pkg reinstall.\n');
} else if (action === 'browser') {
  // Chrome is supplied by the standard Mac runner. A fresh profile supplies no credentials.
  const output = [];
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${join(process.env.RUNNER_TEMP, 'rlsok-clean-browser')}`,
    '--virtual-time-budget=15000', '--timeout=30000', '--dump-dom',
    `--screenshot=${join(evidence, 'local-workspace.png')}`, '--window-size=1280,900',
    'http://localhost:3000/local-start'
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  chrome.stdout.on('data', chunk => output.push(chunk));
  const timer = setTimeout(() => chrome.kill('SIGTERM'), 60_000);
  const code = await new Promise((resolve, reject) => { chrome.once('error', reject); chrome.once('exit', resolve); }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, 'Chrome did not complete the local workspace check.');
  const html = Buffer.concat(output).toString('utf8');
  assert.match(html, /RLSOK on this computer/);
  assert.doesNotMatch(html, /Checking this computer/);
  await writeFile(join(evidence, 'browser.txt'), 'PASS: clean native Mac browser reached the local dashboard without entered credentials.\n');
} else {
  throw new Error('Unknown focused verification stage.');
}
