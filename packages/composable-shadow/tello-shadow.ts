import { z } from 'zod';
import { hashObject } from './schema';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.string().datetime({ offset: true });
const name = z.string().regex(/^\/(?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*$/);
const bindingSchema = z.object({
  manifestSha256: sha,
  environment: z.object({ rosDistro: z.string().min(1), rmwImplementation: z.string().min(1), domainId: z.number().int().min(0).max(232) }).strict(),
  selected: z.object({ clientNode: name, serverNode: name, endpoint: name, clientServiceName: z.string().min(1).max(256) }).strict(),
  clients: z.array(z.object({ node: name, endpoint: name, type: z.string() }).strict()).max(128),
  servers: z.array(z.object({ node: name, endpoint: name, type: z.string() }).strict()).max(128),
  interface: z.object({ type: z.literal('tello_msgs/srv/TelloAction'), definitionSha256: sha }).strict(),
  files: z.array(z.object({ id: z.string().min(1), sha256: sha }).strict()).min(1).max(32)
}).strict();
export const telloSnapshotSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('RlsokTelloConfigurationObservation'),
  startedAt: time, completedAt: time, binding: bindingSchema,
  issues: z.array(z.string()).max(128), observationMethod: z.literal('read-only-ros-two-pass'),
  authenticatedHardware: z.literal(false), commandDispatches: z.literal(0)
}).strict();
const approvalSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('RlsokTelloShadowApproval'), actor: z.string().trim().min(1).max(256),
  approvedAt: time, expiresAt: time, baseline: telloSnapshotSchema, approvalSha256: sha
}).strict();
const eventSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('RlsokTelloClientObservation'),
  session: z.string().min(1).max(128), sequence: z.number().int().positive(), droppedBefore: z.number().int().nonnegative(),
  observedAtUnixNs: z.number().finite().positive(), observedAt: time, clientNode: name,
  boundary: z.literal('client_call_async_returned'), service: z.string().min(1).max(256),
  serviceType: z.literal('tello_msgs/srv/TelloAction'), serviceNameSource: z.literal('client.srv_name'),
  serviceResolutionVerified: z.literal(false), request: z.object({ cmd: z.string().min(1).max(4096) }).strict()
}).strict();

function snapshotIssues(snapshot: z.infer<typeof telloSnapshotSchema>, now: number) {
  const issues = [...snapshot.issues];
  const begin = Date.parse(snapshot.startedAt), end = Date.parse(snapshot.completedAt);
  if (begin > end || end > now || now - begin > 30000) issues.push('configuration_observation_not_fresh');
  const { selected, clients, servers, files } = snapshot.binding;
  const type = 'tello_msgs/srv/TelloAction';
  if (clients.length !== 1 || clients[0].node !== selected.clientNode || clients[0].endpoint !== selected.endpoint || clients[0].type !== type) issues.push('client_binding_missing_or_ambiguous');
  if (servers.length !== 1 || servers[0].node !== selected.serverNode || servers[0].endpoint !== selected.endpoint || servers[0].type !== type) issues.push('server_binding_missing_or_ambiguous');
  if (new Set(files.map(f => f.id)).size !== files.length) issues.push('duplicate_selected_file');
  return issues;
}

export function approveTelloSnapshot(raw: unknown, actor: string, expiresAt: string, now = new Date()) {
  const baseline = telloSnapshotSchema.parse(raw);
  const issues = snapshotIssues(baseline, now.getTime());
  if (issues.length) throw new Error('tello_baseline_incomplete:' + issues.join(','));
  const expiry = Date.parse(expiresAt);
  if (!(expiry > now.getTime() && expiry - now.getTime() <= 86400000)) throw new Error('tello_approval_expiry_must_be_within_one_day');
  const data = { schemaVersion: 1 as const, kind: 'RlsokTelloShadowApproval' as const, actor: actor.trim(),
    approvedAt: now.toISOString(), expiresAt, baseline };
  return approvalSchema.parse({ ...data, approvalSha256: hashObject(data) });
}

/** Post-call passive configuration review. No dispatch callback or permit exists.
 * The request has already been submitted by its owner; this cannot stop it.
 */
