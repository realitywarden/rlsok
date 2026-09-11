import test from 'node:test';
import assert from 'node:assert/strict';
import { approveTelloSnapshot, reviewTelloObservation } from '../../packages/composable-shadow/tello-shadow';
import { hashObject } from '../../packages/composable-shadow/schema';

const now = new Date('2026-09-11T08:00:00.000Z');
function fixture() {
  const observation = {
    schemaVersion: 1, kind: 'RlsokTelloConfigurationObservation', startedAt: now.toISOString(), completedAt: now.toISOString(),
    binding: { manifestSha256: hashObject('manifest'),
      environment: { rosDistro: 'jazzy', rmwImplementation: 'rmw_fastrtps_cpp', domainId: 214 },
      selected: { clientNode: '/trial/client', serverNode: '/trial/server', endpoint: '/trial/tello_action', clientServiceName: 'tello_action' },
      clients: [{ node: '/trial/client', endpoint: '/trial/tello_action', type: 'tello_msgs/srv/TelloAction' }],
      servers: [{ node: '/trial/server', endpoint: '/trial/tello_action', type: 'tello_msgs/srv/TelloAction' }],
      interface: { type: 'tello_msgs/srv/TelloAction', definitionSha256: hashObject('public-service-definition') },
      files: [{ id: 'teleop-source', sha256: hashObject('reviewed_source') }]
    }, issues: [] as string[], observationMethod: 'read-only-ros-two-pass', authenticatedHardware: false, commandDispatches: 0
  };
  const event = { schemaVersion: 1, kind: 'RlsokTelloClientObservation', session: 'local-test', sequence: 1, droppedBefore: 0,
    observedAtUnixNs: now.getTime() * 1e6, observedAt: now.toISOString(), clientNode: '/trial/client',
    boundary: 'client_call_async_returned', service: 'tello_action', serviceType: 'tello_msgs/srv/TelloAction',
    serviceNameSource: 'client.srv_name', serviceResolutionVerified: false, request: { cmd: 'offline_example' } };
  const approval = approveTelloSnapshot(observation, 'local-reviewer', '2026-09-11T08:10:00.000Z', now);
  return { observation, event, approval, now };
}

test('Tello ties exact observed request to a passive configuration result, not command permission', () => {
  const f = fixture();
  const r = reviewTelloObservation(f);
  assert.equal(r.decision, 'WOULD_ALLOW');
  assert.equal(r.commandDispatches, 0); assert.equal(r.commandsBlocked, 0); assert.equal(r.enforcement, 'none');
  const other = structuredClone(f); other.event.request.cmd = 'different_offline_example';
  const changed = reviewTelloObservation(other);
  assert.equal(changed.decision, 'WOULD_ALLOW');
  assert.notEqual(r.exactRequestAndSelectedEndpointSha256, changed.exactRequestAndSelectedEndpointSha256);
  assert.notEqual(r.evidenceSha256, changed.evidenceSha256);
  const spaced = fixture();
  spaced.approval = approveTelloSnapshot(spaced.observation, '  local-reviewer  ', spaced.approval.expiresAt, now);
  assert.equal(reviewTelloObservation(spaced).decision, 'WOULD_ALLOW');
});

test('Tello same approval detects selected file, environment, definition, endpoint and server changes', () => {
  const changes = [
    (f: ReturnType<typeof fixture>) => { f.observation.binding.files[0].sha256 = hashObject('changed_source'); },
    (f: ReturnType<typeof fixture>) => { f.observation.binding.environment.domainId = 215; },
    (f: ReturnType<typeof fixture>) => { f.observation.binding.interface.definitionSha256 = hashObject('changed_idl'); },
    (f: ReturnType<typeof fixture>) => { f.observation.binding.clients[0].endpoint = '/other/tello_action'; },
    (f: ReturnType<typeof fixture>) => { f.observation.binding.servers[0].node = '/other/server'; },
    (f: ReturnType<typeof fixture>) => { f.observation.binding.servers[0].type = 'std_srvs/srv/Trigger'; }
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    const r = reviewTelloObservation(f);
    assert.equal(r.decision, 'WOULD_BLOCK');
    assert.equal(r.commandsBlocked, 0); assert.equal(r.commandDispatches, 0);
    assert.ok(r.changedBindingGroups.length);
  }
});

test('Tello missing, stale, ambiguous, lost or misattributed observations cannot appear matched', () => {
  const changes = [
    (f: ReturnType<typeof fixture>) => { f.observation.binding.servers = []; },
    (f: ReturnType<typeof fixture>) => { f.observation.binding.clients.push({ ...f.observation.binding.clients[0] }); },
    (f: ReturnType<typeof fixture>) => { f.observation.startedAt = '2026-09-11T07:59:00.000Z'; },
    (f: ReturnType<typeof fixture>) => { f.event.clientNode = '/other/client'; },
    (f: ReturnType<typeof fixture>) => { f.event.service = 'other_service'; },
    (f: ReturnType<typeof fixture>) => { f.event.droppedBefore = 1; },
    (f: ReturnType<typeof fixture>) => { f.event.observedAt = '2026-09-11T08:01:00.000Z'; },
    (f: ReturnType<typeof fixture>) => { f.observation.issues.push('selected_configuration_changed_during_read'); }
  ];
  for (const change of changes) { const f = fixture(); change(f); assert.equal(reviewTelloObservation(f).decision, 'WOULD_BLOCK'); }
  assert.equal(reviewTelloObservation({ ...fixture(), observation: null }).decision, 'WOULD_BLOCK');
});

test('Tello rejects incomplete baseline and expired or rewritten approval', () => {
  const f = fixture(); f.observation.binding.servers = [];
  assert.throws(() => approveTelloSnapshot(f.observation, 'reviewer', '2026-09-11T08:10:00.000Z', now), /baseline_incomplete/);
  const modified = fixture(); modified.approval.actor = 'rewritten';
  assert.ok(reviewTelloObservation(modified).reasons.includes('approval_modified'));
  const expired = fixture(); expired.now = new Date('2026-09-11T08:11:00.000Z');
  assert.ok(reviewTelloObservation(expired).reasons.includes('approval_expired_or_future'));
});
