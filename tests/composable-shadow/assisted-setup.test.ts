import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { buildAssistedConnection } from '../../packages/composable-shadow/assisted-setup';
import { buildSetupWorkspace } from '../../apps/cli/setup-workspace';
import { inspectProjectFile } from '../../apps/cli/setup-project';
import { loadInterfaceSource, page, sampleTopic, starterTemplate } from '../../apps/cli/setup-assistant';
import { expandTrustedXacro } from '../../apps/cli/setup-xacro';
import { readCatalog } from '../../packages/composable-shadow/onboarding';
import { composeConnectionTemplates, connectionTemplateSchema, planConnectionTemplate } from '../../packages/composable-shadow/templates';
import { approveProfile, evaluateProfile } from '../../packages/composable-shadow/index';

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
  assert.match(html, /id="projectDeclaration"/);
  assert.match(html, /id="inspectDeclaration"/);
  assert.match(html, /id="folderSavedChoices"/);
  assert.match(html, /Use this catalog/);
  assert.match(html, /Add this rule template/);
  assert.match(html, /id="xacroTrust"/);
  assert.match(html, /id="expandXacro"/);
  assert.match(html, /Read one incoming message \(optional\)/);
  assert.match(html, /function updateNextStep\(/);
  assert.match(html, /Add field rule/);
  assert.match(html, /Allowed values, one per line/);
  assert.match(html, /endpoint\.addEventListener\('change',refreshPointers\)/);
  assert.match(html, /if\(!matching&&fact\.id==='robot-description'\)/);
  assert.match(html, /Valid saved interface catalog loaded/);
});

test('topic sample requires an interface in the validated catalog before starting ROS', async () => {
  const catalog = JSON.parse(readFileSync('tests/fixtures/local-assistant/custom-topic-catalog.json', 'utf8'));
  await assert.rejects(sampleTopic('missing-python', catalog, '/not-in-catalog'), /choose_available_discovered_topic/);
});

test('Xacro expansion requires trust and rejects unsafe project paths before executing a local tool', async () => {
  await assert.rejects(expandTrustedXacro({ entry: 'robot.xacro', files: [], trusted: false }, 'missing-python'),
    /xacro_requires_explicit_trust_confirmation/);
  await assert.rejects(expandTrustedXacro({ entry: '../robot.xacro', files: [{ path: '../robot.xacro', base64: '' }], trusted: true }, 'missing-python'),
    /invalid_xacro_project/);
  await assert.rejects(expandTrustedXacro({ entry: 'robot.xacro', files: [{ path: 'robot.xacro', base64: '' }], args: ['foo;bar'], trusted: true }, 'missing-python'),
    /invalid_xacro_arguments/);
});

