import assert from 'node:assert/strict';
import test from 'node:test';
import fixture from '../../examples/adapter-references/nav2-review-input.json';
import { approveNav2Goal, checkNav2BeforeShadowHandoff, type Nav2Observation } from '../../packages/composable-shadow/nav2-gate';
const now = Date.parse('2026-09-10T10:00:00Z');
const h = { stamp: { sec: 0, nanosec: 0 }, frame_id: 'map' };
const goal = () => ({ controller_id: 'FollowPath', goal_checker_id: 'goal_checker', progress_checker_id: 'progress_checker',
  path: { header: h, poses: [{ header: h, pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } }] } });
const observed = (start = now): Nav2Observation => ({ schemaVersion: 1, kind: 'RlsokNav2RosObservation',
  startedAt: new Date(start).toISOString(), completedAt: new Date(start).toISOString(),
  input: { ...structuredClone(fixture), observedAt: new Date(start).toISOString() } as any,
  binding: { domain: 223, endpointGids: ['synthetic-endpoint'] }, issues: [], observationMethod: 'read-only-ros-two-pass', authenticatedTopology: false, hardwareDispatch: 'NO' });
const approved = () => approveNav2Goal(observed(), goal(), 'unit-test-only', new Date(now+60000).toISOString(), now);

test('the sink gets only a detached deeply frozen approved goal; caller and observation stay separate', async () => {
  const proposed = goal(); let handed: any;
  const r = await checkNav2BeforeShadowHandoff({ approval: approved(), goal: proposed, capture: async () => observed(), now: () => now,
    recordShadowHandoff: x => { handed = x; assert.ok(Object.isFrozen(x.path.poses[0].pose.position)); } });
  assert.equal(r.decision, 'WOULD_ALLOW'); assert.equal(r.shadowHandoffs, 1); assert.deepEqual(handed, proposed); assert.notEqual(handed, proposed);
});

test('all three per-goal selectors, path bytes, extra fields and invalid goals block before any handoff', async () => {
  for (const change of [
    (x: any) => { x.controller_id = 'Alternative'; }, (x: any) => { x.goal_checker_id = 'alternate_goal'; },
    (x: any) => { x.progress_checker_id = 'alternate_progress'; }, (x: any) => { x.path.poses[0].pose.position.x = 0.1; },
    (x: any) => { x.path_handler_id = 'not-in-jazzy'; }, (x: any) => { x.path.poses = []; }, (x: any) => { x.path.poses[0].pose.position.x = NaN; }
  ]) {
    const proposed = structuredClone(goal()); change(proposed); let handoffs = 0;
    const r = await checkNav2BeforeShadowHandoff({ approval: approved(), goal: proposed, capture: async () => observed(), now: () => now, recordShadowHandoff: () => { handoffs++; } });
    assert.equal(r.decision, 'WOULD_BLOCK'); assert.equal(handoffs, 0);
  }
});

test('live semantic/graph drift, ambiguous observation, stale or replayed reads and capture failure reject the old approval', async () => {
  for (const capture of [
    async () => { const x = observed(); x.input.smoother.smoothing_frequency = 10; return x; },
    async () => { const x = observed(); x.binding.endpointGids = ['replacement']; return x; },
    async () => { const x = observed(); x.issues.push('bypass'); return x; },
    async () => observed(now-31000), async () => observed(now-1), async () => observed(now+1),
    async () => { throw new Error('parameter_service_timeout'); }
  ]) {
    let handed = 0; const r = await checkNav2BeforeShadowHandoff({ approval: approved(), goal: goal(), capture, now: () => now, recordShadowHandoff: () => { handed++; } });
    assert.equal(r.decision, 'WOULD_BLOCK'); assert.equal(handed, 0);
  }
});

test('mutating the proposal during capture, modifying approval or expiring during capture cannot hand off', async () => {
  let handed = 0; const sink = () => { handed++; };
  const g = structuredClone(goal());
  const r = await checkNav2BeforeShadowHandoff({ approval: approved(), goal: g, capture: async () => { g.controller_id = 'Alternative'; return observed(); }, now: () => now, recordShadowHandoff: sink });
  assert.match(r.reason, /goal_changed_during_capture/);
  const a = structuredClone(approved()); a.goal.controller_id = 'Alternative';
  assert.match((await checkNav2BeforeShadowHandoff({ approval: a, goal: a.goal, capture: async () => observed(), now: () => now, recordShadowHandoff: sink })).reason, /approval_modified/);
  let clock = now;
  assert.equal((await checkNav2BeforeShadowHandoff({ approval: approved(), goal: goal(), capture: async () => { clock += 60001; return observed(clock); }, now: () => clock, recordShadowHandoff: sink })).decision, 'WOULD_BLOCK');
  assert.equal(handed, 0);
});

test('volatile velocity changes preserve approval and malformed baseline cannot be approved', async () => {
  let handed = 0;
  assert.equal((await checkNav2BeforeShadowHandoff({ approval: approved(), goal: goal(), capture: async () => { const x = observed(); x.input.volatile = { velocity_sample: [0.1, 0, 0] }; return x; }, now: () => now, recordShadowHandoff: () => { handed++; } })).decision, 'WOULD_ALLOW');
  assert.equal(handed, 1);
  const x = observed(); x.issues = ['unconfirmed_topology'];
  assert.throws(() => approveNav2Goal(x, goal(), 'test', new Date(now+1).toISOString(), now));
});

test('an unresolved read times out before the sink; a failing sink is never reported as an untouched sink', async () => {
  let handed = 0;
  const timeout = await checkNav2BeforeShadowHandoff({ approval: approved(), goal: goal(), capture: () => new Promise(() => {}),
    captureTimeoutMs: 10, now: () => now, recordShadowHandoff: () => { handed++; } });
  assert.equal(timeout.reason, 'nav2_capture_timeout'); assert.equal(handed, 0);
  const failed = await checkNav2BeforeShadowHandoff({ approval: approved(), goal: goal(), capture: async () => observed(), now: () => now,
    recordShadowHandoff: () => { handed++; throw new Error('record_failed_after_write'); } });
  assert.equal(failed.shadowHandoffs, null); assert.equal(handed, 1);
});

test('caller mutation of approval binding during capture cannot replace the reviewed configuration', async () => {
  const approval = structuredClone(approved()); let handed = 0;
  const result = await checkNav2BeforeShadowHandoff({ approval, goal: goal(), now: () => now,
    capture: async () => { approval.baseline.binding.endpointGids = ['replacement']; const x = observed(); x.binding.endpointGids = ['replacement']; return x; },
    recordShadowHandoff: () => { handed++; } });
  assert.equal(result.decision, 'WOULD_BLOCK'); assert.equal(handed, 0);
});