export function reviewTelloObservation(input: { approval: unknown; observation: unknown; event: unknown; now?: Date }) {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('invalid_review_time');
  const reasons: string[] = [];
  let approvedBinding: string | null = null, observedBinding: string | null = null;
  let approvalDigest: string | null = null, eventDigest: string | null = null;
  let commandDigest: string | null = null;
  const changed: string[] = [];
  let observed: z.infer<typeof telloSnapshotSchema> | undefined;
  try {
    const a = approvalSchema.parse(input.approval);
    const { approvalSha256, ...data } = a;
    approvalDigest = approvalSha256;
    if (hashObject(data) !== approvalSha256) reasons.push('approval_modified');
    if (Date.parse(a.approvedAt) > now.getTime() || Date.parse(a.expiresAt) <= now.getTime()) reasons.push('approval_expired_or_future');
    // Baseline was reviewed when the approval was made; do not require it to
    // remain fresh now, but recheck its original completeness and validity.
    reasons.push(...snapshotIssues(a.baseline, Date.parse(a.approvedAt)));
    observed = telloSnapshotSchema.parse(input.observation);
    reasons.push(...snapshotIssues(observed, now.getTime()));
    approvedBinding = hashObject(a.baseline.binding);
    observedBinding = hashObject(observed.binding);
    for (const key of Object.keys(a.baseline.binding) as Array<keyof typeof a.baseline.binding>) {
      if (hashObject(a.baseline.binding[key]) !== hashObject(observed.binding[key])) changed.push(key);
    }
    if (approvedBinding !== observedBinding) reasons.push('selected_configuration_changed');
    const event = eventSchema.parse(input.event);
    eventDigest = hashObject(event);
    commandDigest = hashObject({ endpoint: observed.binding.selected.endpoint, serviceType: event.serviceType, request: event.request });
    const eventTime = Date.parse(event.observedAt);
    if (eventTime > Date.parse(observed.startedAt) || now.getTime() - eventTime > 30000 || Math.abs(eventTime - event.observedAtUnixNs / 1e6) > 2) reasons.push('request_observation_not_fresh_or_inconsistent');
    if (event.clientNode !== observed.binding.selected.clientNode || event.service !== observed.binding.selected.clientServiceName) reasons.push('request_client_or_service_mismatch');
    if (event.droppedBefore > 0) reasons.push('client_reported_observation_loss');
  } catch (error) {
    reasons.push(error instanceof z.ZodError ? 'invalid_or_missing_review_input' : error instanceof Error ? error.message : 'review_failed');
  }
  const data = {
    schemaVersion: 1, kind: 'RlsokTelloShadowEvidence', mode: 'shadow', evaluatedAt: now.toISOString(),
    decision: reasons.length ? 'WOULD_BLOCK' : 'WOULD_ALLOW', reasons: [...new Set(reasons)], changedBindingGroups: changed,
    approvalSha256: approvalDigest, approvedConfigurationSha256: approvedBinding, observedConfigurationSha256: observedBinding,
    requestObservationSha256: eventDigest, exactRequestAndSelectedEndpointSha256: commandDigest,
    observationSha256: observed ? hashObject(observed) : null,
    scope: 'post-call-selected-software-configuration-review',
    enforcement: 'none', commandDispatches: 0, commandsBlocked: 0, cloudUploaded: false,
    limitations: [
      'The owner submitted the request before this review. No result can block, cancel, retry, or authorize it.',
      'WOULD_ALLOW means the selected observed software configuration matches the local baseline; it is not command safety or flight approval.',
      'ROS graph names and local files are not authenticated physical drone identity or proof of loaded driver parameters.',
      'The selected client-to-service association is graph correlation under an explicitly reviewed mapping, not DDS request attribution.',
      'Only the instrumented client is covered. Server responses, flight completion, other clients, cmd_vel and driver keepalives remain outside this record.',
      'Loss-free, complete capture and atomic state at command dispatch are not established. Hashes detect content changes, not malicious rewriting.'
    ]
  };
  return { ...data, evidenceSha256: hashObject(data) };
}

export function telloReportMarkdown(report: ReturnType<typeof reviewTelloObservation>) {
  return `# Tello passive Shadow: ${report.decision}\n\n` +
    `This review occurred after the owner's service call. RLSOK sent 0 commands and blocked 0 commands.\n\n` +
    `Reasons: ${report.reasons.join(', ') || 'selected configuration matched'}.\n\n` +
    `Changed groups: ${report.changedBindingGroups.join(', ') || 'none'}.\n\n` +
    `Approval: ${report.approvalSha256}\n\nRequest/selected endpoint: ${report.exactRequestAndSelectedEndpointSha256}\n\n` +
    report.limitations.map(value => '- ' + value).join('\n') + '\n';
}
