// Focused verification for a disposable native Mac runner only.
// This does not install macOS, accept a license, contact the cloud or dispatch a robot.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

assert.equal(process.platform, 'darwin', 'Run only in the disposable macOS runner.');
assert.notEqual(process.getuid(), 0, 'Use a normal Mac account.');
assert.equal(process.argv[2], '--verify-disposable-macos');
const resources = process.argv[3];
assert.ok(resources && isAbsolute(resources));
assert.equal(resolve(process.execPath), resolve(resources, 'bin/node'), 'Use the installed bundled Node.');
const manifest = JSON.parse(await readFile(join(resources, 'BUILD-MANIFEST.json'), 'utf8'));
assert.equal(manifest.arch, process.arch);
assert.equal(manifest.version, '1.3.2');
const state = join(homedir(), 'Library', 'Application Support', 'RLSOK');
const runId = randomUUID();
const reportPath = join(state, `installer-verification-${runId}.json`);
const report = { status: 'RUNNING', arch: process.arch, node: process.version,
  packagingSourceCommit: manifest.packagingSourceCommit, cloudSourceCommit: manifest.cloudSourceCommit,
  checks: [], scope: 'Installed local workspace native dependencies, account-free API access, own file and restart persistence. GUI, pkg install and removal require separate evidence.' };
function run(executable, args) {
  const child = spawnSync(executable, args, { encoding: 'utf8', timeout: 240_000 });
  assert.ok(!child.error && child.status === 0, `Local command failed: ${executable.split('/').pop()}; inspect private startup logs.`);
  return child.stdout;
}
function launcher(action) { return run(process.execPath, [join(resources, 'desktop.mjs'), action]); }
async function checkedFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok, `Unexpected HTTP ${response.status} at ${new URL(url).pathname}`);
  return response;
}
const sha = content => createHash('sha256').update(content).digest('hex');
try {
  launcher('start');
  report.checks.push('bundled_native_node_and_database_start');
  const require = createRequire(join(resources, 'server/web/apps/web/package.json'));
  const sharp = require('sharp');
  const rendered = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } }).png().toBuffer();
  assert.equal((await sharp(rendered).metadata()).format, 'png');
  report.checks.push('bundled_native_sharp_executes');
  const cli = join(resources, 'local-check/bin/rlsok');
  assert.match(run(cli, ['--help']), /rlsok/i);
  report.checks.push('bundled_local_check_launcher_executes');
  const example = join(state, `native-example-${runId}`);
  run(cli, ['profile', 'demo', '--output', example]);
  const baseline = JSON.parse(await readFile(join(example, 'baseline/report.json'), 'utf8'));
  assert.equal(baseline.decision, 'WOULD_ALLOW');
  const ownObservation = JSON.parse(await readFile(join(example, 'fixture-observation.json'), 'utf8'));
  ownObservation.facts.find(fact => fact.id === 'calibration').value = 'a'.repeat(64);
  const ownObservationPath = join(state, `my-observation-${runId}.json`);
  await writeFile(ownObservationPath, JSON.stringify(ownObservation), { mode: 0o600, flag: 'wx' });
  const ownResult = join(state, `my-result-${runId}`);
  const check = spawnSync(cli, ['profile', 'shadow', '--profile', join(example, 'profile.json'), '--approval', join(example, 'fixture-approval.json'),
    '--observation', ownObservationPath, '--proposals', join(example, 'proposals.json'), '--output', ownResult], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(check.status, 2, 'A changed selected calibration must be blocked.');
  const ownReport = JSON.parse(await readFile(join(ownResult, 'report.json'), 'utf8'));
  assert.equal(ownReport.decision, 'WOULD_BLOCK');
  assert.match(JSON.stringify(ownReport), /fact_mismatch:calibration/);
  report.checks.push('native_local_check_example_and_separate_selected_file');

  const local = await checkedFetch('http://localhost:3000/api/auth/local', {
    method: 'POST', headers: { Origin: 'http://localhost:3000', 'x-rlsok-local-open': '1' }
  });
  assert.equal((await local.json()).next, '/dashboard');
  const cookieHeader = local.headers.getSetCookie().find(value => value.startsWith('rlsok_session='));
  assert.ok(cookieHeader, 'Local session cookie missing.');
  const cookie = cookieHeader.split(';')[0];
  const token = cookie.slice('rlsok_session='.length);
  assert.match(token, /^rlsok_session_[A-Za-z0-9_-]{43}$/);
  const headers = { Authorization: `Bearer ${token}`, 'x-rlsok-contract-version': 'rlsok-cloud/v1' };
  const principal = await (await checkedFetch('http://127.0.0.1:8080/v1/auth/me', { headers })).json();
  assert.equal(principal.role, 'administrator');
  report.checks.push('account_free_complete_local_identity');
  const rejected = await fetch('http://localhost:3000/api/auth/local', {
    method: 'POST', headers: { Origin: 'https://unrelated.example', 'x-rlsok-local-open': '1' }, signal: AbortSignal.timeout(10_000)
  });
  assert.equal(rejected.status, 403);
  report.checks.push('cross_origin_local_access_rejected');

  const ownData = Buffer.from(JSON.stringify({ purpose: 'Mac local own-file verification', runId, robotDispatch: false }));
  const ownHash = sha(ownData);
  const saved = await (await checkedFetch('http://127.0.0.1:8080/v1/artifacts', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `my-local-settings-${runId}.json`, mediaType: 'application/json', declaredSha256: ownHash, contentBase64: ownData.toString('base64') })
  })).json();
  assert.ok(saved.id);
  assert.equal(saved.sha256, ownHash);
  report.checks.push('own_file_saved');
  const configHash = sha(await readFile(join(state, 'desktop.json')));
  launcher('stop');
  assert.deepEqual(JSON.parse(launcher('status')), { api: false, web: false, database: false });
  report.checks.push('owned_services_stop');
  launcher('start');
  assert.equal(sha(await readFile(join(state, 'desktop.json'))), configHash);
  const retained = await (await checkedFetch('http://127.0.0.1:8080/v1/auth/me', { headers })).json();
  assert.equal(retained.id, principal.id);
  const files = await (await checkedFetch('http://127.0.0.1:8080/v1/artifacts', { headers })).json();
  assert.ok(files.artifacts.some(file => file.id === saved.id && file.sha256 === ownHash));
  const dashboard = await checkedFetch('http://localhost:3000/dashboard', { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /RLSOK on this computer/);
  report.checks.push('restart_preserves_own_file_session_config_and_dashboard');
  // Keep only non-secret identities for the independent package reinstall check.
  await writeFile(join(state, 'installer-preservation.json'), JSON.stringify({ id: saved.id, sha256: ownHash, configHash }) + '\n', { mode: 0o600, flag: 'wx' });
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failedCheck = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(`${report.status}: ${reportPath}\n`);
}