test('custom ROS topic rules validate declared fields without publishing a message', async () => {
  const messageType = 'example_interfaces/msg/DriveInput';
  const tree = { algorithm: 'rosidl-message-fields-tree/v1', messageType,
    components: { Message: { kind: 'message', name: messageType } },
    definitions: { [messageType]: { fields: [
      { name: 'speed', type: { kind: 'primitive', name: 'double' } },
      { name: 'enabled', type: { kind: 'primitive', name: 'boolean' } }
    ] } } };
  const fingerprint = createHash('sha256').update(canonical(tree)).digest('hex');
  const observedAt = new Date().toISOString();
  const catalog = await readCatalog({ schemaVersion: 1, kind: 'RlsokInterfaceCatalog', collector: 'ros2-read-only/v1', observedAt,
    environment: { rosDistro: 'jazzy', rmwImplementation: 'rmw_fastrtps_cpp', domainId: 2 }, actions: [],
    topics: [{ endpoint: '/drive_input', messageType, subscribers: [{ name: 'receiver', namespace: '/robot', count: 1 }],
      interfaceSha256: fingerprint, typeTree: tree }], limitations: [] });
  const rules = [{ pointer: '/speed', type: 'number', meaning: 'wheel speed', unit: 'rad/s', minimum: -10, maximum: 10 },
    { pointer: '/enabled', type: 'boolean', meaning: 'enable flag', unit: 'boolean', allowed: [true] }];
  const fragment = { schemaVersion: 1, kind: 'RlsokConnectionTemplate',
    metadata: { id: 'drive-input', name: 'Drive input rules', version: '1.0.0', description: '', visibility: 'private', createdAt: observedAt },
    compatibility: { rosDistro: 'jazzy', paths: [{ id: 'drive', kind: 'topic', interfaceType: messageType, interfaceSha256: fingerprint }] },
    defaults: { maxObservationAgeMs: 30000 }, paths: [{ id: 'drive', kind: 'topic', adapter: 'topic_fields',
      mapping: { rulesJson: JSON.stringify(rules) }, requiresSemanticConfirmation: true }],
    facts: [{ id: 'robot-description', kind: 'file_sha256', path: 'files/robot.urdf' }] };
  assert.equal(connectionTemplateSchema.safeParse(fragment).success, true);
  assert.equal(connectionTemplateSchema.safeParse({ ...fragment, paths: [{ ...fragment.paths[0]!, mapping: {
    rulesJson: JSON.stringify([{ pointer: '/speed', type: 'number', meaning: 'wheel speed', unit: '' }]) } }] }).success, false);
  const urdf = Buffer.from('<robot name="drive"><link name="base"/></robot>');
  const facts = [{ id: 'robot-description', kind: 'file_sha256' as const, path: 'files/robot.urdf', expected: createHash('sha256').update(urdf).digest('hex') }];
  const input = { catalog, fragments: [fragment], robot: { id: 'drive', deviceId: 'drive-1', model: 'drive', controller: 'receiver',
    jointOrder: [], maxObservationAgeMs: 30000 }, facts,
    decisions: [{ pathId: 'drive', endpoint: '/drive_input', mapping: { subscriber: '/robot|receiver' },
      goal: { speed: 2, enabled: true }, confirmed: true }] };
  const connection = await buildAssistedConnection(input);
  assert.equal(connection.profile.paths[0]?.adapter, 'topic_fields');
  const approval = approveProfile(connection.profile, 'local-operator', new Date(Date.now() + 60000).toISOString());
  const observation = { schemaVersion: 1, profileId: connection.profile.id, observedAt, collector: 'fixture/v1',
    environment: catalog.environment, facts: facts.map(fact => ({ id: fact.id, kind: fact.kind, value: fact.expected, observedAt })),
    paths: [{ id: 'drive', endpoint: '/drive_input', messageType, interfaceSha256: fingerprint,
      subscriber: { name: 'receiver', namespace: '/robot' }, subscriberCount: 1 }] };
  const report = await evaluateProfile({ profile: connection.profile, approval, observation, proposals: connection.proposals });
  assert.equal(report.decision, 'WOULD_ALLOW');
  assert.equal(report.hardwareSignalSent, false);
  const outOfBounds = { ...input, decisions: [{ ...input.decisions[0]!, goal: { speed: 20, enabled: true } }] };
  await assert.rejects(buildAssistedConnection(outOfBounds), /topic_field_out_of_bounds/);
  await assert.rejects(buildAssistedConnection({ ...input, decisions: [{ ...input.decisions[0]!, goal: { speed: 2 } }] }), /topic_field_type_invalid|Mapped value does not fit/);
  await assert.rejects(buildAssistedConnection({ ...input, decisions: [{ ...input.decisions[0]!, mapping: { subscriber: '/robot|receiver',
    rulesJson: JSON.stringify([{ pointer: '/speed', type: 'number', meaning: 'wheel speed', unit: '', minimum: -10, maximum: 10 }]) } }] }), /too_small|String must contain|validation/i);
  await assert.rejects(buildAssistedConnection({ ...input, decisions: [{ ...input.decisions[0]!, confirmed: false }] }), /confirm_meaning_units_and_frame/);
});

