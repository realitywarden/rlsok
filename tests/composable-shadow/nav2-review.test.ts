import assert from 'node:assert/strict';
import test from 'node:test';
import fixture from '../../examples/adapter-references/nav2-review-input.json';
import { compareNav2ReviewInputs } from '../../packages/composable-shadow/nav2-review';

const copy = (): any => structuredClone(fixture);
const compare = (a: unknown, b: unknown) => compareNav2ReviewInputs(a, b);

test('same-limit semantics, software and exact action binding changes require review', () => {
  const changes = [
    (x: any) => { x.smoother.smoothing_frequency = 10; },
    (x: any) => { x.smoother.scale_velocities = true; },
    (x: any) => { x.smoother.feedback = 'CLOSED_LOOP'; },
    (x: any) => { x.smoother.velocity_timeout = 2; },
    (x: any) => { x.smoother.deadband_velocity[0] = 0.1; },
    (x: any) => { x.smoother.stamp_smoothed_velocity_with_smoothing_time = true; },
    (x: any) => { x.software[1].version = 'fixture-2'; },
    (x: any) => { x.actionEndpoint = '/another_follow_path'; }
  ];
  for (const change of changes) {
    const a = copy(), b = copy(); change(b);
    assert.deepEqual(a.smoother.max_velocity, b.smoother.max_velocity);
    const r = compare(a, b); assert.equal(r.result, 'REVIEW_REQUIRED');
    assert.notEqual(r.baseline.configurationSha256, r.changed.configurationSha256);
    assert.equal(r.hardwareDispatch, 'NO'); assert.equal(r.createsApproval, false);
  }
});

test('closed-loop source matters; volatile samples, open-loop odometry and unconsumed scheduling do not', () => {
  const a = copy(), b = copy(); b.volatile.velocity_sample = [0.2, 0, 0.3];
  b.smoother.odometry.topic = '/different_odom'; b.smoother.use_realtime_priority = true;
  b.diagnostics.extra = 'unrelated node'; assert.equal(compare(a, b).result, 'MATCH');
  for (const [key, value] of [['topic', '/other'], ['sourceNode', '/other_source'], ['frame', 'other_frame'], ['duration', 0.2]]) {
    const c = copy(), d = copy(); c.smoother.feedback = d.smoother.feedback = 'CLOSED_LOOP';
    d.smoother.odometry[key] = value; assert.equal(compare(c, d).result, 'REVIEW_REQUIRED');
  }
  b.smoother.feedback = 'CLOSED_LOOP'; delete b.smoother.odometry;
  assert.equal(compare(a, b).result, 'INCOMPLETE');
});

test('live-looking node names do not substitute for a complete unambiguous selected path', () => {
  for (const corrupt of [
    (x: any) => { x.topology.selectedPathComplete = false; },
    (x: any) => { x.topology.edges.pop(); },
    (x: any) => { x.topology.edges[1].selectedPublisherCount = 0; },
    (x: any) => { x.topology.edges[1].otherPublisherCount = 1; },
    (x: any) => { x.topology.stages[2].inputTopic = '/bypass'; },
    (x: any) => { x.topology.edges.push({ ...x.topology.edges[1], publisher: '/bypass_node' }); }
  ]) { const b = copy(); corrupt(b); assert.equal(compare(copy(), b).result, 'INCOMPLETE'); }
  const b = copy(); b.topology.stages[1].version = 'changed-smoother';
  assert.equal(compare(copy(), b).result, 'REVIEW_REQUIRED');
});

test('per-goal selectors and goal bytes remain separate from unchanged configuration', () => {
  for (const key of ['controller_id', 'goal_checker_id', 'progress_checker_id']) {
    const a = copy(), b = copy(); b.goal[key] = b.loadedPlugins[key][1].id;
    const r = compare(a, b); assert.equal(r.result, 'REVIEW_REQUIRED');
    assert.equal(r.baseline.configurationSha256, r.changed.configurationSha256);
    assert.notEqual(r.baseline.commandSha256, r.changed.commandSha256);
    assert.ok(r.differences.some(d => d.group === 'goalSelectors'));
    b.goal[key] = ''; assert.equal(compare(a, b).result, 'INCOMPLETE');
    a.loadedPlugins[key].pop(); b.loadedPlugins[key].pop(); assert.equal(compare(a, b).result, 'MATCH');
  }
  const a = copy(), b = copy(); b.goal.path.header.frame_id = 'another_map';
  assert.equal(compare(a, b).result, 'REVIEW_REQUIRED');
  assert.equal(compare(a, b).baseline.configurationSha256, compare(a, b).changed.configurationSha256);
  b.goal.path_handler_id = 'not-in-jazzy'; assert.throws(() => compare(a, b));
});

test('malformed, non-finite, reversed-time and duplicate inputs cannot produce MATCH', () => {
  const a = copy(), original = JSON.stringify(a);
  assert.equal(compare(a, a).result, 'MATCH'); assert.equal(JSON.stringify(a), original);
  for (const corrupt of [
    (x: any) => { x.smoother.smoothing_frequency = NaN; },
    (x: any) => { x.goal.path.bad = Infinity; },
    (x: any) => { x.distribution = 'rolling'; },
    (x: any) => { x.observedAt = '2020-01-01T00:00:00Z'; }
  ]) { const b = copy(); corrupt(b); assert.throws(() => compare(a, b)); }
  const b = copy(); b.loadedPlugins.controller_id.push(b.loadedPlugins.controller_id[0]);
  assert.equal(compare(a, b).result, 'INCOMPLETE');
});
