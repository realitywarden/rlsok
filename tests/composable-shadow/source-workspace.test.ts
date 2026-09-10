import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { prepareSourceWorkspace, refreshSourceWorkspace } from '../../packages/composable-shadow/source-workspace';
import { sourceRecipes } from '../../packages/composable-shadow/source-recipes';
import { approveProfile, evaluateProfile } from '../../packages/composable-shadow';
import type { Connection } from '../../packages/composable-shadow/onboarding';
import { topicConnection } from './topic-fixture';

const now = new Date('2026-09-08T08:00:00Z');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (v: any): string => Array.isArray(v) ? `[${v.map(canonical)}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`)}}` : JSON.stringify(v);
function fixture(recipeId: string) {
  const root = mkdtempSync(join(tmpdir(), 'rlsok-source-')), source = join(root, 'checkout'), recipe = sourceRecipes[recipeId];
  for (const path of recipe.files) { mkdirSync(dirname(join(source, path)), { recursive: true }); writeFileSync(join(source, path), `synthetic ${path}\n`); }
  const base = topicConnection(recipe.interfaceType.endsWith('TwistStamped'));
  let goal: unknown = base.proposals.proposals[0].goal;
  if (recipe.joints) {
    // Deliberately synthetic type tree for testing mapping, not installed ROS evidence.
    const msg = (name: string) => ({ kind: 'message', name });
    const field = (name: string, type: any) => ({ name, type });
    const seq = (element: any) => ({ kind: 'sequence', element, maximumSize: null });
    const tree: any = { algorithm: 'rosidl-action-fields-tree/v1', actionType: recipe.interfaceType,
      components: { Goal: msg('Goal'), Result: msg('Empty'), Feedback: msg('Empty') }, definitions: {
        Goal: { fields: [field('trajectory', msg('Trajectory'))] }, Empty: { fields: [] },
        Trajectory: { fields: [field('joint_names', seq({ kind: 'string', maximumSize: null })), field('points', seq(msg('Point')))] },
        Point: { fields: [field('positions', seq({ kind: 'primitive', name: 'double' })), field('time_from_start', msg('Duration'))] },
        Duration: { fields: [field('sec', { kind: 'primitive', name: 'int32' }), field('nanosec', { kind: 'primitive', name: 'uint32' })] }
      } };
    base.catalog.topics = [];
    base.catalog.actions = [{ endpoint: recipe.endpoint, actionType: recipe.interfaceType, serverCount: 1,
      interfaceSha256: hash(canonical(tree)), typeTree: tree }];
    goal = { trajectory: { joint_names: recipe.joints, points: [{ positions: recipe.joints.map(() => 0), time_from_start: { sec: 1, nanosec: 0 } }] } };
  } else {
    base.catalog.topics![0].endpoint = recipe.endpoint;
    base.catalog.topics![0].subscribers[0] = { name: recipe.subscriber ?? 'ros_gz_bridge', namespace: '/', count: 1 };
  }
  const save = (name: string, v: unknown) => { const p = join(root, name); writeFileSync(p, JSON.stringify(v)); return p; };
  const urdf = join(root, 'robot.urdf'); writeFileSync(urdf, '<robot name="synthetic"><link name="base_link"/></robot>');
  let controllerState: string | undefined;
  if (recipe.controllerState) {
    const spec = recipe.controllerState;
    const configuration = { schemaVersion: 1, source: { controllerManager: '/controller_manager', controllerName: spec.name,
      controllerNode: `/${spec.name}`, environment: base.catalog.environment },
      controller: { name: spec.name, state: 'active', type: spec.type, claimed_interfaces: spec.claimedInterfaces },
      actionServers: spec.actionEndpoint ? [{ endpoint: spec.actionEndpoint, type: 'control_msgs/action/FollowJointTrajectory' }] : [],
      parameters: Object.fromEntries(Object.entries(spec.parameters).map(([name, value]) => [name, { type: 9, value }])) };
    controllerState = save('controller-state.json', { schemaVersion: 1, kind: 'RlsokRosControllerState', observedAt: new Date().toISOString(),
      configuration, configurationSha256: hash(canonical(configuration)) });
  }
  const input = { recipe: recipeId, source, urdf, catalog: save('catalog.json', base.catalog), settings: save('settings.json', { synthetic: true, launchArguments: {} }),
    controllerState,
    example: save('example.json', goal), deviceId: 'synthetic-isolated', output: join(root, 'workspace'),
    frame: recipe.joints ? undefined : 'base_link', subscriber: recipeId === 'rover-gazebo' ? '/ros_gz_bridge' : undefined };
  return { root, input, save };
}
function observation(workspace: string, connection: Connection): any {
  const path = connection.profile.paths[0];
  return { schemaVersion: 1, profileId: connection.profile.id, collector: 'fixture/v1', observedAt: now.toISOString(), environment: connection.catalog.environment,
    facts: connection.profile.facts.map(f => ({ id: f.id, kind: f.kind, value: f.kind === 'json_value'
      ? JSON.parse(readFileSync(join(workspace, f.path), 'utf8')).configurationSha256 : hash(readFileSync(join(workspace, f.path))), observedAt: now.toISOString() })),
    paths: [path.adapter === 'topic_twist' ? { id: path.id, endpoint: path.endpoint, interfaceSha256: path.interfaceSha256, messageType: path.messageType, subscriber: path.subscriber, subscriberCount: 1 }
      : { id: path.id, endpoint: path.endpoint, interfaceSha256: path.interfaceSha256, actionType: path.actionType, serverCount: 1 }] };
}

test('all source mappings refresh changed files without rewriting approval, profile or example', async () => {
  for (const recipe of Object.keys(sourceRecipes)) {
    const { input } = fixture(recipe);
    const workspace = await prepareSourceWorkspace(input);
    const connection: Connection = JSON.parse(readFileSync(join(workspace, 'connection.json'), 'utf8'));
    const approval = approveProfile(connection.profile, 'synthetic-reviewer', new Date(now.getTime() + 3600000).toISOString(), now);
    writeFileSync(join(workspace, 'approval.json'), JSON.stringify(approval));
    const preserved = ['profile.json', 'connection.json', 'proposals.json', 'approval.json'].map(p => readFileSync(join(workspace, p), 'utf8'));
    const evaluate = () => evaluateProfile({ ...connection, observation: observation(workspace, connection), approval, now });
    assert.equal((await evaluate()).decision, 'WOULD_ALLOW');
    writeFileSync(join(input.source, sourceRecipes[recipe].files[0]), 'synthetic changed controller/configuration');
    await refreshSourceWorkspace({ ...input, workspace });
    const changed = await evaluate();
    assert.equal(changed.decision, 'WOULD_BLOCK');
    assert.equal(changed.hardwareSignalSent, false);
    assert.ok(changed.results[0].checks.some(c => c.reason === `fact_mismatch:${connection.profile.facts[0].id}`));
    assert.deepEqual(['profile.json', 'connection.json', 'proposals.json', 'approval.json'].map(p => readFileSync(join(workspace, p), 'utf8')), preserved);
  }
});

test('receiver ambiguity, wrong node, missing frame and unspecified bridge fail before output', async () => {
  for (const issue of ['ambiguous', 'logger', 'frame', 'bridge']) {
    const { input, save } = fixture(issue === 'bridge' ? 'rover-gazebo' : 'lely-velocity');
    if (issue === 'ambiguous') { const c = JSON.parse(readFileSync(input.catalog, 'utf8')); c.topics[0].subscribers[0].count = 2; save('catalog.json', c); }
    if (issue === 'logger') input.subscriber = '/logger';
    if (issue === 'frame') input.frame = undefined;
    if (issue === 'bridge') input.subscriber = undefined;
    await assert.rejects(prepareSourceWorkspace(input));
    assert.equal(existsSync(input.output), false);
  }
});

test('missing source during refresh leaves copies intact; changed profile requires a new review', async () => {
  const { input } = fixture('hexapod-gait'), workspace = await prepareSourceWorkspace(input);
  const first = sourceRecipes[input.recipe].files[0], last = sourceRecipes[input.recipe].files.at(-1)!;
  const before = readFileSync(join(workspace, 'files/source', first), 'utf8');
  writeFileSync(join(input.source, first), 'changed'); unlinkSync(join(input.source, last));
  await assert.rejects(refreshSourceWorkspace({ ...input, workspace }));
  assert.equal(readFileSync(join(workspace, 'files/source', first), 'utf8'), before);
  const profile = JSON.parse(readFileSync(join(workspace, 'profile.json'), 'utf8')); profile.robot.model = 'changed';
  writeFileSync(join(workspace, 'profile.json'), JSON.stringify(profile));
  await assert.rejects(refreshSourceWorkspace({ ...input, workspace }), /profile_changed/);
});

test('SO-101 mapping rejects an example with a different joint order', async () => {
  const { input, save } = fixture('so101-arm');
  const goal = JSON.parse(readFileSync(input.example, 'utf8')); goal.trajectory.joint_names.reverse(); save('example.json', goal);
  await assert.rejects(prepareSourceWorkspace(input), /joint/);
  assert.equal(existsSync(input.output), false);
});

test('source baseline requires active matching controller; refresh records changed live binding against original approval', async () => {
  const { input, save } = fixture('so101-arm');
  const original = JSON.parse(readFileSync(input.controllerState!, 'utf8'));
  for (const defect of ['missing', 'inactive', 'claimed', 'stale', 'digest']) {
    const state = structuredClone(original);
    if (defect === 'missing') { state.configuration.controller = null; state.configuration.parameters = {}; state.configuration.actionServers = []; }
    if (defect === 'inactive') state.configuration.controller.state = 'inactive';
    if (defect === 'claimed') state.configuration.controller.claimed_interfaces = ['another_joint/position'];
    if (defect === 'stale') state.observedAt = '2000-01-01T00:00:00Z';
    state.configurationSha256 = defect === 'digest' ? '0'.repeat(64) : hash(canonical(state.configuration));
    save('controller-state.json', state);
    await assert.rejects(prepareSourceWorkspace(input));
    assert.equal(existsSync(input.output), false);
  }
  save('controller-state.json', original);
  const workspace = await prepareSourceWorkspace(input);
  const connection: Connection = JSON.parse(readFileSync(join(workspace, 'connection.json'), 'utf8'));
  const approval = approveProfile(connection.profile, 'synthetic-reviewer', new Date(now.getTime() + 3600000).toISOString(), now);
  original.configuration.controller.claimed_interfaces = ['another_joint/position'];
  original.configurationSha256 = hash(canonical(original.configuration));
  save('controller-state.json', original);
  await refreshSourceWorkspace({ ...input, workspace });
  const report = await evaluateProfile({ ...connection, approval, observation: observation(workspace, connection), now });
  assert.equal(report.decision, 'WOULD_BLOCK');
  assert.ok(report.results[0].checks.some(check => check.reason === 'fact_mismatch:active-controller'));
});