test('custom ROS action Goal rules validate installed fields without sending a Goal', async () => {
  const actionType = 'example_interfaces/action/Inspect';
  const tree = { algorithm: 'rosidl-action-fields-tree/v1', actionType,
    components: { Goal: { kind: 'message', name: 'Inspect_Goal' }, Result: { kind: 'message', name: 'Inspect_Result' },
      Feedback: { kind: 'message', name: 'Inspect_Feedback' } },
    definitions: { Inspect_Goal: { fields: [
      { name: 'target', type: { kind: 'string', maximumSize: null } },
      { name: 'threshold', type: { kind: 'primitive', name: 'double' } }
    ] }, Inspect_Result: { fields: [] }, Inspect_Feedback: { fields: [] } } };
  const fingerprint = createHash('sha256').update(canonical(tree)).digest('hex');
  const observedAt = new Date().toISOString();
  const catalog = await readCatalog({ schemaVersion: 1, kind: 'RlsokInterfaceCatalog', collector: 'ros2-read-only/v1', observedAt,
    environment: { rosDistro: 'jazzy', rmwImplementation: 'rmw_fastrtps_cpp', domainId: 3 },
    actions: [{ endpoint: '/inspect', actionType, serverCount: 1, interfaceSha256: fingerprint, typeTree: tree }], limitations: [] });
  const rules = [{ pointer: '/target', type: 'string', meaning: 'part identifier', unit: 'identifier', allowed: ['part-a'] },
    { pointer: '/threshold', type: 'number', meaning: 'inspection threshold', unit: 'mm', minimum: 0, maximum: 5 }];
  const fragment = starterTemplate(catalog, { kind: 'action', endpoint: '/inspect', adapter: 'action_fields',
    projectFiles: [{ name: 'robot.urdf', kind: 'robot-description' }] });
  assert.equal(connectionTemplateSchema.safeParse(fragment).success, true);
  const urdf = Buffer.from('<robot name="inspector"><link name="base"/></robot>');
  const facts = [{ id: 'robot-description', kind: 'file_sha256' as const, path: 'files/robot.urdf',
    expected: createHash('sha256').update(urdf).digest('hex') }];
  const input = { catalog, fragments: [fragment], robot: { id: 'inspector', deviceId: 'inspector-1', model: 'inspector',
    controller: 'inspection-server', jointOrder: [], maxObservationAgeMs: 30000 }, facts,
    decisions: [{ pathId: 'path-1', endpoint: '/inspect', mapping: { rulesJson: JSON.stringify(rules) },
      goal: { target: 'part-a', threshold: 2 }, confirmed: true }] };
  const connection = await buildAssistedConnection(input);
  assert.equal(connection.profile.paths[0]?.adapter, 'action_fields');
  const approval = approveProfile(connection.profile, 'local-operator', new Date(Date.now() + 60000).toISOString());
  const observation = { schemaVersion: 1, profileId: connection.profile.id, observedAt, collector: 'fixture/v1',
    environment: catalog.environment, facts: facts.map(fact => ({ id: fact.id, kind: fact.kind, value: fact.expected, observedAt })),
    paths: [{ id: 'path-1', endpoint: '/inspect', actionType, interfaceSha256: fingerprint, serverCount: 1 }] };
  const report = await evaluateProfile({ profile: connection.profile, approval, observation, proposals: connection.proposals });
  assert.equal(report.decision, 'WOULD_ALLOW');
  assert.equal(report.hardwareSignalSent, false);
  assert.equal(report.controllerGoalsAttempted, 0);
  await assert.rejects(buildAssistedConnection({ ...input, decisions: [{ ...input.decisions[0]!, goal: { target: 'part-a', threshold: 6 } }] }), /action_field_out_of_bounds/);
  await assert.rejects(buildAssistedConnection({ ...input, decisions: [{ ...input.decisions[0]!, goal: { target: 'part-b', threshold: 2 } }] }), /action_field_not_allowlisted/);
  await assert.rejects(buildAssistedConnection({ ...input, decisions: [{ ...input.decisions[0]!, mapping: {
    rulesJson: JSON.stringify([{ pointer: '/unknown', type: 'string', meaning: 'unknown', unit: 'identifier' }]) } }] }), /Field is absent/);
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
  const controlUrdf = inspectProjectFile('control.urdf', Buffer.from('<robot name="sample"><joint name="axis" type="revolute"/><ros2_control name="System" type="system"><joint name="axis"><command_interface name="position"/><state_interface name="position"/></joint></ros2_control></robot>').toString('base64'));
  assert.deepEqual(controlUrdf.declaredCommandInterfaces, [{ joint: 'axis', interfaces: ['position'] }]);
  assert.deepEqual(controlUrdf.jointOrderCandidates, []);
  assert.match(controlUrdf.warnings.join(' '), /not proof of an active controller/);
  const srdf = inspectProjectFile('robot.srdf', Buffer.from('<robot name="sample"><group name="arm"><chain base_link="base" tip_link="tool"/></group><group name="gripper"><joint name="finger"/></group></robot>').toString('base64'));
  assert.equal(srdf.kind, 'configuration');
  assert.equal(srdf.parserPlugin, 'srdf-structure/v1');
  assert.deepEqual(srdf.planningGroups, [
    { name: 'arm', joints: [], chains: [{ baseLink: 'base', tipLink: 'tool' }] },
    { name: 'gripper', joints: ['finger'], chains: [] }
  ]);
  assert.deepEqual(srdf.jointOrderCandidates, []);
  assert.match(srdf.warnings.join(' '), /not the active controller or actual command joint order/);
  assert.throws(() => inspectProjectFile('robot.srdf', Buffer.from('<!DOCTYPE robot><robot name="sample"/>').toString('base64')), /srdf_dtd_or_entities_not_allowed/);
});

