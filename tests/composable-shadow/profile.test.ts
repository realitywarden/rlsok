import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyEvidenceBundle } from '../../packages/core/evidence';
import { executablePolicyHash, executablePolicySpecSchema } from '../../packages/core/exec-spec';
import { approveProfile, evaluateProfile, hashObject, type Approval, type Path, type Profile,
  type Observation, type ProposalBatch } from '../../packages/composable-shadow';
import { createFanucFixture } from '../../packages/composable-shadow/fixture';

const NOW = new Date('2026-09-05T06:00:00.000Z');
const EXPIRES = new Date(NOW.getTime() + 3_600_000).toISOString();
const OTHER_HASH = '9'.repeat(64);
type Scenario = { profile: Profile; observation: Observation; proposals: ProposalBatch };
type Report = Awaited<ReturnType<typeof evaluateProfile>>;

function scenario(): Scenario {
  return structuredClone(createFanucFixture(NOW));
}

function approve(input: Scenario): Approval {
  return approveProfile(input.profile, 'local-test-reviewer', EXPIRES, NOW);
}

async function evaluate(input: Scenario, approval = approve(input)): Promise<Report> {
  const report = await evaluateProfile({ ...input, approval, now: NOW });
  assert.equal(report.hardwareSignalSent, false, 'Shadow must never report hardware dispatch');
  assert.equal(report.controllerGoalsAttempted, 0);
  assert.equal(report.cloudUploaded, false, 'local evaluation is not Cloud upload');
  for (const result of report.results) {
    assert.equal(result.evidence.entries.length, 1);
    const evidence = result.evidence.entries[0]!.evidence;
    assert.equal(evidence.hardwareSignalSent, false);
    assert.equal(evidence.dispatchedAt, undefined);
    assert.equal(evidence.controllerResult, undefined);
  }
  return report;
}

function verifyReport(report: Report): void {
  for (const result of report.results) {
    assert.equal(result.release.evidence.testReportSha256, hashObject(result.assessment));
    assert.deepEqual(verifyEvidenceBundle(result.evidence, {
      expectedReleaseId: result.release.metadata.releaseId,
      expectedExecutablePolicyHash: executablePolicyHash(result.release),
      now: NOW
    }), { ok: true }, `${result.pathId}: core Evidence verifier must accept the bundle`);
  }
}

test('future graph input is rejected with internally consistent failure evidence', async () => {
  const input = scenario();
  input.observation.observedAt = new Date(NOW.getTime() + 1000).toISOString();
  const report = await evaluate(input);
  assertAllBlocked(report, 'observation_stale_or_future');
  verifyReport(report);
});

test('program contracts do not permit physical units or joint contracts without units', async () => {
  const report = await evaluate(scenario());
  const program = structuredClone(report.results.find(r => r.adapter === 'tp_program')!.release);
  assert.equal(program.actionContract.representation, 'program');
  program.actionContract.units.position = 'radian';
  assert.equal(executablePolicySpecSchema.safeParse(program).success, false);
  const trajectory = structuredClone(report.results.find(r => r.adapter === 'joint_trajectory')!.release);
  trajectory.actionContract.units.position = 'none';
  assert.equal(executablePolicySpecSchema.safeParse(trajectory).success, false);
});

function pathFor<A extends Path['adapter']>(input: Scenario, adapter: A): Extract<Path, { adapter: A }> {
  const path = input.profile.paths.find(candidate => candidate.adapter === adapter);
  assert.ok(path, `fixture must exercise ${adapter}`);
  return path as Extract<Path, { adapter: A }>;
}

function goalFor(input: Scenario, path: Path): Record<string, unknown> {
  const proposal = input.proposals.proposals.find(candidate => candidate.pathId === path.id);
  assert.ok(proposal);
  return proposal.goal;
}

