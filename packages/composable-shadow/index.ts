import { appendEvidence, type ChainedEvidence, type EvidenceBundle } from '../core/evidence';
import { executablePolicyHash, executablePolicySpecSchema } from '../core/exec-spec';
import { configurationDigest, executionConfigurationV2Schema } from '../core/execution-configuration';
import { ShadowExecutionGate } from '../core/execution-gate';
import {
  approvalSchema, hashObject, observationSchema, profileHash, profileSchema,
  proposalBatchSchema, type Approval, type Observation, type Path, type Profile
} from './schema';
export * from './schema';
export { validateGoal } from './goals';
import { validateGoal } from './goals';
import { pathInterfaceType } from './contracts';

export function approveProfile(input: unknown, actor: string, expiresAt: string, now = new Date()): Approval {
  const profile = profileSchema.parse(input);
  return approvalSchema.parse({ schemaVersion: 1, scope: 'local-shadow-only',
    profileSha256: profileHash(profile), actor, approvedAt: now.toISOString(), expiresAt });
}

function configuration(p: Profile, path: Path, observation: Observation | undefined, now: string) {
  const actual = observation?.paths.find(a => a.id === path.id);
  const facts = path.checks.map(id => {
    const configured = p.facts.find(f => f.id === id)!;
    const observed = observation?.facts.find(f => f.id === id);
    const value = observation ? observed?.value : configured.expected;
    if (value === undefined) return null;
    return { kind: 'content' as const, sourceIdentity: `fact:${id}`, purpose: 'other' as const,
      contentSha256: configured.kind === 'file_sha256' ? value : hashObject(value) };
  });
  if (facts.includes(null) || (observation && !actual)) return undefined;
  // v2 binds semantics/provenance; environment must be explicitly in provenance
  // because v2 observation.environment is intentionally not identity-bearing.
  return executionConfigurationV2Schema.parse({
    schemaVersion: 2, identity: { device: p.robot.deviceId, robot: p.robot.model },
    semanticContract: {
      command: { interfaceType: pathInterfaceType(actual ?? path), endpoint: actual?.endpoint ?? path.endpoint },
      controller: { implementation: p.robot.controller, version: 'composable-shadow/v1' },
      // v2 names command channels as joints; reuse the existing Husarion Twist convention.
      jointCommandMapping: (path.adapter === 'topic_twist' ? ['linear.x', 'linear.y', 'linear.z', 'angular.x', 'angular.y', 'angular.z'] : p.jointOrder).map((joint, commandIndex) => ({ joint, commandIndex }))
    },
    provenance: [
      { kind: 'content', sourceIdentity: 'composition', purpose: 'controller_configuration', contentSha256: profileHash(p) },
      { kind: 'content', sourceIdentity: 'interface', purpose: 'controller_configuration', contentSha256: actual?.interfaceSha256 ?? path.interfaceSha256 },
      { kind: 'content', sourceIdentity: 'ros-environment', purpose: 'other', contentSha256: hashObject(observation?.environment ?? p.environment) },
      ...facts,
      ...(path.adapter === 'topic_twist' ? [{ kind: 'content' as const, sourceIdentity: 'topic-subscriber', purpose: 'controller_configuration' as const,
        contentSha256: hashObject(actual && 'subscriber' in actual ? actual.subscriber : path.subscriber) }] : [])
    ],
    observation: { observedAt: observation?.observedAt ?? now, environment: {
      rosDistro: observation?.environment.rosDistro ?? p.environment.rosDistro,
      rmwImplementation: observation?.environment.rmwImplementation ?? p.environment.rmwImplementation
    } }
  });
}

export interface Check { id: string; passed: boolean; reason: string; }

