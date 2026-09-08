import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { approveProfile, evaluateProfile, profileSchema } from '../../packages/composable-shadow';
import { createFanucFixture, createFanucPublicFixture } from '../../packages/composable-shadow/fixture';
import { readCatalog, readConnection, goalFields } from '../../packages/composable-shadow/onboarding';
import { compareReports, comparisonMarkdown, reportMarkdown } from '../../packages/composable-shadow/report';
import { verifyEvidenceBundle } from '../../packages/core/evidence';
import { executablePolicyHash } from '../../packages/core/exec-spec';

import { topicConnection } from './topic-fixture';

const now = new Date('2026-09-08T08:00:00Z');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');


function inputs(stamped = false) {
  const connection = topicConnection(stamped), path = connection.profile.paths[0];
  assert.equal(path.adapter, 'topic_twist');
  if (path.adapter !== 'topic_twist') throw new Error('fixture');
  const observation = { schemaVersion: 1, profileId: connection.profile.id, collector: 'fixture/v1',
    observedAt: now.toISOString(), environment: connection.profile.environment,
    facts: connection.profile.facts.map(f => ({ id: f.id, kind: f.kind, value: f.expected, observedAt: now.toISOString() })),
    paths: [{ id: path.id, endpoint: path.endpoint, messageType: path.messageType, interfaceSha256: path.interfaceSha256,
      subscriber: path.subscriber, subscriberCount: 1 }] };
  const approval = approveProfile(connection.profile, 'fixture-reviewer', new Date(now.getTime() + 3600000).toISOString(), now);
  return { connection, profile: connection.profile, proposals: connection.proposals, observation, approval, now };
}

test('Twist and TwistStamped round-trip catalog, mapping, evaluation and core Evidence', async () => {
  for (const stamped of [false, true]) {
    const input = inputs(stamped);
    assert.deepEqual(await readConnection(JSON.parse(JSON.stringify(input.connection))), input.connection);
    assert.ok(goalFields(input.connection.catalog.topics![0].typeTree!).some(field => field.pointer.endsWith('/linear/x')));
    const report = await evaluateProfile(input);
    assert.equal(report.decision, 'WOULD_ALLOW');
    assert.equal(report.cloudUploaded, false); assert.equal(report.controllerGoalsAttempted, 0);
    assert.equal(report.hardwareSignalSent, false);
    const result = report.results[0];
    assert.equal(result.release.actionContract.representation, 'twist');
    assert.deepEqual(verifyEvidenceBundle(result.evidence, { expectedReleaseId: result.release.metadata.releaseId,
      expectedExecutablePolicyHash: executablePolicyHash(result.release), now }), { ok: true });
    assert.match(reportMarkdown(report), /does not mean the proposed motion is safe/);
    assert.match(reportMarkdown(report), /gait\\_input/);
  }
});

test('same approval detects controller changes and comparison identifies that fact', async () => {
  const input = inputs(), baseline = await evaluateProfile(input);
  const observation = structuredClone(input.observation);
  observation.facts[1].value = hash('synthetic-controller-B');
  const changed = await evaluateProfile({ ...input, observation });
  assert.equal(changed.decision, 'WOULD_BLOCK');
  const comparison = compareReports(baseline, changed);
  assert.equal(comparison.paths[0].changedChecks[0].reason, 'fact_mismatch:controller');
  assert.match(comparisonMarkdown(comparison), /fact\\_mismatch:controller/);
  assert.notEqual(changed.results[0].expectedConfigurationDigest, changed.results[0].observedConfigurationDigest);
});

test('missing, ambiguous or replaced receiving subscription blocks', async () => {
  for (const count of [0, 2]) {
    const input = inputs(); input.observation.paths[0].subscriberCount = count;
    assert.equal((await evaluateProfile(input)).results[0].reason, 'topic_subscription_missing_or_ambiguous');
  }
  const input = inputs(); input.observation.paths[0].subscriber = { name: 'logger', namespace: '/' };
  assert.equal((await evaluateProfile(input)).results[0].reason, 'topic_subscriber_mismatch');
});

test('mapping cannot choose a logger silently, remap standard Twist shape or accept unknown semantics', async () => {
  const input = inputs();
  input.connection.catalog.topics![0].subscribers[0].count = 2;
  await assert.rejects(readConnection(input.connection), /receiving node/);
  const bad: any = topicConnection(); bad.profile.paths[0].fields.linear = '/angular';
  assert.equal(profileSchema.safeParse(bad.profile).success, false);
  bad.profile.paths[0].messageType = 'custom_msgs/msg/Velocity';
  assert.equal(profileSchema.safeParse(bad.profile).success, false);
});

test('catalog tampering and duplicate subscriber identities are rejected', async () => {
  const catalog = topicConnection().catalog;
  catalog.topics![0].interfaceSha256 = '0'.repeat(64);
  await assert.rejects(readCatalog(catalog), /fingerprint/);
  const duplicate = topicConnection().catalog;
  duplicate.topics![0].subscribers.push(duplicate.topics![0].subscribers[0]);
  await assert.rejects(readCatalog(duplicate), /Duplicate subscriber/);
});

test('invalid vectors, stamped frame, timestamps and changed approved scope fail closed', async () => {
  const badVector = inputs(); (badVector.proposals.proposals[0].goal.linear as any).x = 'fast';
  assert.equal((await evaluateProfile(badVector)).results[0].reason, 'twist_vectors_invalid');
  const badFrame = inputs(true); (badFrame.proposals.proposals[0].goal.header as any).frame_id = 'map';
  assert.equal((await evaluateProfile(badFrame)).results[0].reason, 'twist_frame_mismatch');
  const stale = inputs(); stale.observation.observedAt = new Date(now.getTime() - 31000).toISOString();
  assert.equal((await evaluateProfile(stale)).results[0].reason, 'observation_stale_or_future');
  const changed = inputs(); changed.profile.robot.controller = 'changed-controller';
  assert.equal((await evaluateProfile(changed)).results[0].reason, 'profile_changed_reapproval_required');
});

test('existing trajectory, Cartesian pose/delta and program profiles retain zero-dispatch decisions', async () => {
  for (const create of [createFanucFixture, createFanucPublicFixture]) {
    const input = create(now);
    const approval = approveProfile(input.profile, 'fixture-reviewer', new Date(now.getTime() + 3600000).toISOString(), now);
    assert.equal((await evaluateProfile({ ...input, approval, now })).decision, 'WOULD_ALLOW');
    input.observation.facts.find(f => f.id === 'calibration')!.value = 'f'.repeat(64);
    assert.equal((await evaluateProfile({ ...input, approval, now })).decision, 'WOULD_BLOCK');
  }
});