function setGoalField(goal: Record<string, unknown>, pointer: string, value: unknown): void {
  const tokens = pointer.slice(1).split('/').map(token => token.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cursor = goal;
  for (const token of tokens.slice(0, -1)) {
    const next = cursor[token];
    assert.ok(next && typeof next === 'object' && !Array.isArray(next), `fixture goal contains ${pointer}`);
    cursor = next as Record<string, unknown>;
  }
  cursor[tokens.at(-1)!] = value;
}

function calibrationFact(input: Scenario): Profile['facts'][number] {
  const fact = input.profile.facts.find(candidate => /calibr/i.test(`${candidate.id} ${candidate.path}`));
  assert.ok(fact, 'fixture must model calibration as an explicit fact');
  assert.ok(input.profile.paths.every(path => path.checks.includes(fact.id)), 'all three paths depend on calibration');
  return fact;
}

function assertAllBlocked(report: Report, reason?: string): void {
  assert.equal(report.decision, 'WOULD_BLOCK');
  assert.ok(report.results.length > 0);
  for (const result of report.results) {
    assert.equal(result.decision, 'WOULD_BLOCK', result.pathId);
    if (reason) assert.ok(result.checks.some(check => !check.passed && check.reason === reason), `${result.pathId}: ${reason}`);
  }
}

function assertOnlyPathBlocked(report: Report, pathId: string, reason: string): void {
  assert.equal(report.decision, 'WOULD_BLOCK');
  for (const result of report.results) {
    assert.equal(result.decision, result.pathId === pathId ? 'WOULD_BLOCK' : 'WOULD_ALLOW', result.pathId);
    if (result.pathId === pathId) {
      assert.ok(result.checks.some(check => !check.passed && check.reason === reason), reason);
    }
  }
}

test('one approved composition evaluates trajectory, Cartesian and TP paths with verifiable local Shadow Evidence', async () => {
  const input = scenario();
  const report = await evaluate(input);
  assert.equal(report.decision, 'WOULD_ALLOW');
  assert.deepEqual(new Set(report.results.map(result => result.adapter)),
    new Set(['joint_trajectory', 'cartesian_pose', 'tp_program']));
  assert.equal(report.results.length, 3);
  for (const result of report.results) {
    assert.equal(result.decision, 'WOULD_ALLOW');
    assert.equal(result.expectedConfigurationDigest, result.observedConfigurationDigest);
    assert.equal(result.release.robot.urdfSha256, input.profile.robot.urdfSha256);
    assert.equal(result.release.actionContract.representation,
      result.adapter === 'joint_trajectory' ? 'trajectory' : result.adapter === 'cartesian_pose' ? 'cartesian_pose' : 'program');
    assert.equal(result.evidence.entries[0]!.evidence.deviceId, input.profile.robot.deviceId);
  }
  verifyReport(report);
  const tampered = structuredClone(report.results[0]!.evidence);
  tampered.entries[0]!.evidence.deviceId = 'unapproved-controller-cell';
  assert.equal(verifyEvidenceBundle(tampered, { now: NOW }).ok, false, 'changing recorded provenance invalidates Evidence');
});

test('a changed shared calibration blocks every dependent action without changing the approved profile', async () => {
  const input = scenario();
  const approval = approve(input);
  const fact = calibrationFact(input);
  const observed = input.observation.facts.find(candidate => candidate.id === fact.id)!;
  observed.value = fact.kind === 'file_sha256' ? OTHER_HASH : `${fact.expected}-changed`;
  assert.notEqual(observed.value, fact.expected);
  const report = await evaluate(input, approval);
  assertAllBlocked(report, `fact_mismatch:${fact.id}`);
  for (const result of report.results) assert.notEqual(result.expectedConfigurationDigest, result.observedConfigurationDigest);
  verifyReport(report);
});

test('another robot and a smaller composition reuse the same evaluator through configuration alone', async () => {
  const input = scenario();
  const original = await evaluate(input);
  const originalFactCount = input.profile.facts.length;
  const path = pathFor(input, 'joint_trajectory');
  const robotDescription = input.profile.facts.find(fact => fact.kind === 'file_sha256' && fact.expected === input.profile.robot.urdfSha256);
  assert.ok(robotDescription);
  robotDescription.expected = OTHER_HASH;
  input.observation.facts.find(fact => fact.id === robotDescription.id)!.value = OTHER_HASH;
  path.checks = [calibrationFact(input).id, robotDescription.id];
  input.profile.id = 'second-cell-shadow';
  input.profile.robot.deviceId = 'second-cell-device';
  input.profile.robot.model = 'Another six-axis robot';
  input.profile.robot.controller = 'another_controller';
  input.profile.robot.urdfSha256 = OTHER_HASH;
  input.profile.environment = { rosDistro: 'humble', rmwImplementation: 'rmw_cyclonedds_cpp', domainId: 42 };
  input.profile.paths = [path];
  input.profile.facts = input.profile.facts.filter(fact => path.checks.includes(fact.id));
  assert.ok(input.profile.facts.length < originalFactCount);
  path.endpoint = '/second_cell/follow_joint_trajectory';
  input.observation.profileId = input.profile.id;
  input.observation.environment = structuredClone(input.profile.environment);
  input.observation.paths = input.observation.paths.filter(actual => actual.id === path.id);
  input.observation.paths[0]!.endpoint = path.endpoint;
  input.observation.facts = input.observation.facts.filter(fact => path.checks.includes(fact.id));
  input.proposals.proposals = input.proposals.proposals.filter(proposal => proposal.pathId === path.id);
  const report = await evaluate(input);
  assert.equal(report.decision, 'WOULD_ALLOW');
  assert.equal(report.results.length, 1);
  assert.notEqual(report.profileSha256, original.profileSha256);
  assert.notEqual(report.results[0]!.expectedConfigurationDigest, original.results.find(result => result.pathId === path.id)!.expectedConfigurationDigest);
  assert.equal(report.results[0]!.evidence.entries[0]!.evidence.deviceId, 'second-cell-device');
  verifyReport(report);
});

for (const defect of ['missing', 'wrong source', 'stale', 'future'] as const) {
  test(`${defect} calibration facts block all dependent paths even with a fresh top-level observation`, async () => {
    const input = scenario();
    const fact = calibrationFact(input);
    const observed = input.observation.facts.find(candidate => candidate.id === fact.id)!;
    if (defect === 'missing') input.observation.facts = input.observation.facts.filter(candidate => candidate.id !== fact.id);
    else if (defect === 'wrong source') observed.kind = observed.kind === 'file_sha256' ? 'json_value' : 'file_sha256';
    else observed.observedAt = new Date(NOW.getTime() + (defect === 'future' ? 1 : -input.profile.maxObservationAgeMs - 1)).toISOString();
    const report = await evaluate(input);
    assertAllBlocked(report, defect === 'missing' || defect === 'wrong source' ? 'fact_missing_or_wrong_source' : 'fact_stale_or_future');
    verifyReport(report);
  });
}

for (const defect of ['stale', 'future'] as const) {
  test(`${defect} overall observation fails closed`, async () => {
    const input = scenario();
    input.observation.observedAt = new Date(NOW.getTime() + (defect === 'future' ? 1 : -input.profile.maxObservationAgeMs - 1)).toISOString();
    assertAllBlocked(await evaluate(input), 'observation_stale_or_future');
  });
}

for (const field of ['rosDistro', 'rmwImplementation', 'domainId'] as const) {
  test(`changing observed ROS ${field} blocks the composition`, async () => {
    const input = scenario();
    if (field === 'domainId') input.observation.environment.domainId = (input.profile.environment.domainId + 1) % 233;
    else input.observation.environment[field] = `${input.profile.environment[field]}-different`;
    assertAllBlocked(await evaluate(input), 'environment_mismatch');
  });
}

for (const defect of ['interface hash', 'endpoint', 'action type', 'multiple servers', 'no server'] as const) {
  test(`${defect} drift blocks the affected custom path`, async () => {
    const input = scenario();
    const path = pathFor(input, 'cartesian_pose');
    const observed = input.observation.paths.find(candidate => candidate.id === path.id)!;
    if (!('actionType' in observed)) throw new Error('action fixture required');
    let reason: string;
    if (defect === 'interface hash') { observed.interfaceSha256 = OTHER_HASH; reason = 'action_definition_mismatch'; }
    else if (defect === 'endpoint') { observed.endpoint = '/unapproved/cartesian'; reason = 'action_endpoint_mismatch'; }
    else if (defect === 'action type') { observed.actionType = 'other_msgs/action/Cartesian'; reason = 'action_type_mismatch'; }
    else { observed.serverCount = defect === 'multiple servers' ? 2 : 0; reason = 'action_server_missing_or_ambiguous'; }
    const report = await evaluate(input);
    assertOnlyPathBlocked(report, path.id, reason);
    verifyReport(report);
  });
}

for (const missing of ['proposal', 'observation'] as const) {
  test(`omitting a declared custom TP ${missing} prevents a misleading complete pass`, async () => {
    const input = scenario();
    const path = pathFor(input, 'tp_program');
    if (missing === 'proposal') input.proposals.proposals = input.proposals.proposals.filter(proposal => proposal.pathId !== path.id);
    else input.observation.paths = input.observation.paths.filter(actual => actual.id !== path.id);
    const report = await evaluate(input);
    assert.equal(report.results.length, input.profile.paths.length, 'missing paths still receive an explicit blocked result');
    assertAllBlocked(report, missing === 'proposal' ? 'declared_path_proposals_incomplete' : 'declared_path_observations_incomplete');
    verifyReport(report);
  });
}

test('a TP program outside the approved allowlist is blocked', async () => {
  const input = scenario();
  const path = pathFor(input, 'tp_program');
  assert.ok(!path.fields.allowedPrograms.includes('UNREVIEWED_TP_PROGRAM'));
  setGoalField(goalFor(input, path), path.fields.program, 'UNREVIEWED_TP_PROGRAM');
  assertOnlyPathBlocked(await evaluate(input), path.id, 'program_not_allowlisted');
});

test('absolute PoseStamped JSON uses ROS x/y/z/w objects without a private normalizer', async () => {
  const input = scenario();
  const path = pathFor(input, 'cartesian_pose');
  path.fields = { position: '/target/pose/position', orientation: '/target/pose/orientation',
    frame: '/target/header/frame_id', expectedFrame: 'world' };
  input.proposals.proposals.find(p => p.pathId === path.id)!.goal = { target: {
    header: { stamp: { sec: 0, nanosec: 0 }, frame_id: 'world' },
    pose: { position: { x: 0.1, y: -0.2, z: 0.3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }
  } };
  const report = await evaluate(input);
  assert.equal(report.decision, 'WOULD_ALLOW');
  verifyReport(report);
  const goal = goalFor(input, path);
  for (const invalid of [{ x: 0, y: 0 }, { x: 0, y: 0, z: '0' }, { x: 0, y: 0, z: 0, velocity: 5 }]) {
    setGoalField(goal, '/target/pose/position', invalid);
    assertOnlyPathBlocked(await evaluate(input), path.id, 'cartesian_pose_invalid');
  }
});

test('scalar Cartesian fields compose through explicit ordered pointers and remain approval-bound', async () => {
  const input = scenario();
  const original = approve(input);
  const path = pathFor(input, 'cartesian_pose');
  path.fields = { position: ['/x', '/y', '/z'], orientation: ['/qx', '/qy', '/qz', '/qw'],
    frame: '/frame_id', expectedFrame: 'world' };
  input.proposals.proposals.find(p => p.pathId === path.id)!.goal = {
    x: 0.1, y: 0.2, z: 0.3, qx: 0, qy: 0, qz: 0, qw: 1, frame_id: 'world'
  };
  assertAllBlocked(await evaluate(input, original), 'profile_changed_reapproval_required');
  const approved = approve(input);
  const report = await evaluate(input, approved);
  assert.equal(report.decision, 'WOULD_ALLOW');
  verifyReport(report);
  delete goalFor(input, path).qw;
  assertOnlyPathBlocked(await evaluate(input, approved), path.id, 'cartesian_pose_invalid');
});

for (const defect of ['frame', 'quaternion', 'position'] as const) {
  test(`invalid Cartesian ${defect} cannot pass configuration eligibility`, async () => {
    const input = scenario();
    const path = pathFor(input, 'cartesian_pose');
    const goal = goalFor(input, path);
    assert.equal(typeof path.fields.position, 'string');
    assert.equal(typeof path.fields.orientation, 'string');
    if (defect === 'frame') setGoalField(goal, path.fields.frame, `${path.fields.expectedFrame}_unapproved`);
    else if (defect === 'quaternion') setGoalField(goal, path.fields.orientation as string, [0, 0, 0, 2]);
    else setGoalField(goal, path.fields.position as string, [0, 0]);
    const reason = defect === 'frame' ? 'cartesian_frame_mismatch' : defect === 'quaternion' ? 'cartesian_quaternion_invalid' : 'cartesian_pose_invalid';
    assertOnlyPathBlocked(await evaluate(input), path.id, reason);
  });
}

for (const defect of ['equal timestamps', 'decreasing timestamps', 'invalid nanoseconds'] as const) {
  test(`trajectory with ${defect} is blocked while other paths remain eligible`, async () => {
    const input = scenario();
    const path = pathFor(input, 'joint_trajectory');
    const positions = input.profile.jointOrder.map(() => 0);
    const later = defect === 'equal timestamps' ? { sec: 1, nanosec: 0 }
      : defect === 'decreasing timestamps' ? { sec: 0, nanosec: 500_000_000 }
      : { sec: 2, nanosec: 1_000_000_000 };
    setGoalField(goalFor(input, path), path.fields.points, [
      { positions, time_from_start: { sec: 1, nanosec: 0 } },
      { positions: [...positions], time_from_start: later }
    ]);
    assertOnlyPathBlocked(await evaluate(input), path.id,
      defect === 'invalid nanoseconds' ? 'trajectory_time_invalid' : 'trajectory_time_not_increasing');
  });
}

test('editing an approved interface requires fresh approval even when observations match the edited profile', async () => {
  const input = scenario();
  const originalApproval = approve(input);
  const path = pathFor(input, 'cartesian_pose');
  path.interfaceSha256 = OTHER_HASH;
  input.observation.paths.find(actual => actual.id === path.id)!.interfaceSha256 = OTHER_HASH;
  const blocked = await evaluate(input, originalApproval);
  assertAllBlocked(blocked, 'profile_changed_reapproval_required');
  const reapproved = await evaluate(input);
  assert.equal(reapproved.decision, 'WOULD_ALLOW');
  verifyReport(reapproved);
});

test('different valid goals produce different bound Evidence without copying private goal data into the report', async () => {
  const input = scenario();
  const path = pathFor(input, 'cartesian_pose');
  const goal = goalFor(input, path);
  const privateMarker = 'PRIVATE_GOAL_DATA_DO_NOT_PUBLISH';
  goal.operatorNote = privateMarker;
  const approval = approve(input);
  const first = await evaluate(input, approval);
  setGoalField(goal, path.fields.position as string, [0.1, 0.2, 0.3]);
  const second = await evaluate(input, approval);
  assert.equal(first.decision, 'WOULD_ALLOW');
  assert.equal(second.decision, 'WOULD_ALLOW');
  assert.equal(first.profileSha256, second.profileSha256, 'a goal is evaluated against the same approved composition');
  const firstPath = first.results.find(result => result.pathId === path.id)!;
  const secondPath = second.results.find(result => result.pathId === path.id)!;
  assert.notDeepEqual(firstPath.evidence.entries[0]!.evidence.proposedAction, secondPath.evidence.entries[0]!.evidence.proposedAction);
  assert.notEqual(firstPath.evidence.entries[0]!.hash, secondPath.evidence.entries[0]!.hash);
  assert.ok(!JSON.stringify(first).includes(privateMarker));
  assert.ok(!JSON.stringify(second).includes(privateMarker));
  verifyReport(first);
  verifyReport(second);
});

for (const defect of ['expired', 'future'] as const) {
  test(`${defect} local approval does not authorize Shadow eligibility`, async () => {
    const input = scenario();
    const approval = approve(input);
    if (defect === 'expired') {
      approval.approvedAt = new Date(NOW.getTime() - 2_000).toISOString();
      approval.expiresAt = NOW.toISOString();
    } else approval.approvedAt = new Date(NOW.getTime() + 1_000).toISOString();
    assertAllBlocked(await evaluate(input, approval), 'approval_expired_or_future');
  });
}

function deltaScenario(): Scenario {
  const input = scenario();
  const path: Extract<Path, { adapter: 'cartesian_delta' }> = {
    id: 'relative_jog', adapter: 'cartesian_delta', endpoint: '/fanuc/jog_cartesian',
    actionType: 'fanucpy_ros2_interfaces/action/JogCartesian', interfaceSha256: '8'.repeat(64),
    checks: [...input.profile.paths[0]!.checks],
    fields: {
      translation: ['/delta_x_mm', '/delta_y_mm', '/delta_z_mm'],
      rotation: ['/delta_w_deg', '/delta_p_deg', '/delta_r_deg'],
      velocity: '/velocity_mm_s', frame: '/header/frame_id', expectedFrame: 'fanuc_world',
      maxTranslationMm: 50, maxRotationDeg: 2, maxVelocityMmS: 25
    }
  };
  input.profile.paths.push(path);
  input.observation.paths.push({ id: path.id, endpoint: path.endpoint, actionType: path.actionType,
    interfaceSha256: path.interfaceSha256, serverCount: 1 });
  input.proposals.proposals.push({ id: 'public-relative-jog', pathId: path.id, goal: {
    header: { frame_id: 'fanuc_world' }, delta_x_mm: 1, delta_y_mm: -1, delta_z_mm: 0,
    delta_w_deg: 0.5, delta_p_deg: -0.5, delta_r_deg: 0, velocity_mm_s: 25
  } });
  return input;
}

test('public JogCartesian fields compose independently from absolute Cartesian and produce a delta contract', async () => {
  const input = deltaScenario();
  const report = await evaluate(input);
  assert.equal(report.decision, 'WOULD_ALLOW');
  assert.equal(report.results.length, 4);
  const delta = report.results.find(result => result.adapter === 'cartesian_delta')!;
  const absolute = report.results.find(result => result.adapter === 'cartesian_pose')!;
  assert.equal(delta.release.actionContract.representation, 'cartesian_delta');
  assert.equal(delta.release.actionContract.dimension, 6);
  assert.deepEqual(delta.release.actionContract.units, { position: 'millimeter', velocity: 'mm_per_second' });
  assert.equal(absolute.release.actionContract.representation, 'cartesian_pose');
  verifyReport(report);

  const path = pathFor(input, 'cartesian_delta');
  const proposal = input.proposals.proposals.find(candidate => candidate.pathId === path.id)!;
  proposal.goal = { command: proposal.goal };
  path.fields.translation = path.fields.translation.map(pointer => `/command${pointer}`) as [string, string, string];
  path.fields.rotation = path.fields.rotation.map(pointer => `/command${pointer}`) as [string, string, string];
  path.fields.velocity = `/command${path.fields.velocity}`;
  path.fields.frame = `/command${path.fields.frame}`;
  assert.equal((await evaluate(input)).decision, 'WOULD_ALLOW', 'another payload envelope reuses the same relative adapter');
});

test('an absolute pose without relative delta fields is never accepted as JogCartesian', async () => {
  const input = deltaScenario();
  const path = pathFor(input, 'cartesian_delta');
  input.proposals.proposals.find(proposal => proposal.pathId === path.id)!.goal = {
    header: { frame_id: 'fanuc_world' }, position: [0, 0, 0], orientation: [0, 0, 0, 1], velocity_mm_s: 25
  };
  const report = await evaluate(input);
  assertOnlyPathBlocked(report, path.id, 'cartesian_delta_invalid');
  verifyReport(report);
});

test('relative offsets and explicit velocity obey every declared per-axis limit', async () => {
  const cases: Array<[string, unknown, string]> = [
    ['delta_x_mm', 50.01, 'cartesian_delta_translation_out_of_bounds'],
    ['delta_y_mm', -50.01, 'cartesian_delta_translation_out_of_bounds'],
    ['delta_p_deg', 2.01, 'cartesian_delta_rotation_out_of_bounds'],
    ['delta_r_deg', -2.01, 'cartesian_delta_rotation_out_of_bounds'],
    ['delta_z_mm', null, 'cartesian_delta_invalid'],
    ['delta_w_deg', '0', 'cartesian_delta_invalid'],
    ['velocity_mm_s', 0, 'cartesian_delta_velocity_invalid'],
    ['velocity_mm_s', -1, 'cartesian_delta_velocity_invalid'],
    ['velocity_mm_s', 25.01, 'cartesian_delta_velocity_invalid'],
    ['velocity_mm_s', null, 'cartesian_delta_velocity_invalid']
  ];
  for (const [field, value, reason] of cases) {
    const input = deltaScenario();
    const path = pathFor(input, 'cartesian_delta');
    goalFor(input, path)[field] = value;
    assertOnlyPathBlocked(await evaluate(input), path.id, reason);
  }
});

test('relative goals require their approved frame and bound changes require new approval', async () => {
  const input = deltaScenario();
  const path = pathFor(input, 'cartesian_delta');
  const approval = approve(input);
  setGoalField(goalFor(input, path), path.fields.frame, 'unapproved_user_frame');
  assertOnlyPathBlocked(await evaluate(input, approval), path.id, 'cartesian_delta_frame_mismatch');
  setGoalField(goalFor(input, path), path.fields.frame, path.fields.expectedFrame);
  path.fields.maxTranslationMm = 5;
  assertAllBlocked(await evaluate(input, approval), 'profile_changed_reapproval_required');
  assert.equal((await evaluate(input)).decision, 'WOULD_ALLOW');
  path.fields.maxTranslationMm = 0;
  assert.throws(() => approve(input), 'relative bounds must be strictly positive');
  path.fields.maxTranslationMm = Number.POSITIVE_INFINITY;
  assert.throws(() => approve(input), 'relative bounds must be finite');
});