export async function evaluateProfile(input: {
  profile: unknown; approval: unknown; observation: unknown; proposals: unknown; now?: Date;
}) {
  const p = profileSchema.parse(input.profile);
  const a = approvalSchema.parse(input.approval);
  const o = observationSchema.parse(input.observation);
  const batch = proposalBatchSchema.parse(input.proposals);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('current_time_invalid');
  const timestamp = now.toISOString();
  const fresh = (value: string) => { const age = now.getTime() - Date.parse(value); return age >= 0 && age <= p.maxObservationAgeMs; };
  const common: Check[] = [];
  const check = (list: Check[], id: string, passed: boolean, reason: string) => list.push({ id, passed, reason: passed ? 'matched' : reason });
  check(common, 'approval.profile', a.profileSha256 === profileHash(p), 'profile_changed_reapproval_required');
  check(common, 'approval.time', Date.parse(a.approvedAt) <= now.getTime() && Date.parse(a.expiresAt) > now.getTime(), 'approval_expired_or_future');
  check(common, 'observation.profile', o.profileId === p.id, 'observation_profile_mismatch');
  check(common, 'observation.freshness', fresh(o.observedAt), 'observation_stale_or_future');
  check(common, 'environment', hashObject(o.environment) === hashObject(p.environment), 'environment_mismatch');
  check(common, 'coverage', batch.proposals.length === p.paths.length && batch.proposals.every(b => p.paths.some(path => path.id === b.pathId)), 'declared_path_proposals_incomplete');
  check(common, 'observation.paths', o.paths.length === p.paths.length && o.paths.every(b => p.paths.some(path => path.id === b.id)), 'declared_path_observations_incomplete');
  check(common, 'observation.facts', o.facts.every(f => p.facts.some(expected => expected.id === f.id)), 'unexpected_fact');
  const results = [];
  for (const path of p.paths) {
    const checks = [...common];
    const actual = o.paths.find(item => item.id === path.id);
    if (path.adapter === 'topic_twist') {
      const topic = actual && 'subscriber' in actual ? actual : undefined;
      check(checks, 'topic.subscription', topic?.subscriberCount === 1, 'topic_subscription_missing_or_ambiguous');
      check(checks, 'topic.subscriber', topic?.subscriber.name === path.subscriber.name && topic?.subscriber.namespace === path.subscriber.namespace, 'topic_subscriber_mismatch');
      check(checks, 'topic.endpoint', topic?.endpoint === path.endpoint, 'topic_endpoint_mismatch');
      check(checks, 'topic.type', topic?.messageType === path.messageType, 'topic_type_mismatch');
      check(checks, 'topic.definition', topic?.interfaceSha256 === path.interfaceSha256, 'topic_definition_mismatch');
    } else {
      const action = actual && 'actionType' in actual ? actual : undefined;
      check(checks, 'action.server', action?.serverCount === 1, 'action_server_missing_or_ambiguous');
      check(checks, 'action.endpoint', action?.endpoint === path.endpoint, 'action_endpoint_mismatch');
      check(checks, 'action.type', action?.actionType === path.actionType, 'action_type_mismatch');
      check(checks, 'action.definition', action?.interfaceSha256 === path.interfaceSha256, 'action_definition_mismatch');
    }
    for (const id of path.checks) {
      const expected = p.facts.find(f => f.id === id)!;
      const observed = o.facts.find(f => f.id === id);
      check(checks, `fact.${id}.source`, observed?.kind === expected.kind, 'fact_missing_or_wrong_source');
      check(checks, `fact.${id}.freshness`, !!observed && fresh(observed.observedAt), 'fact_stale_or_future');
      check(checks, `fact.${id}.value`, observed?.value === expected.expected, `fact_mismatch:${id}`);
    }
    const proposal = batch.proposals.find(b => b.pathId === path.id);
    const goalError = proposal ? validateGoal(p, path, proposal.goal) : 'proposal_missing';
    check(checks, 'goal', goalError === null, goalError ?? 'matched');
    const expectedConfig = configuration(p, path, undefined, timestamp)!;
    let observedConfig;
    try { observedConfig = configuration(p, path, o, timestamp); } catch { /* malformed observed digest blocks */ }
    const binding = configurationDigest(expectedConfig);
    const profileDigest = profileHash(p);
    const assessment = { schemaVersion: 1, kind: 'LocalShadowInputAssessment', assessedAt: timestamp,
      profileSha256: profileDigest, observationSha256: hashObject(o), proposalsSha256: hashObject(batch), pathId: path.id, checks };
    const spec = executablePolicySpecSchema.parse({
      apiVersion: 'realitywarden.io/v1alpha1', kind: 'ExecutablePolicy',
      metadata: { name: `${p.id}.${path.id}`, releaseId: `${p.id}.${path.id}.${a.profileSha256.slice(0, 16)}`, createdAt: a.approvedAt },
      model: { artifact: 'profile.json', sha256: profileDigest, framework: 'ros2', policyType: `shadow/${path.adapter}`, codeRevision: 'composable-shadow/v1' },
      actionContract: { representation: path.adapter === 'topic_twist' ? 'twist' : path.adapter === 'joint_trajectory' ? 'trajectory' : path.adapter === 'tp_program' ? 'program' : path.adapter,
        dimension: path.adapter === 'joint_trajectory' ? p.jointOrder.length : path.adapter === 'cartesian_pose' ? 7 : ['cartesian_delta', 'topic_twist'].includes(path.adapter) ? 6 : 1,
        jointOrder: path.adapter === 'joint_trajectory' ? p.jointOrder : [],
        units: { position: path.adapter === 'joint_trajectory' ? 'radian' : ['cartesian_pose', 'topic_twist'].includes(path.adapter) ? 'meter' : path.adapter === 'cartesian_delta' ? 'millimeter' : 'none',
          velocity: path.adapter === 'joint_trajectory' ? 'radian_per_second' : path.adapter === 'cartesian_delta' ? 'mm_per_second' : path.adapter === 'topic_twist' ? 'linear:m/s;angular:rad/s' : 'none' },
        normalizerSha256: hashObject(path.fields), preprocessorSha256: hashObject(path.adapter), postprocessorSha256: hashObject('zero-dispatch') },
      robot: { profileId: p.id, profileSha256: profileDigest, urdfSha256: p.robot.urdfSha256, controllerType: p.robot.controller, controllerConfigSha256: binding },
      runtimePolicy: { policySha256: profileDigest, maxStateAgeMs: p.maxObservationAgeMs, maxConfigurationAgeMs: p.maxObservationAgeMs, failClosed: true },
      executionConfiguration: expectedConfig, approvedConfigurationDigest: binding,
      evidence: { scenarioPackId: 'local-composable-shadow/v1', testReportSha256: hashObject(assessment),
        status: 'approved', approvedBy: a.actor, approvedAt: a.approvedAt },
      deployment: { allowedDeviceIds: [p.robot.deviceId], mode: 'shadow', expiresAt: a.expiresAt }
    });
    const identity = executablePolicyHash(spec);
    const entries: ChainedEvidence[] = [];
    const gate = new ShadowExecutionGate<Record<string, unknown>, Observation>(
      { append(evidence) { entries.push(appendEvidence(entries, evidence)); } },
      async () => ({ allowed: checks.every(c => c.passed), reason: checks.find(c => !c.passed)?.reason ?? 'composable_profile_matched', matchedRuleIds: checks.map(c => c.id) }),
      hashObject
    );
    // The envelope contains the goal hash, not customer program/pose data.
    const action = { pathId: path.id, adapter: path.adapter, goalSha256: hashObject(proposal?.goal ?? {}) };
    await gate.evaluate({
      release: spec, releaseRecord: { releaseId: spec.metadata.releaseId, state: 'shadow', executablePolicyHash: identity,
        approvedIdentityHash: identity, approvedConfigurationDigest: binding, approvedAt: a.approvedAt, approvedBy: a.actor },
      deviceId: p.robot.deviceId, proposalId: proposal?.id ?? `missing-${path.id}`, action, actionHash: hashObject(action),
      state: o,
      // A future timestamp is invalid input, not a real state observation time.
      // The assessment retains its input hash and failure; Evidence must not
      // assert a future state existed before this decision was made.
      stateObservedAt: Date.parse(o.observedAt) <= now.getTime() ? o.observedAt : undefined,
      executionConfiguration: observedConfig, now
    });
    const evidence: EvidenceBundle = { apiVersion: 'realitywarden.io/v1alpha1', kind: 'EvidenceBundle',
      releaseId: spec.metadata.releaseId, executablePolicyHash: identity, createdAt: timestamp, entries, testReportSha256: spec.evidence.testReportSha256 };
    const decision = entries[0]!.evidence;
    results.push({ pathId: path.id, adapter: path.adapter, endpoint: path.endpoint,
      interfaceType: pathInterfaceType(path), ...(path.adapter === 'topic_twist' ? { subscriber: path.subscriber, commandFrame: path.commandFrame } : {}),
      decision: decision.decision === 'allowed' ? 'WOULD_ALLOW' : 'WOULD_BLOCK',
      reason: checks.find(c => !c.passed)?.reason ?? decision.decisionReason, checks,
      expectedConfigurationDigest: binding, observedConfigurationDigest: observedConfig ? configurationDigest(observedConfig) : null,
      assessment, release: spec, evidence });
  }
  return {
    schemaVersion: 1 as const, kind: 'ComposableShadowReport' as const, profileId: p.id, profileSha256: profileHash(p),
    evaluatedAt: timestamp, collector: o.collector, assurance: 'LOCAL_SELF_ATTESTED' as const,
    coverage: 'declared_paths_only' as const, cloudUploaded: false as const,
    hardwareSignalSent: false as const, controllerGoalsAttempted: 0 as const,
    decision: results.every(r => r.decision === 'WOULD_ALLOW') ? 'WOULD_ALLOW' : 'WOULD_BLOCK', results,
    limitations: [
      'Shadow evaluation only: no hardware dispatch or production execution permit.',
      'Local approval and observation files are operator-supplied, not authenticated Cloud approval or hardware attestation.',
      'Graph discovery confirms visible server/subscriber metadata, not physical robot identity, QoS delivery, controller readiness or all execution paths.',
      'Topic proposals are supplied local message examples; no live messages are intercepted, forwarded or published. Other nodes can still command a robot: use an isolated simulation.',
      'Twist uses the operator-declared command frame; only TwistStamped includes a checked frame ID. Limits, collision checks and readiness remain the existing controller responsibility.',
      'File hashes prove local file content; timestamped JSON facts require a trusted read-only exporter of active controller state.',
      'Goal adapters check declared fields and configuration eligibility, not complete ROS serialization or physical motion safety.'
    ]
  };
}
