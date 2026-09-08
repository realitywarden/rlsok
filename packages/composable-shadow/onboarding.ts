// Portable onboarding contract. The website vendors this file, contracts.ts and
// goals.ts byte-for-byte from a versioned Runtime source commit.
import { z } from 'zod';
import { atPointer, digest, environmentSchema, messageTypeSchema, subscriberSchema, profileSchema, proposalBatchSchema, type Path } from './contracts';
import { validateGoal } from './goals';

export type TypeNode =
  | { kind: 'message'; name: string }
  | { kind: 'primitive'; name: string }
  | { kind: 'string' | 'wstring'; maximumSize: number | null }
  | { kind: 'array'; element: TypeNode; size: number }
  | { kind: 'sequence'; element: TypeNode; maximumSize: number | null };
const bounded = z.string().min(1).max(512);
const count = z.number().int().nonnegative().max(2147483647);
const nodeSchema: z.ZodType<TypeNode> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), name: bounded }).strict(),
  z.object({ kind: z.literal('primitive'), name: bounded }).strict(),
  z.object({ kind: z.literal('string'), maximumSize: count.nullable() }).strict(),
  z.object({ kind: z.literal('wstring'), maximumSize: count.nullable() }).strict(),
  z.object({ kind: z.literal('array'), element: nodeSchema, size: count }).strict(),
  z.object({ kind: z.literal('sequence'), element: nodeSchema, maximumSize: count.nullable() }).strict()
]));
const actionType = z.string().regex(/^[a-z][a-z0-9_]*\/action\/[A-Z][A-Za-z0-9]*$/);
const actionTreeSchema = z.object({
  algorithm: z.literal('rosidl-action-fields-tree/v1'), actionType,
  components: z.object({ Goal: nodeSchema, Result: nodeSchema, Feedback: nodeSchema }).strict(),
  definitions: z.record(z.object({ fields: z.array(z.object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), type: nodeSchema
  }).strict()).max(8192) }).strict())
}).strict();
const messageTreeSchema = z.object({
  algorithm: z.literal('rosidl-message-fields-tree/v1'), messageType: messageTypeSchema,
  components: z.object({ Message: nodeSchema }).strict(),
  definitions: z.record(z.object({ fields: z.array(z.object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), type: nodeSchema
  }).strict()).max(8192) }).strict())
}).strict();
const treeSchema = z.union([actionTreeSchema, messageTreeSchema]);
export type TypeTree = z.infer<typeof treeSchema>;
export const catalogSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('RlsokInterfaceCatalog'),
  collector: z.literal('ros2-read-only/v1'), observedAt: z.string().datetime({ offset: true }),
  environment: environmentSchema,
  actions: z.array(z.object({
    endpoint: z.string().regex(/^\/(?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*$/),
    actionType, serverCount: z.number().int().min(1).max(4096),
    interfaceSha256: digest.optional(), typeTree: actionTreeSchema.optional(), unavailable: bounded.optional()
  }).strict()).max(128),
  topics: z.array(z.object({
    endpoint: z.string().regex(/^\/(?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*$/),
    messageType: messageTypeSchema,
    subscribers: z.array(subscriberSchema.extend({ count: z.number().int().min(1).max(4096) }).strict()).max(4096),
    interfaceSha256: digest.optional(), typeTree: messageTreeSchema.optional(), unavailable: bounded.optional()
  }).strict()).max(128).optional(),
  limitations: z.array(bounded).max(16)
}).strict();
export type Catalog = z.infer<typeof catalogSchema>;
export function catalogInterfaces(catalog: Catalog) {
  return [
    ...catalog.actions.map(action => ({ ...action, kind: 'action' as const, interfaceType: action.actionType })),
    ...(catalog.topics ?? []).map(topic => ({ ...topic, kind: 'topic' as const, interfaceType: topic.messageType }))
  ];
}
export const connectionSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('RlsokShadowConnection'),
  catalog: catalogSchema, profile: profileSchema, proposals: proposalBatchSchema
}).strict();
export type Connection = z.infer<typeof connectionSchema>;

// Bound untrusted JSON before recursive parsing. No arbitrary recursive walk on
// uploaded definitions; ROS recursive message references stay named references.
export function assertBoundedInput(input: unknown): void {
  const pending: Array<[unknown, number]> = [[input, 0]];
  let nodes = 0;
  while (pending.length) {
    const [value, depth] = pending.pop()!;
    if (++nodes > 150000 || depth > 80) throw new Error('Input is too large or deeply nested.');
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) pending.push([child, depth + 1]);
    }
  }
}

