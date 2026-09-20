import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { prepareSavedSetup } from '../../packages/composable-shadow/saved-setup-recipes';
import { inspectSavedInputs } from '../../packages/composable-shadow/saved-input-review';

const robstrideSources = [
  'robstride_ros2_control/src/driver_config.cpp',
  'robstride_ros2_control/internal/robstride_ros2_control/driver_config.hpp',
  'robstride_ros2_control/description/robstride_motor_profiles.xacro',
  'robstride_ros2_control/robstride_hardware.xml',
  'robstride_driver/include/robstride_driver/joint_data.hpp',
  'robstride_driver/include/robstride_driver/motor_profile.hpp',
  'robstride_driver/src/driver.cpp', 'robstride_driver/src/motor_profile.cpp',
  'robstride_driver/src/protocol.cpp', 'robstride_examples/launch/robstride_example.launch.py'
];
const dobotSources = [
  'dobot_bringup/launch/dobot_magician_control_system.launch.py',
  'dobot_driver/dobot_driver/dobot_handle.py', 'dobot_driver/dobot_driver/interface.py',
  'dobot_driver/dobot_driver/message.py', 'dobot_driver/dobot_driver/parsers.py',
  'dobot_homing/dobot_homing/homing_server.py', 'dobot_homing/launch/dobot_homing.launch.py',
  'dobot_msgs/srv/ExecuteHomingProcedure.srv',
  'dobot_kinematics/launch/dobot_validate_trajectory.launch.py',
  'dobot_motion/launch/dobot_PTP.launch.py'
];
const lerobotSources = [
  'src/lerobot/robots/robot.py', 'src/lerobot/robots/so_follower/config_so_follower.py',
  'src/lerobot/robots/so_follower/so_follower.py', 'src/lerobot/teleoperators/teleoperator.py',
  'src/lerobot/teleoperators/so_leader/config_so_leader.py',
  'src/lerobot/teleoperators/so_leader/so_leader.py',
  'src/lerobot/scripts/lerobot_teleoperate.py', 'src/lerobot/scripts/lerobot_record.py',
  'src/lerobot/scripts/lerobot_replay.py', 'src/lerobot/scripts/lerobot_calibrate.py', 'pyproject.toml'
];

function fixture(sources: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'rlsok-feedback-recipe-'));
  const source = join(root, 'source'), inputs = join(root, 'inputs');
  mkdirSync(inputs);
  for (const path of sources) {
    const absolute = join(source, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `reviewed source: ${path}\n`);
  }
  const write = (name: string, value: string) => {
    const path = join(inputs, name); writeFileSync(path, value); return name;
  };
  return { root, source, inputs, write, output: join(root, 'output') };
}

test('RobStride recipe binds the ROS-coordinate envelope and rejects a controller/interface mismatch', (t) => {
  const f = fixture(robstrideSources); t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const selection = { controller: 'robstride_velocity_controller', commandTopic: '/robstride_velocity_controller/commands',
    commandInterface: 'velocity', joints: ['joint_1'], rosCoordinates: true, provenance: 'operator-selected' };
  f.write('selection.json', JSON.stringify(selection));
  f.write('robot.urdf', '<robot name="reviewed"/>\n');
  f.write('controllers.yaml', 'controller_manager:\n  ros__parameters: {}\n');
  const request = { id: 'robstride-review', sourceCommit: 'a'.repeat(40), selectors: {}, files: {
    selection: 'selection.json', expanded_robot_description: 'robot.urdf', controllers: 'controllers.yaml' } };
  const input = join(f.inputs, 'input.json'); writeFileSync(input, JSON.stringify(request));
  const result = prepareSavedSetup('robstride-command-envelope', f.source, input, f.output);
  assert.match(result.facts.join('\n'), /command_\*/);
  assert.match(readFileSync(join(f.output, 'REVIEW.md'), 'utf8'), /does not open SocketCAN/);

  selection.commandInterface = 'position';
  writeFileSync(join(f.inputs, 'selection.json'), JSON.stringify(selection));
  assert.throws(() => prepareSavedSetup('robstride-command-envelope', f.source, input, join(f.root, 'bad')),
    /robstride_controller_interface_mismatch/);
});

test('Dobot recipe copies homing inputs without invoking the motion service', (t) => {
  const f = fixture(dobotSources); t.after(() => rmSync(f.root, { recursive: true, force: true }));
  f.write('selection.json', JSON.stringify({ port: '/dev/ttyUSB0', tool: 'gripper', slidingRail: false,
    homingService: '/dobot_homing_service', requiredNodes: ['/dobot_homing_srv'], provenance: 'operator-selected' }));
  for (const name of ['homing.yaml', 'limits.yaml', 'ptp.yaml']) f.write(name, 'selected: true\n');
  const input = join(f.inputs, 'input.json');
  writeFileSync(input, JSON.stringify({ id: 'dobot-review', sourceCommit: 'b'.repeat(40), selectors: {}, files: {
    selection: 'selection.json', homing_parameters: 'homing.yaml', axis_limits: 'limits.yaml', ptp_parameters: 'ptp.yaml' } }));
  prepareSavedSetup('dobot-magician-homing', f.source, input, f.output);
  const review = readFileSync(join(f.output, 'REVIEW.md'), 'utf8');
  assert.match(review, /never invokes it/);
  assert.match(review, /opens no serial port/);
});

