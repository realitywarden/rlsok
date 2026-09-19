import { z } from 'zod';
import { canonicalJson, sha256 } from '../core/evidence';

const name = z.string().trim().min(1).max(256);
const rosName = z.string().regex(/^\/(?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const age = z.number().finite().nonnegative();

export const navigationPreflightObservationSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('RlsokNavigationPreflightObservation'),
  inputSource: z.enum(['operator-supplied', 'integration-observer']),
  observedAt: z.string().datetime({ offset: true }),
  thresholds: z.object({ maxObservationAgeMs: z.number().int().positive().max(300000),
    maxClockSkewMs: age, maxDataAgeMs: age, minScanRateHz: z.number().finite().positive() }).strict(),
  dds: z.object({ domainId: z.number().int().min(0).max(232), rmwImplementation: name,
    configurationSha256: digest, selectedTransport: name,
    expectedRobotPeers: z.array(name).min(1), observedRobotPeers: z.array(name) }).strict(),
  clock: z.object({ source: name, sampleCount: z.number().int().positive(), observedSkewMs: z.number().finite() }).strict(),
  lidar: z.object({ model: name, serial: name.optional(), topic: rosName, frame: name,
    configurationSha256: digest, publisherCount: z.number().int().nonnegative(),
    rateHz: z.number().finite().nonnegative(), ageMs: age }).strict(),
  transforms: z.array(z.object({ parent: name, child: name, available: z.boolean(), ageMs: age }).strict()).min(1).max(128),
  scanOdom: z.object({ scanFrame: name, odomFrame: name, scanMonotonic: z.boolean(), odomMonotonic: z.boolean(),
    scanAgeMs: age, odomAgeMs: age,
    alignment: z.object({ status: z.enum(['pass', 'fail', 'not-run']), method: name }).strict() }).strict(),
  nav2: z.object({ commandPathReady: z.boolean(), lifecycleNodes: z.array(z.object({ node: rosName,
    state: z.enum(['active', 'inactive', 'unconfigured', 'finalized', 'unknown']) }).strict()).min(1) }).strict()
}).strict();

export type NavigationPreflightObservation = z.infer<typeof navigationPreflightObservationSchema>;

export function evaluateNavigationPreflight(value: unknown, now = new Date()) {
  const input = navigationPreflightObservationSchema.parse(value);
  const issues: string[] = [];
  const observed = Date.parse(input.observedAt), current = now.getTime();
  if (!Number.isFinite(current) || observed > current || current - observed > input.thresholds.maxObservationAgeMs)
    issues.push('observation_stale_or_future');
  if (new Set(input.dds.expectedRobotPeers).size !== input.dds.expectedRobotPeers.length ||
      new Set(input.dds.observedRobotPeers).size !== input.dds.observedRobotPeers.length) issues.push('duplicate_dds_peer');
  const missing = input.dds.expectedRobotPeers.filter(peer => !input.dds.observedRobotPeers.includes(peer));
  const unexpected = input.dds.observedRobotPeers.filter(peer => !input.dds.expectedRobotPeers.includes(peer));
  if (missing.length) issues.push(`dds_expected_peer_missing:${missing.join(',')}`);
  if (unexpected.length) issues.push(`dds_unreviewed_peer_present:${unexpected.join(',')}`);
  if (Math.abs(input.clock.observedSkewMs) > input.thresholds.maxClockSkewMs) issues.push('clock_skew_exceeds_threshold');
  if (input.lidar.publisherCount !== 1) issues.push('lidar_publisher_missing_or_ambiguous');
  if (input.lidar.rateHz < input.thresholds.minScanRateHz) issues.push('lidar_rate_below_threshold');
  if (input.lidar.ageMs > input.thresholds.maxDataAgeMs) issues.push('lidar_data_stale');
  const transformPairs = input.transforms.map(t => `${t.parent}->${t.child}`);
  if (new Set(transformPairs).size !== transformPairs.length) issues.push('duplicate_required_transform');
  for (const transform of input.transforms) {
    if (!transform.available) issues.push(`transform_missing:${transform.parent}->${transform.child}`);
    else if (transform.ageMs > input.thresholds.maxDataAgeMs) issues.push(`transform_stale:${transform.parent}->${transform.child}`);
  }
  if (!input.scanOdom.scanMonotonic) issues.push('scan_timestamp_not_monotonic');
  if (!input.scanOdom.odomMonotonic) issues.push('odom_timestamp_not_monotonic');
  if (input.scanOdom.scanAgeMs > input.thresholds.maxDataAgeMs) issues.push('scan_stale');
  if (input.scanOdom.odomAgeMs > input.thresholds.maxDataAgeMs) issues.push('odom_stale');
  if (input.scanOdom.alignment.status !== 'pass') issues.push(`scan_odom_alignment_${input.scanOdom.alignment.status}`);
  if (!input.nav2.commandPathReady) issues.push('nav2_command_path_not_ready');
  for (const node of input.nav2.lifecycleNodes) if (node.state !== 'active') issues.push(`nav2_node_not_active:${node.node}:${node.state}`);
  const { ageMs: _lidarAge, ...selectedLidar } = input.lidar;
  const selected = { dds: input.dds, lidar: selectedLidar,
    transforms: input.transforms.map(({ ageMs: _age, ...rest }) => rest),
    scanOdom: { scanFrame: input.scanOdom.scanFrame, odomFrame: input.scanOdom.odomFrame,
      alignmentMethod: input.scanOdom.alignment.method }, nav2Nodes: input.nav2.lifecycleNodes.map(n => n.node), thresholds: input.thresholds };
  return { schemaVersion: 1 as const, kind: 'RlsokNavigationPreflightReport' as const,
    decision: issues.length ? 'WOULD_BLOCK' as const : 'WOULD_ALLOW' as const,
    observedAt: input.observedAt, evaluatedAt: now.toISOString(), inputSource: input.inputSource,
    selectedConfigurationSha256: sha256(canonicalJson(selected)), issues: [...new Set(issues)],
    hardwareDispatch: 'NO' as const, nav2GoalsSent: 0 as const, velocityCommandsPublished: 0 as const,
    boundary: 'Fresh preflight decision over supplied or integration-observed DDS peers, clock skew, lidar, TF, scan/odometry and Nav2 lifecycle facts. It does not authenticate hardware, validate localization accuracy, certify a path or stop other nodes from commanding the robot.' };
}

export function navigationPreflightMarkdown(report: ReturnType<typeof evaluateNavigationPreflight>) {
  return `# Navigation preflight: ${report.decision}\n\n${report.boundary}\n\nHardware dispatch: NO.\n\n` +
    `Selected configuration: \`${report.selectedConfigurationSha256}\`\n\n` +
    `Issues:\n${report.issues.map(issue => `- ${issue}`).join('\n') || '- None in the selected checks.'}\n`;
}
