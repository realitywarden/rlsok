import { z } from 'zod';

export const digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(512).refine(s => s.trim() === s && !/[\u0000-\u001f]/.test(s));
const id = text.refine(s => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(s));
const time = z.string().datetime({ offset: true });
const pointer = z.string().min(1).max(512).refine(s => s.startsWith('/') && !/~(?![01])/.test(s));
const endpoint = z.string().regex(/^\/(?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*$/);
const actionType = z.string().regex(/^[a-z][a-z0-9_]*\/action\/[A-Z][A-Za-z0-9]*$/);
export const subscriberSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  namespace: z.string().regex(/^\/(?:[A-Za-z_][A-Za-z0-9_]*(?:\/[A-Za-z_][A-Za-z0-9_]*)*)?$/)
}).strict();
export const messageTypeSchema = z.string().regex(/^[a-z][a-z0-9_]*\/msg\/[A-Z][A-Za-z0-9]*$/);
export const environmentSchema = z.object({
  rosDistro: text, rmwImplementation: text, domainId: z.number().int().min(0).max(232)
}).strict();
const commonPath = {
  id, endpoint, actionType, interfaceSha256: digest, checks: z.array(id).min(1).max(64)
};
export const pathSchema = z.discriminatedUnion('adapter', [
  z.object({ id, endpoint, interfaceSha256: digest, checks: z.array(id).min(1).max(64),
    adapter: z.literal('topic_twist'),
    messageType: z.enum(['geometry_msgs/msg/Twist', 'geometry_msgs/msg/TwistStamped']),
    subscriber: subscriberSchema,
    fields: z.object({ linear: pointer, angular: pointer }).strict(), commandFrame: text
  }).strict(),
  z.object({ ...commonPath, adapter: z.literal('joint_trajectory'), fields: z.object({
    jointNames: pointer, points: pointer
  }).strict() }).strict(),
  z.object({ ...commonPath, adapter: z.literal('cartesian_pose'), fields: z.object({
    position: z.union([pointer, z.tuple([pointer, pointer, pointer])]),
    orientation: z.union([pointer, z.tuple([pointer, pointer, pointer, pointer])]),
    frame: pointer, expectedFrame: text
  }).strict() }).strict(),
  z.object({ ...commonPath, adapter: z.literal('cartesian_delta'), fields: z.object({
    translation: z.tuple([pointer, pointer, pointer]),
    rotation: z.tuple([pointer, pointer, pointer]),
    velocity: pointer, frame: pointer, expectedFrame: text,
    maxTranslationMm: z.number().finite().positive(),
    maxRotationDeg: z.number().finite().positive(),
    maxVelocityMmS: z.number().finite().positive()
  }).strict() }).strict(),
  z.object({ ...commonPath, adapter: z.literal('tp_program'), fields: z.object({
    program: pointer, allowedPrograms: z.array(text).min(1).max(128)
  }).strict() }).strict()
]);
export const profileSchema = z.object({
  schemaVersion: z.literal(1), id, mode: z.literal('shadow'),
  environment: environmentSchema,
  robot: z.object({ deviceId: id, model: text, controller: text, urdfSha256: digest }).strict(),
  jointOrder: z.array(id).max(256),
  maxObservationAgeMs: z.number().int().min(1).max(300_000),
  facts: z.array(z.object({
    id, kind: z.enum(['file_sha256', 'json_value']),
    path: z.string().min(1).max(1024).refine(s => !/^(?:[A-Za-z]:|[\\/])/.test(s) && !s.split(/[\\/]/).includes('..') && !/[\\:\u0000-\u001f]/.test(s) && s.split('/').every(part => part.length > 0 && part !== '.')),
    pointer: pointer.optional(), expected: text
  }).strict()).min(1).max(64),
  paths: z.array(pathSchema).min(1).max(32)
}).strict().superRefine((p, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (p.paths.some(path => path.adapter !== 'topic_twist') && !p.jointOrder.length) issue('joint order required for action paths');
  for (const [name, values] of [
    ['jointOrder', p.jointOrder], ['facts', p.facts.map(f => f.id)],
    ['paths', p.paths.map(a => a.id)], ['endpoints', p.paths.map(a => a.endpoint)]
  ] as const) if (new Set(values).size !== values.length) issue(`duplicate ${name}`);
  for (const f of p.facts) {
    if (f.kind === 'file_sha256' && (!digest.safeParse(f.expected).success || f.pointer !== undefined)) issue(`invalid file fact: ${f.id}`);
    if (f.kind === 'json_value' && !f.pointer) issue(`json pointer required: ${f.id}`);
  }
  for (const a of p.paths) {
    if (a.adapter === 'topic_twist') {
      const prefix = a.messageType === 'geometry_msgs/msg/TwistStamped' ? '/twist' : '';
      if (a.fields.linear !== `${prefix}/linear` || a.fields.angular !== `${prefix}/angular`) issue(`Twist topic requires standard vector fields: ${a.id}`);
    }
    if (new Set(a.checks).size !== a.checks.length) issue(`duplicate checks: ${a.id}`);
    if (a.checks.some(c => !p.facts.some(f => f.id === c))) issue(`unknown fact: ${a.id}`);
    if (a.adapter === 'joint_trajectory' && a.actionType !== 'control_msgs/action/FollowJointTrajectory') issue(`trajectory adapter requires FollowJointTrajectory: ${a.id}`);
    if (a.adapter === 'tp_program' && new Set(a.fields.allowedPrograms).size !== a.fields.allowedPrograms.length) issue(`duplicate programs: ${a.id}`);
  }
  if (p.facts.some(f => !p.paths.some(a => a.checks.includes(f.id)))) issue('unused fact: assign every fact to at least one path');
});
export const observationSchema = z.object({
  schemaVersion: z.literal(1), profileId: id, observedAt: time,
  collector: z.enum(['fixture/v1', 'ros2-read-only/v1']), environment: environmentSchema,
  facts: z.array(z.object({ id, kind: z.enum(['file_sha256', 'json_value']), value: text, observedAt: time }).strict()).max(64),
  paths: z.array(z.union([
    z.object({ id, endpoint, actionType, interfaceSha256: digest, serverCount: z.number().int().nonnegative() }).strict(),
    z.object({ id, endpoint, messageType: messageTypeSchema, interfaceSha256: digest,
      subscriber: subscriberSchema, subscriberCount: z.number().int().min(0).max(4096) }).strict()
  ])).max(32)
}).strict().superRefine((o, ctx) => {
  for (const entries of [o.facts, o.paths]) if (new Set(entries.map(e => e.id)).size !== entries.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate observation id' });
  }
});
export const approvalSchema = z.object({
  schemaVersion: z.literal(1), scope: z.literal('local-shadow-only'), profileSha256: digest,
  actor: text, approvedAt: time, expiresAt: time
}).strict().refine(a => Date.parse(a.expiresAt) > Date.parse(a.approvedAt), 'approval lifetime invalid');
export const proposalBatchSchema = z.object({
  schemaVersion: z.literal(1),
  proposals: z.array(z.object({
    id, pathId: id, goal: z.record(z.unknown())
  }).strict()).min(1).max(32)
}).strict().superRefine((b, ctx) => {
  for (const values of [b.proposals.map(p => p.id), b.proposals.map(p => p.pathId)]) {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate proposal or path' });
  }
});
export type Profile = z.infer<typeof profileSchema>;
export type Path = Profile['paths'][number];
export type Observation = z.infer<typeof observationSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type ProposalBatch = z.infer<typeof proposalBatchSchema>;
export function pathInterfaceType(path: Path | Observation['paths'][number]): string {
  return 'messageType' in path ? path.messageType : path.actionType;
}

export function atPointer(value: unknown, path: string): unknown {
  let current = value;
  for (const token of path.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, token)) return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}
