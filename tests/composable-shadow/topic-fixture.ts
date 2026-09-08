import { createHash } from 'node:crypto';
import { fixtureUrdf } from '../../packages/composable-shadow/fixture';
import type { Catalog, Connection } from '../../packages/composable-shadow/onboarding';
const now = new Date('2026-09-08T08:00:00Z');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);

export function topicConnection(stamped = false): Connection {
  const messageType = stamped ? 'geometry_msgs/msg/TwistStamped' : 'geometry_msgs/msg/Twist';
  const message = (name: string) => ({ kind: 'message' as const, name });
  const field = (name: string, type: any) => ({ name, type });
  const definitions: any = {
    'geometry_msgs/msg/Vector3': { fields: ['x', 'y', 'z'].map(name => field(name, { kind: 'primitive', name: 'double' })) },
    'geometry_msgs/msg/Twist': { fields: ['linear', 'angular'].map(name => field(name, message('geometry_msgs/msg/Vector3'))) }
  };
  if (stamped) Object.assign(definitions, {
    'geometry_msgs/msg/TwistStamped': { fields: [field('header', message('std_msgs/msg/Header')), field('twist', message('geometry_msgs/msg/Twist'))] },
    'std_msgs/msg/Header': { fields: [field('stamp', message('builtin_interfaces/msg/Time')), field('frame_id', { kind: 'string', maximumSize: null })] },
    'builtin_interfaces/msg/Time': { fields: [field('sec', { kind: 'primitive', name: 'int32' }), field('nanosec', { kind: 'primitive', name: 'uint32' })] }
  });
  const typeTree = { algorithm: 'rosidl-message-fields-tree/v1' as const, messageType, components: { Message: message(messageType) }, definitions };
  const catalog: Catalog = { schemaVersion: 1, kind: 'RlsokInterfaceCatalog', collector: 'ros2-read-only/v1',
    observedAt: now.toISOString(), environment: { rosDistro: 'jazzy', rmwImplementation: 'rmw_fastrtps_cpp', domainId: 42 }, actions: [],
    topics: [{ endpoint: '/sim/cmd_vel', messageType, typeTree, interfaceSha256: hash(canonical(typeTree)),
      subscribers: [{ name: 'gait_input', namespace: '/sim', count: 1 }, { name: 'logger', namespace: '/', count: 1 }] }], limitations: [] };
  const prefix = stamped ? '/twist' : '';
  const vectors = { linear: { x: 0.1, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0.1 } };
  return { schemaVersion: 1, kind: 'RlsokShadowConnection', catalog,
    profile: { schemaVersion: 1, id: 'synthetic-topic', mode: 'shadow', environment: catalog.environment,
      robot: { deviceId: 'sim-fixture', model: 'Synthetic model', controller: 'Synthetic gait input', urdfSha256: hash(fixtureUrdf) },
      jointOrder: [], maxObservationAgeMs: 30000,
      facts: [{ id: 'urdf', kind: 'file_sha256', path: 'files/robot.urdf', expected: hash(fixtureUrdf) },
        { id: 'controller', kind: 'file_sha256', path: 'files/controller.yaml', expected: hash('synthetic-controller-A') }],
      paths: [{ id: 'velocity', adapter: 'topic_twist', endpoint: '/sim/cmd_vel', messageType,
        subscriber: { name: 'gait_input', namespace: '/sim' }, interfaceSha256: catalog.topics![0].interfaceSha256!,
        commandFrame: 'base_link', fields: { linear: `${prefix}/linear`, angular: `${prefix}/angular` }, checks: ['urdf', 'controller'] }] },
    proposals: { schemaVersion: 1, proposals: [{ id: 'example-message', pathId: 'velocity',
      goal: stamped ? { header: { frame_id: 'base_link', stamp: { sec: 1, nanosec: 0 } }, twist: vectors } : vectors }] } };
}