// The collector fingerprints sorted, ASCII-escaped JSON. Its tree only permits
// integer sizes (no floating point serialization differences).
function canonicalTree(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalTree).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key =>
    `${canonicalTree(key)}:${canonicalTree((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value).replace(/[\u0080-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function readCatalog(input: unknown): Promise<Catalog> {
  assertBoundedInput(input);
  const catalog = catalogSchema.parse(input);
  if (new Set(catalog.actions.map(action => action.endpoint)).size !== catalog.actions.length) throw new Error('Duplicate catalog endpoint.');
  if (new Set((catalog.topics ?? []).map(topic => topic.endpoint)).size !== (catalog.topics ?? []).length) throw new Error('Duplicate topic endpoint.');
  for (const topic of catalog.topics ?? []) {
    if (new Set(topic.subscribers.map(node => `${node.namespace}/${node.name}`)).size !== topic.subscribers.length) throw new Error('Duplicate subscriber identity.');
  }
  for (const action of catalogInterfaces(catalog)) {
    if (action.unavailable !== undefined) {
      if (action.typeTree || action.interfaceSha256) throw new Error('Unavailable interface must not contain a usable definition.');
      continue;
    }
    const tree = action.typeTree;
    if (!tree || !action.interfaceSha256 || ('actionType' in tree ? tree.actionType : tree.messageType) !== action.interfaceType) throw new Error(`Incomplete interface: ${action.endpoint}`);
    const definitions = Object.values(tree.definitions);
    if (definitions.length > 512 || definitions.reduce((n, definition) => n + definition.fields.length, 0) > 8192) throw new Error('Interface exceeds collector limits.');
    for (const definition of definitions) {
      if (new Set(definition.fields.map(field => field.name)).size !== definition.fields.length) throw new Error('Duplicate interface field.');
    }
    const references: TypeNode[] = [...Object.values(tree.components), ...definitions.flatMap(definition => definition.fields.map(field => field.type))];
    for (const component of Object.values(tree.components)) if (component.kind !== 'message') throw new Error('Action components must be messages.');
    while (references.length) {
      const node = references.pop()!;
      if (node.kind === 'message' && !Object.prototype.hasOwnProperty.call(tree.definitions, node.name)) throw new Error('Missing referenced message definition.');
      if (node.kind === 'array' || node.kind === 'sequence') references.push(node.element);
    }
    if (await sha256Bytes(new TextEncoder().encode(canonicalTree(tree))) !== action.interfaceSha256) throw new Error(`Interface fingerprint mismatch: ${action.endpoint}`);
  }
  return catalog;
}

export function goalField(tree: TypeTree, pointer: string): TypeNode | undefined {
  let node: TypeNode | undefined = 'Goal' in tree.components ? tree.components.Goal : tree.components.Message;
  for (const token of pointer.slice(1).split('/').map(value => value.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (node?.kind === 'message') {
      node = tree.definitions[node.name]?.fields.find(field => field.name === token)?.type;
    } else if (node?.kind === 'array' || node?.kind === 'sequence') {
      const limit = node.kind === 'array' ? node.size : node.maximumSize;
      if (!/^(0|[1-9][0-9]*)$/.test(token) || !Number.isSafeInteger(Number(token)) || (limit !== null && Number(token) >= limit)) return undefined;
      node = node.element;
    } else return undefined;
  }
  return node;
}

export function goalFields(tree: TypeTree): Array<{ pointer: string; kind: string }> {
  const result: Array<{ pointer: string; kind: string }> = [];
  function visit(node: TypeNode, pointer: string, ancestors: string[], depth: number): void {
    if (result.length >= 512 || depth > 16) return;
    if (pointer) result.push({ pointer, kind: node.kind === 'primitive' ? node.name : node.kind });
    if (node.kind === 'message' && !ancestors.includes(node.name)) {
      for (const field of tree.definitions[node.name]?.fields ?? []) visit(field.type, `${pointer}/${field.name}`, [...ancestors, node.name], depth + 1);
    } else if (node.kind === 'array' || node.kind === 'sequence') {
      const size = node.kind === 'array' ? Math.min(node.size, 16) : Math.min(node.maximumSize ?? 1, 1);
      for (let index = 0; index < size; index++) visit(node.element, `${pointer}/${index}`, ancestors, depth + 1);
    }
  }
  visit('Goal' in tree.components ? tree.components.Goal : tree.components.Message, '', [], 0);
  return result;
}

function mappedPointers(path: Path): string[] {
  if (path.adapter === 'topic_twist') return [path.fields.linear, path.fields.angular, ...(path.messageType === 'geometry_msgs/msg/TwistStamped' ? ['/header/frame_id', '/header/stamp'] : [])];
  if (path.adapter === 'joint_trajectory') return [path.fields.jointNames, path.fields.points];
  if (path.adapter === 'tp_program') return [path.fields.program];
  if (path.adapter === 'cartesian_delta') return [...path.fields.translation, ...path.fields.rotation, path.fields.velocity, path.fields.frame];
  return [path.fields.position, path.fields.orientation].flat().concat(path.fields.frame);
}

// Check the declared types of supplied mapped values, including collection
// bounds. Missing/unmapped message fields remain outside this adapter check.
function mappedValueMatches(tree: TypeTree, root: TypeNode, value: unknown): boolean {
  const pending: Array<[TypeNode, unknown, number]> = [[root, value, 0]];
  let visited = 0;
  while (pending.length) {
    const [node, current, depth] = pending.pop()!;
    if (++visited > 100000 || depth > 64) return false;
    if (node.kind === 'message') {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return false;
      for (const field of tree.definitions[node.name]?.fields ?? []) {
        if (Object.prototype.hasOwnProperty.call(current, field.name)) pending.push([field.type, (current as Record<string, unknown>)[field.name], depth + 1]);
      }
    } else if (node.kind === 'array' || node.kind === 'sequence') {
      if (!Array.isArray(current) || (node.kind === 'array' ? current.length !== node.size : node.maximumSize !== null && current.length > node.maximumSize)) return false;
      for (const item of current) pending.push([node.element, item, depth + 1]);
    } else if (node.kind === 'string' || node.kind === 'wstring') {
      if (typeof current !== 'string') return false;
      const length = node.kind === 'string' ? new TextEncoder().encode(current).length : Array.from(current).length;
      if (node.maximumSize !== null && length > node.maximumSize) return false;
    } else if (node.kind === 'primitive') {
      if (node.name === 'boolean') { if (typeof current !== 'boolean') return false; }
      else if (['float', 'double', 'long double'].includes(node.name)) {
        if (typeof current !== 'number' || !Number.isFinite(current) || (node.name === 'float' && Math.abs(current) > 3.4028234663852886e38)) return false;
      } else {
        const integer = /^(u?)int(8|16|32|64)$/.exec(node.name);
        if (!integer || typeof current !== 'number' || !Number.isSafeInteger(current)) return false;
        const bits = Number(integer[2]), unsigned = integer[1] === 'u';
        if (current < (unsigned ? 0 : -(2 ** (bits - 1))) || current >= 2 ** (bits - (unsigned ? 0 : 1))) return false;
      }
    }
  }
  return true;
}

export async function readConnection(input: unknown): Promise<Connection> {
  assertBoundedInput(input);
  const connection = connectionSchema.parse(input);
  const catalog = await readCatalog(connection.catalog);
  const { profile, proposals } = connection;
  if (JSON.stringify(profile.environment) !== JSON.stringify(catalog.environment)) throw new Error('Profile environment must match the imported catalog. Rediscover after changing environments.');
  if (proposals.proposals.length !== profile.paths.length) throw new Error('Supply exactly one real example goal for every selected path.');
  const urdf = profile.facts.filter(fact => fact.kind === 'file_sha256' && fact.expected === profile.robot.urdfSha256);
  if (!urdf.length) throw new Error('Add the actual robot description file as a checked fact.');
  for (const path of profile.paths) {
    const action = catalogInterfaces(catalog).find(item => item.endpoint === path.endpoint && item.kind === (path.adapter === 'topic_twist' ? 'topic' : 'action'));
    if (!action?.typeTree || action.unavailable) throw new Error(`Select an available interface: ${path.id}`);
    if (path.adapter === 'topic_twist') {
      if (action.kind !== 'topic' || action.messageType !== path.messageType ||
          action.subscribers.find(node => node.name === path.subscriber.name && node.namespace === path.subscriber.namespace)?.count !== 1) throw new Error(`Select exactly one visible subscription on the intended receiving node: ${path.id}`);
    } else if (action.kind !== 'action' || action.serverCount !== 1 || action.actionType !== path.actionType) throw new Error(`Select an available interface with exactly one visible server node: ${path.id}`);
    if (action.interfaceSha256 !== path.interfaceSha256) throw new Error(`Catalog binding mismatch: ${path.id}`);
    if (!urdf.some(fact => path.checks.includes(fact.id))) throw new Error(`Robot description must be checked by path: ${path.id}`);
    const pointers = mappedPointers(path);
    if (new Set(pointers).size !== pointers.length) throw new Error(`Mapped fields must be distinct: ${path.id}`);
    const proposal = proposals.proposals.find(item => item.pathId === path.id);
    if (!proposal) throw new Error(`Missing example goal: ${path.id}`);
    for (const pointer of pointers) {
      const node = goalField(action.typeTree, pointer);
      if (!node) throw new Error(`Field is absent from the installed Goal definition: ${path.id} ${pointer}`);
      if (!mappedValueMatches(action.typeTree, node, atPointer(proposal.goal, pointer))) throw new Error(`Mapped value does not fit the installed field type or bounds: ${path.id} ${pointer}`);
    }
    const error = validateGoal(profile, path, proposal.goal);
    if (error) throw new Error(`${path.id}: ${error}`);
  }
  return connection;
}
