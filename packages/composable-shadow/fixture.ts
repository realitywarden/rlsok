import { sha256 } from '../core/evidence';
import { hashObject, type Observation, type Profile, type ProposalBatch } from './schema';

export const fixtureCalibration = 'fixture_only: true\ntranslation: [0, 0, 0]\nrotation: [0, 0, 0, 1]\n';
export const fixtureUrdf = '<robot name="shadow_fixture"><link name="base"/></robot>\n';

/** Synthetic contract examples. Custom names, hashes, fields and robot facts
 * are deliberately fixtures, not inferred from a customer's private packages. */
export function createFanucFixture(now = new Date()): { profile: Profile; observation: Observation; proposals: ProposalBatch } {
  const timestamp = now.toISOString();
  const checks = ['controller_software', 'tool', 'frame', 'calibration', 'robot_description', 'stack_revision'];
  const profile: Profile = {
    schemaVersion: 1, id: 'fanuc-humble-example', mode: 'shadow',
    environment: { rosDistro: 'humble', rmwImplementation: 'rmw_fastrtps_cpp', domainId: 42 },
    robot: { deviceId: 'isolated-fanuc-example', model: 'FANUC M-10iA', controller: 'R-30iA Mate / fanucpy ROS 2 bridge', urdfSha256: sha256(fixtureUrdf) },
    jointOrder: ['joint_1', 'joint_2', 'joint_3', 'joint_4', 'joint_5', 'joint_6'], maxObservationAgeMs: 300_000,
    facts: [
      { id: 'controller_software', kind: 'json_value', path: 'controller-state.json', pointer: '/controllerSoftware', expected: 'FIXTURE-version-replace-from-controller' },
      { id: 'tool', kind: 'json_value', path: 'controller-state.json', pointer: '/toolConfigurationSha256', expected: hashObject({ fixtureOnly: true, selectedTool: 1, tcp: [0, 0, 0, 0, 0, 0] }) },
      { id: 'frame', kind: 'json_value', path: 'controller-state.json', pointer: '/frameConfigurationSha256', expected: hashObject({ fixtureOnly: true, selectedFrame: 1, transform: [0, 0, 0, 0, 0, 0] }) },
      { id: 'calibration', kind: 'file_sha256', path: 'eye-to-hand.yaml', expected: sha256(fixtureCalibration) },
      { id: 'robot_description', kind: 'file_sha256', path: 'robot.urdf', expected: sha256(fixtureUrdf) },
      { id: 'stack_revision', kind: 'json_value', path: 'controller-state.json', pointer: '/stackRevision', expected: 'FIXTURE-fanucpy-bridge-revision' }
    ],
    paths: [
      { id: 'trajectory', adapter: 'joint_trajectory', endpoint: '/fanuc_arm_controller/follow_joint_trajectory', actionType: 'control_msgs/action/FollowJointTrajectory',
        interfaceSha256: hashObject('fixture-follow-joint-trajectory-definition'), fields: { jointNames: '/trajectory/joint_names', points: '/trajectory/points' }, checks: [...checks] },
      { id: 'cartesian', adapter: 'cartesian_pose', endpoint: '/rlsok_example/absolute_cartesian', actionType: 'rlsok_shadow_example_interfaces/action/AbsoluteCartesian',
        interfaceSha256: hashObject('fixture-custom-cartesian-definition'), fields: { position: '/target/pose/position', orientation: '/target/pose/orientation', frame: '/target/header/frame_id', expectedFrame: 'FIXTURE-frame-1' }, checks: [...checks] },
      { id: 'tp_program', adapter: 'tp_program', endpoint: '/fanuc/run_program', actionType: 'fanucpy_ros2_interfaces/action/RunProgram',
        interfaceSha256: hashObject('fixture-custom-program-definition'), fields: { program: '/program_name', allowedPrograms: ['FIXTURE_PICK'] }, checks: [...checks] }
    ]
  };
  return { profile,
    observation: { schemaVersion: 1, profileId: profile.id, observedAt: timestamp, collector: 'fixture/v1', environment: { ...profile.environment },
      facts: profile.facts.map(f => ({ id: f.id, kind: f.kind, value: f.expected, observedAt: timestamp })),
      paths: profile.paths.filter(p => p.adapter !== 'topic_twist').map(p => ({ id: p.id, endpoint: p.endpoint, actionType: p.actionType, interfaceSha256: p.interfaceSha256, serverCount: 1 })) },
    proposals: { schemaVersion: 1, proposals: [
      { id: 'fixture-trajectory', pathId: 'trajectory', goal: { trajectory: { joint_names: [...profile.jointOrder], points: [{ positions: [0, 0, 0, 0, 0, 0], time_from_start: { sec: 1, nanosec: 0 } }] } } },
      { id: 'fixture-cartesian', pathId: 'cartesian', goal: { target: {
        header: { stamp: { sec: 0, nanosec: 0 }, frame_id: 'FIXTURE-frame-1' },
        pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }
      } } },
      { id: 'fixture-program', pathId: 'tp_program', goal: { program_name: 'FIXTURE_PICK' } }
    ] }
  };
}

/** Public fanucpy_ros2 revision ed04e2c exposes a relative JogCartesian action.
 * Keep that combination separate from the absolute action described by email.
 * Source state, fingerprints and bounds below remain local demonstration data. */
export function createFanucPublicFixture(now = new Date()) {
  const fixture = createFanucFixture(now);
  fixture.profile.id = 'fanucpy-public-humble-example';
  const index = fixture.profile.paths.findIndex(p => p.adapter === 'cartesian_pose');
  fixture.profile.paths[index] = {
    id: 'cartesian_delta', adapter: 'cartesian_delta', endpoint: '/fanuc/jog_cartesian',
    actionType: 'fanucpy_ros2_interfaces/action/JogCartesian', interfaceSha256: hashObject('fixture-jog-cartesian-definition'),
    fields: { translation: ['/delta_x_mm', '/delta_y_mm', '/delta_z_mm'], rotation: ['/delta_w_deg', '/delta_p_deg', '/delta_r_deg'],
      velocity: '/velocity_mm_s', frame: '/header/frame_id', expectedFrame: 'fanuc_world', maxTranslationMm: 10, maxRotationDeg: 5, maxVelocityMmS: 10 },
    checks: [...fixture.profile.paths[index].checks]
  };
  fixture.proposals.proposals[index] = { id: 'fixture-jog', pathId: 'cartesian_delta', goal: {
    header: { stamp: { sec: 0, nanosec: 0 }, frame_id: 'fanuc_world' },
    delta_x_mm: 1, delta_y_mm: 0, delta_z_mm: 0, delta_w_deg: 0, delta_p_deg: 0, delta_r_deg: 0, velocity_mm_s: 1
  } };
  fixture.observation.profileId = fixture.profile.id;
  fixture.observation.paths = fixture.profile.paths.filter(p => p.adapter !== 'topic_twist').map(p => ({ id: p.id, endpoint: p.endpoint, actionType: p.actionType, interfaceSha256: p.interfaceSha256, serverCount: 1 }));
  return fixture;
}

export function fixtureControllerState(profile: Profile, now = new Date()) {
  return { observedAt: now.toISOString(), ...Object.fromEntries(profile.facts.filter(f => f.kind === 'json_value').map(f => [f.pointer!.slice(1), f.expected])) };
}
