import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateNavigationPreflight } from '../../packages/composable-shadow/navigation-preflight';

const now = new Date('2026-09-19T09:00:01.000Z');
const baseline = {
  schemaVersion: 1 as const, kind: 'RlsokNavigationPreflightObservation' as const,
  inputSource: 'integration-observer' as const, observedAt: '2026-09-19T09:00:00.000Z',
  thresholds: { maxObservationAgeMs: 5000, maxClockSkewMs: 20, maxDataAgeMs: 250, minScanRateHz: 9 },
  dds: { domainId: 8, rmwImplementation: 'rmw_cyclonedds_cpp', configurationSha256: '1'.repeat(64),
    selectedTransport: 'wired-ethernet', expectedRobotPeers: ['go2-bridge'], observedRobotPeers: ['go2-bridge'] },
  clock: { source: 'chrony-tracking', sampleCount: 5, observedSkewMs: 4 },
  lidar: { model: 'Hokuyo UST-10LX', serial: 'reviewed-serial', topic: '/scan', frame: 'laser',
    configurationSha256: '2'.repeat(64), publisherCount: 1, rateHz: 10, ageMs: 40 },
  transforms: [{ parent: 'odom', child: 'base_link', available: true, ageMs: 20 },
    { parent: 'base_link', child: 'laser', available: true, ageMs: 0 }],
  scanOdom: { scanFrame: 'laser', odomFrame: 'odom', scanMonotonic: true, odomMonotonic: true,
    scanAgeMs: 40, odomAgeMs: 30, alignment: { status: 'pass' as const, method: 'saved-diagnostic-v1' } },
  nav2: { commandPathReady: true, lifecycleNodes: [{ node: '/controller_server', state: 'active' as const },
    { node: '/bt_navigator', state: 'active' as const }] }
};

test('navigation preflight allows the complete fresh selected facts without dispatch', () => {
  const report = evaluateNavigationPreflight(baseline, now);
  assert.equal(report.decision, 'WOULD_ALLOW');
  assert.deepEqual(report.issues, []);
  assert.equal(report.hardwareDispatch, 'NO');
});

test('navigation preflight blocks DDS, clock, lidar, TF, scan/odom and lifecycle failures together', () => {
  const report = evaluateNavigationPreflight({ ...baseline,
    dds: { ...baseline.dds, observedRobotPeers: ['unexpected-peer'] },
    clock: { ...baseline.clock, observedSkewMs: 50 },
    lidar: { ...baseline.lidar, publisherCount: 2, rateHz: 2, ageMs: 500 },
    transforms: [{ parent: 'odom', child: 'base_link', available: false, ageMs: 0 }],
    scanOdom: { ...baseline.scanOdom, scanMonotonic: false, alignment: { status: 'not-run', method: 'manual' } },
    nav2: { commandPathReady: false, lifecycleNodes: [{ node: '/controller_server', state: 'inactive' }] }
  }, now);
  assert.equal(report.decision, 'WOULD_BLOCK');
  for (const expected of ['dds_expected_peer_missing:go2-bridge', 'clock_skew_exceeds_threshold',
    'lidar_publisher_missing_or_ambiguous', 'transform_missing:odom->base_link',
    'scan_odom_alignment_not-run', 'nav2_command_path_not_ready', 'nav2_node_not_active:/controller_server:inactive'])
    assert.ok(report.issues.includes(expected), expected);
});