test('offline ROS interface declarations are previews, not discovered endpoints or semantics', () => {
  const source = '# PX4-style source comments are not unit confirmation\nuint32 MESSAGE_VERSION = 0\nuint64 timestamp # [us]\nfloat32[12] control # normalized thrust\n';
  const message = inspectProjectFile('ActuatorMotors.msg', Buffer.from(source).toString('base64'));
  assert.equal(message.kind, 'interface-declaration');
  assert.equal(message.parserPlugin, 'ros-interface-declaration/v1');
  assert.deepEqual(message.declaredFields, [
    { section: 'message', type: 'uint64', name: 'timestamp' },
    { section: 'message', type: 'float32[12]', name: 'control' }
  ]);
  assert.match(message.warnings.join(' '), /do not prove an installed type/);
  const action = inspectProjectFile('Inspect.action', Buffer.from('string target\n---\nbool success\n---\nstring detail\n').toString('base64'));
  assert.deepEqual(action.declaredFields?.map(field => field.section), ['goal', 'result', 'feedback']);
});

test('project folder sample contains a valid versioned fragment and catalog', async () => {
  const root = 'tests/fixtures/local-assistant/';
  const catalog = await loadInterfaceSource('saved-ros2-catalog/v1', JSON.parse(readFileSync(root + 'catalog.json', 'utf8')), 'unused');
  const fragment = connectionTemplateSchema.parse(JSON.parse(readFileSync(root + 'template.json', 'utf8')));
  assert.equal(fragment.metadata.version, '1.2.0');
  assert.equal(fragment.defaults.model, 'OLD-ROBOT-DO-NOT-COPY');
  assert.equal(planConnectionTemplate(fragment, catalog).readyForConfiguration, true);
  const multipleServers = { ...catalog, actions: catalog.actions.map(action => ({ ...action, serverCount: 2 })) };
  const ambiguousPlan = planConnectionTemplate(fragment, multipleServers);
  assert.equal(ambiguousPlan.readyForConfiguration, false);
  assert.equal(ambiguousPlan.paths[0]?.status, 'AMBIGUOUS');
  assert.deepEqual(ambiguousPlan.paths[0]?.candidates, []);
  assert.deepEqual(ambiguousPlan.paths[0]?.unusableActionServers, ['/run_program']);
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
  const duplicateReceiver = { ...validatedCatalog, topics: validatedCatalog.topics!.map(topic => ({
    ...topic, subscribers: topic.subscribers.map(node => ({ ...node, count: 2 }))
  })) };
  const noUniqueReceiver = planConnectionTemplate(generated, duplicateReceiver);
  assert.equal(noUniqueReceiver.readyForConfiguration, false);
  assert.equal(noUniqueReceiver.paths[0]?.status, 'AMBIGUOUS');
  assert.deepEqual(noUniqueReceiver.paths[0]?.candidates, []);
  assert.deepEqual(noUniqueReceiver.paths[0]?.unusableTopicReceivers, ['/cmd_vel']);
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
  const srdfBytes = Buffer.from('<robot name="sample"><group name="base"><joint name="wheel"/></group></robot>');
  const semanticStarter = starterTemplate(validatedCatalog, { kind: 'topic', endpoint: '/cmd_vel', adapter: 'topic_twist',
    projectFiles: [{ name: 'robot.urdf', kind: 'robot-description' }, { name: 'robot.srdf', kind: 'configuration' }] });
  const semanticConnection = await buildAssistedConnection({ ...input, fragments: [semanticStarter],
    facts: [...facts, { id: 'project-config-1', kind: 'file_sha256', path: 'files/robot.srdf',
      expected: createHash('sha256').update(srdfBytes).digest('hex') }],
    decisions: [{ ...input.decisions[0]!, pathId: 'path-1' }] });
  const semanticArchive = await buildSetupWorkspace(semanticConnection, [
    { path: 'files/robot.urdf', base64: urdf.toString('base64') },
    { path: 'files/robot.srdf', base64: srdfBytes.toString('base64') }
  ], semanticStarter);
  assert.ok(semanticArchive.includes(Buffer.from('files/robot.srdf')));
  assert.ok(semanticArchive.includes(srdfBytes));
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