test('direct LeRobot recipe keeps leader/follower identities, calibrations and serial ports distinct', (t) => {
  const f = fixture(lerobotSources); t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const workflow = { mode: 'teleoperate', follower: { type: 'so101_follower', id: 'follower', port: '/dev/ttyACM0',
    use_degrees: true, max_relative_target: 5 }, leader: { type: 'so101_leader', id: 'leader', port: '/dev/ttyACM1',
    use_degrees: true }, offline: true, provenance: 'operator-selected' };
  f.write('workflow.json', JSON.stringify(workflow));
  f.write('follower.json', JSON.stringify({ joint_1: { id: 1, homing_offset: 10 } }));
  f.write('leader.json', JSON.stringify({ joint_1: { id: 2, homing_offset: 20 } }));
  const input = join(f.inputs, 'input.json');
  writeFileSync(input, JSON.stringify({ id: 'lerobot-review', sourceCommit: 'c'.repeat(40), selectors: {}, files: {
    workflow: 'workflow.json', follower_calibration: 'follower.json', leader_calibration: 'leader.json' } }));
  prepareSavedSetup('lerobot-so101-direct', f.source, input, f.output);
  assert.match(readFileSync(join(f.output, 'REVIEW.md'), 'utf8'), /does not import LeRobot/);

  workflow.leader.port = workflow.follower.port;
  writeFileSync(join(f.inputs, 'workflow.json'), JSON.stringify(workflow));
  assert.throws(() => prepareSavedSetup('lerobot-so101-direct', f.source, input, join(f.root, 'bad')),
    /lerobot_leader_follower_port_must_differ/);
});

test('bounded operation inspection separates saved authorization inputs from local control and safety', (t) => {
  const f = fixture([]); t.after(() => rmSync(f.root, { recursive: true, force: true }));
  f.write('operation.json', JSON.stringify({ schemaVersion: 1, operationId: 'three-finger-hold',
    authorizedTask: 'Grasp and hold one lightweight cylindrical object.',
    validity: { maxDurationMs: 60_000, renewal: 'new-check-before-next-operation' },
    localControl: { allowedAdjustments: ['Redistribute grip response', 'Small positional contact correction'],
      continuousMeasurements: ['slip estimate'], terminatingConditionIds: ['slip-envelope-exit'], ownsImmediatePhysicalResponse: true },
    independentSafety: { responsibilities: ['Force limits', 'Stopping behavior', 'Immediate safe physical response'] } }));
  f.write('envelope.json', JSON.stringify({ schemaVersion: 1, conditions: [{ id: 'slip-envelope-exit', signal: 'slip_mm',
    comparator: 'gt', threshold: 2, unit: 'mm', debounceMs: 50, interpretation: 'Local control ends the bounded operation.' }] }));
  f.write('controller.yaml', 'controller: selected\n');
  f.write('calibration.json', JSON.stringify({ selected: true }));
  f.write('perception.yaml', 'temporal_memory: selected\n');
  f.write('temporal.json', JSON.stringify({ schemaVersion: 1,
    states: [{ id: 'holding', description: 'Object held inside the declared envelope.' }, { id: 'slipping', description: 'Slip is outside the envelope.' }],
    referenceObservations: [{ id: 'hold-reference', sha256: 'd'.repeat(64), role: 'baseline', description: 'Operator-selected reference digest.' }],
    expectedTransitions: [{ from: 'holding', to: 'slipping', allowedDuringOperation: false, terminatesOperation: true, description: 'Local classifier ends the operation.' }] }));
  const input = join(f.inputs, 'input.json');
  writeFileSync(input, JSON.stringify({ id: 'bounded-review', sourceCommit: 'e'.repeat(40), files: {
    operation: 'operation.json', operating_envelope: 'envelope.json', controller_configuration: 'controller.yaml',
    calibration: 'calibration.json', perception_configuration: 'perception.yaml', temporal_state: 'temporal.json' } }));
  const result = inspectSavedInputs('bounded-operation', f.source, input);
  assert.equal(result.decision, 'NO_STATIC_ISSUES');
  assert.equal(result.hardwareDispatch, false);
  assert.match(String(result.facts.ownershipBoundary), /Local control owns continuous measurement/);
  assert.match(String(result.facts.temporalStateBoundary), /does not interpret live vision/);

  const envelope = JSON.parse(readFileSync(join(f.inputs, 'envelope.json'), 'utf8'));
  envelope.conditions[0].id = 'unreferenced';
  writeFileSync(join(f.inputs, 'envelope.json'), JSON.stringify(envelope));
  const changed = inspectSavedInputs('bounded-operation', f.source, input);
  assert.equal(changed.decision, 'REVIEW_REQUIRED');
  assert.ok(changed.issues.some(issue => issue.code === 'UNKNOWN_TERMINATING_CONDITION'));
  assert.ok(changed.issues.some(issue => issue.code === 'UNBOUND_TERMINATING_CONDITION'));
});
