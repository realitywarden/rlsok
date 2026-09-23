import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { buildAssistedConnection } from '../../packages/composable-shadow/assisted-setup';
import { buildSetupWorkspace } from '../../apps/cli/setup-workspace';
import { inspectProjectFile } from '../../apps/cli/setup-project';
import { loadInterfaceSource, page, starterTemplate } from '../../apps/cli/setup-assistant';
import { readCatalog } from '../../packages/composable-shadow/onboarding';
import { composeConnectionTemplates, connectionTemplateSchema, planConnectionTemplate } from '../../packages/composable-shadow/templates';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${canonical(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

test('local assistant serves syntactically valid browser logic with reusable template controls', () => {
  const html = page('a'.repeat(48));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
  assert.match(html, /id="templateVersion"/);
  assert.match(html, /id="missingStatus"/);
  assert.match(html, /id="projectFolder"[^>]*webkitdirectory/);
  assert.match(html, /id="inspectFolder"/);
  assert.match(html, /function updateNextStep\(/);
  assert.match(html, /Valid saved interface catalog loaded/);
});

test('local project inspection suggests only structural facts', () => {
  const robot = inspectProjectFile('robot.urdf', Buffer.from('<robot name="sample"><joint name="axis" type="revolute"/></robot>').toString('base64'));
  assert.equal(robot.model, 'sample');
  assert.equal(robot.parserPlugin, 'urdf-structure/v1');
  assert.deepEqual(robot.movableJoints, ['axis']);
  assert.deepEqual(robot.controllerCandidates, []);
  const config = inspectProjectFile('control.yaml', Buffer.from('arm_controller:\n  type: JointTrajectoryController\n  joints: [axis]\n').toString('base64'));
  assert.deepEqual(config.controllerCandidates, ['arm_controller']);
  assert.equal(config.parserPlugin, 'json-yaml-structure/v1');
  assert.deepEqual(config.jointOrderCandidates, [['axis']]);
  assert.equal(inspectProjectFile('robot.urdf', Buffer.from('<robot name="${model}"/>').toString('base64')).needsExpansion, true);
});

test('project folder sample contains a valid versioned fragment and catalog', async () => {
  const root = 'tests/fixtures/local-assistant/';
  const catalog = await loadInterfaceSource('saved-ros2-catalog/v1', JSON.parse(readFileSync(root + 'catalog.json', 'utf8')), 'unused');
  const fragment = connectionTemplateSchema.parse(JSON.parse(readFileSync(root + 'template.json', 'utf8')));
  assert.equal(fragment.metadata.version, '1.2.0');
  assert.equal(planConnectionTemplate(fragment, catalog).readyForConfiguration, true);
  assert.throws(() => loadInterfaceSource('unknown/v1', catalog, 'unused'), /unsupported_interface_source/);
});

test('confirmed discovered interface yields a validated portable workspace without dispatch', async () => {
  const tree = {
    algorithm: 'rosidl-message-fields-tree/v1', messageType: 'geometry_msgs/msg/Twist',
    components: { Message: { kind: 'message', name: 'geometry_msgs/msg/Twist' } },
    definitions: {
      'geometry_msgs/msg/Twist': { fields: [
        { name: 'linear', type: { kind: 'message', name: 'geometry_msgs/msg/Vector3' } },
        { name: 'angular', type: { kind: 'message', name: 'geometry_msgs/msg/Vector3' } }
      ] },
      'geometry_msgs/msg/Vector3': { fields: ['x', 'y', 'z'].map(name => ({ name, type: { kind: 'primitive', name: 'double' } })) }
    }
  };
  const fingerprint = createHash('sha256').update(canonical(tree)).digest('hex');
  const catalog = { schemaVersion: 1, kind: 'RlsokInterfaceCatalog', collector: 'ros2-read-only/v1', observedAt: new Date().toISOString(),
    environment: { rosDistro: 'humble', rmwImplementation: 'rmw_fastrtps_cpp', domainId: 12 }, actions: [],
    topics: [{ endpoint: '/cmd_vel', messageType: 'geometry_msgs/msg/Twist', subscribers: [{ name: 'controller', namespace: '/base', count: 1 }], interfaceSha256: fingerprint, typeTree: tree }], limitations: [] };
  const validatedCatalog = await readCatalog(catalog);
  const generated = composeConnectionTemplates([starterTemplate(validatedCatalog, { kind: 'topic', endpoint: '/cmd_vel', adapter: 'topic_twist',
    projectFiles: [{ name: 'robot.urdf', kind: 'robot-description' }, { name: 'control.yaml', kind: 'configuration' }] })]);
  assert.equal(planConnectionTemplate(generated, validatedCatalog).readyForConfiguration, true);
  assert.deepEqual(generated.facts.map(fact => fact.path), ['files/robot.urdf', 'files/control.yaml']);
  const fragment = { schemaVersion: 1, kind: 'RlsokConnectionTemplate',
    metadata: { id: 'mobile-base', name: 'Mobile base', version: '1.0.0', description: 'Local test', visibility: 'private', createdAt: new Date().toISOString() },
    compatibility: { rosDistro: 'humble', paths: [{ id: 'velocity', kind: 'topic', interfaceType: 'geometry_msgs/msg/Twist', interfaceSha256: fingerprint }] },
    defaults: { maxObservationAgeMs: 30000 }, paths: [{ id: 'velocity', kind: 'topic', endpointHint: '/cmd_vel', adapter: 'topic_twist',
      mapping: { linear: '/linear', angular: '/angular' }, requiresSemanticConfirmation: true }],
    facts: [{ id: 'robot-description', kind: 'file_sha256', path: 'files/robot.urdf' }] };
  const urdf = Buffer.from('<robot name="sample"><link name="base"/></robot>');
  const facts = [{ id: 'robot-description', kind: 'file_sha256' as const, path: 'files/robot.urdf', expected: createHash('sha256').update(urdf).digest('hex') }];
  const input = { catalog, fragments: [fragment], robot: { id: 'local-sample', deviceId: 'base-1', model: 'sample', controller: 'controller', jointOrder: [], maxObservationAgeMs: 30000 }, facts,
    decisions: [{ pathId: 'velocity', endpoint: '/cmd_vel', mapping: { subscriber: '/base|controller', commandFrame: 'base_link' },
      goal: { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } }, confirmed: true }] };
  const connection = await buildAssistedConnection(input);
  assert.equal(connection.profile.paths[0]?.adapter, 'topic_twist');
  const archive = await buildSetupWorkspace(connection, [{ path: 'files/robot.urdf', base64: urdf.toString('base64') }], fragment);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.ok(archive.includes(Buffer.from('template.json')));
  assert.ok(archive.includes(urdf));
  assert.ok(archive.includes(Buffer.from('rlsok profile capture --profile profile.json --output observation.json')));
  assert.ok(archive.includes(Buffer.from('rlsok profile shadow --profile profile.json --approval approval.json')));
  await assert.rejects(buildAssistedConnection({ ...input, decisions: [{ ...input.decisions[0]!, confirmed: false }] }), /confirm_meaning_units_and_frame/);
  await assert.rejects(buildAssistedConnection({ ...input, fragments: [{ ...fragment, compatibility: { ...fragment.compatibility, rosDistro: 'jazzy' } }] }), /template_ros_distro_mismatch/);
  const secondCatalog = { ...catalog, observedAt: new Date().toISOString(), topics: [{ ...catalog.topics[0]!, endpoint: '/drive/cmd_vel',
    subscribers: [{ name: 'drive_controller', namespace: '/machine_b', count: 1 }] }] };
  const secondUrdf = Buffer.from('<robot name="machine_b"><link name="base_b"/></robot>');
  const secondConnection = await buildAssistedConnection({ ...input, catalog: secondCatalog,
    robot: { ...input.robot, id: 'machine-b', deviceId: 'base-b', model: 'machine_b' },
    facts: [{ ...facts[0]!, expected: createHash('sha256').update(secondUrdf).digest('hex') }],
    decisions: [{ ...input.decisions[0]!, endpoint: '/drive/cmd_vel', mapping: { ...input.decisions[0]!.mapping,
      subscriber: '/machine_b|drive_controller', commandFrame: 'base_b' } }] });
  assert.equal(secondConnection.profile.paths[0]?.endpoint, '/drive/cmd_vel');
  assert.equal(secondConnection.profile.robot.deviceId, 'base-b');
  assert.equal(secondConnection.profile.robot.urdfSha256, createHash('sha256').update(secondUrdf).digest('hex'));
  const combined = composeConnectionTemplates([fragment, { ...fragment, metadata: { ...fragment.metadata, id: 'second-rule', version: '2.0.0' } }]);
  assert.deepEqual(combined.paths.map(path => path.id), ['velocity', 'second-rule.velocity']);
  assert.equal(combined.facts.length, 1);
  assert.match(combined.metadata.description, /second-rule@2\.0\.0/);
});
