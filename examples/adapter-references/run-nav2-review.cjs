#!/usr/bin/env node
'use strict';
// Synthetic local CLI examples. No ROS packages, discovery or transport are used.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const output = path.resolve(process.argv[2] || 'nav2-local-examples');
if (fs.existsSync(output)) throw new Error('Use a new output directory');
fs.mkdirSync(output, { recursive: true });
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'nav2-review-input.json'), 'utf8'));
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
save('baseline.json', baseline);
const cases = [
  ['same-input', 'MATCH', () => {}],
  ['same-limits-new-frequency', 'REVIEW_REQUIRED', v => { v.smoother.smoothing_frequency = 50; }],
  ['closed-loop-source', 'REVIEW_REQUIRED', v => {
    v.smoother.feedback = 'CLOSED_LOOP';
    v.smoother.odometry = { topic: '/odom', sourceNode: '/estimator', frame: 'odom', duration: 0.1 };
  }],
  ['selected-path-broken', 'INCOMPLETE', v => { v.topology.edges = []; }],
  ['goal-controller-substitution', 'REVIEW_REQUIRED', v => { v.goal.controller_id = v.loadedPlugins.controller_id[1].id; }],
  ['same-api-new-runtime', 'REVIEW_REQUIRED', v => { v.software[1].version = 'fixture-2'; }],
  ['volatile-only', 'MATCH', v => { v.volatile = { latestOdometry: { x: 0.23 }, temperature: 30 }; }],
];
const summaries = [];
for (const [name, expected, mutate] of cases) {
  const changed = structuredClone(baseline);
  changed.observedAt = '2026-09-10T07:01:00Z';
  mutate(changed);
  save(`${name}.json`, changed);
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../dist/apps/cli/rlsok.js'),
    'profile', 'compare-nav2', '--baseline', path.join(output, 'baseline.json'),
    '--changed', path.join(output, `${name}.json`), '--output', path.join(output, name)],
    { encoding: 'utf8', windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, expected === 'MATCH' ? 0 : expected === 'REVIEW_REQUIRED' ? 1 : 2, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(output, name, 'nav2-review.json'), 'utf8'));
  assert.equal(report.result, expected);
  assert.equal(report.hardwareDispatch, 'NO');
  assert.equal(report.createsApproval, false);
  summaries.push({ case: name, result: report.result, exitCode: result.status,
    differences: report.differences.map(d => d.group), issues: report.changed.issues,
    hardwareDispatch: report.hardwareDispatch, createsApproval: report.createsApproval });
}
const summary = { schemaVersion: 1, inputSource: 'synthetic',
  scope: 'Local supplied-input CLI comparison; no Nav2 process, real graph, customer trial or permission', cases: summaries };
save('summary.json', summary);
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
