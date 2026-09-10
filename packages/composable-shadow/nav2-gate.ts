import { z } from 'zod';
import { canonicalJson, sha256 } from '../core/evidence';
import { compareNav2ReviewInputs, nav2ReviewInputSchema } from './nav2-review';

const digest = (x: unknown) => sha256(canonicalJson(x));
const time = z.string().datetime({ offset: true });
const stamp = z.object({ sec: z.number().int().min(-2147483648).max(2147483647), nanosec: z.number().int().min(0).max(999999999) }).strict();
const header = z.object({ stamp, frame_id: z.string().min(1).max(256) }).strict();
const vector = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }).strict();
const quaternion = vector.extend({ w: z.number().finite() }).strict().refine(v => Math.abs(v.x*v.x+v.y*v.y+v.z*v.z+v.w*v.w-1) < 1e-5, 'invalid_quaternion');
export const nav2GoalSchema = z.object({
  path: z.object({ header, poses: z.array(z.object({ header, pose: z.object({ position: vector, orientation: quaternion }).strict() }).strict()).min(1).max(10000) }).strict(),
  controller_id: z.string().min(1).max(256), goal_checker_id: z.string().min(1).max(256), progress_checker_id: z.string().min(1).max(256)
}).strict();
export type Nav2Goal = z.infer<typeof nav2GoalSchema>;
export const nav2ObservationSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('RlsokNav2RosObservation'),
  startedAt: time, completedAt: time, input: nav2ReviewInputSchema,
  binding: z.record(z.unknown()), issues: z.array(z.string()).max(128),
  observationMethod: z.literal('read-only-ros-two-pass'),
  authenticatedTopology: z.literal(false), hardwareDispatch: z.literal('NO')
}).strict();
export type Nav2Observation = z.infer<typeof nav2ObservationSchema>;
const approvalSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('RlsokNav2ShadowApproval'), actor: z.string().min(1).max(256),
  reviewedAt: time, expiresAt: time, baseline: nav2ObservationSchema, goal: nav2GoalSchema,
  approvalSha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export type Nav2Approval = z.infer<typeof approvalSchema>;
function copy<T>(x: T): T { return structuredClone(x); }
function freeze<T>(x: T): T {
  if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); }
  return x;
}
function observation(x: unknown, now: number, maxAgeMs: number, beganAfter?: number): Nav2Observation {
  const o = nav2ObservationSchema.parse(copy(x)), start = Date.parse(o.startedAt), end = Date.parse(o.completedAt);
  // Hashing rejects non-finite/non-JSON binding facts through canonicalJson.
  digest(o.binding);
  if (!Number.isFinite(now) || !(maxAgeMs > 0 && maxAgeMs <= 30000) || start > end || end > now || now - start > maxAgeMs ||
      (beganAfter !== undefined && start < beganAfter) || o.input.observedAt !== o.startedAt) throw new Error('nav2_observation_not_fresh');
  if (o.issues.length) throw new Error(`nav2_observation_incomplete:${o.issues.join(',')}`);
  return o;
}
export function approveNav2Goal(raw: unknown, rawGoal: unknown, actor: string, expiresAt: string, now = Date.now()): Nav2Approval {
  const baseline = observation(raw, now, 30000), goal = nav2GoalSchema.parse(rawGoal);
  const check = compareNav2ReviewInputs({ ...baseline.input, goal }, { ...baseline.input, goal });
  if (check.result !== 'MATCH') throw new Error('nav2_baseline_incomplete');
  const until = Date.parse(expiresAt);
  if (!(until > now && until - now <= 24*60*60*1000)) throw new Error('nav2_review_expiry_must_be_within_one_day');
  const record = { schemaVersion: 1 as const, kind: 'RlsokNav2ShadowApproval' as const, actor, reviewedAt: new Date(now).toISOString(), expiresAt, baseline, goal };
  return freeze(approvalSchema.parse({ ...record, approvalSha256: digest(record) }));
}

/** A final check before a Shadow handoff. There is deliberately no ROS action transport.
 * The injected sink records the detached, deeply frozen, exact approved goal only.
 * Do not attach a robot transport: the read sequence is not an atomic hardware lock.
 */
export async function checkNav2BeforeShadowHandoff(args: {
  approval: unknown; goal: unknown; capture: () => Promise<unknown>;
  recordShadowHandoff: (goal: Readonly<Nav2Goal>) => void;
  now?: () => number; maxAgeMs?: number; captureTimeoutMs?: number;
}) {
  const clock = args.now ?? Date.now, started = clock();
  let approval: Nav2Approval | undefined, commandSha256: string | undefined;
  let report: ReturnType<typeof compareNav2ReviewInputs> | undefined, current: Nav2Observation | undefined;
  let sinkAttempted = false;
  try {
    approval = approvalSchema.parse(copy(args.approval));
    const { approvalSha256, ...signed } = approval;
    if (digest(signed) !== approvalSha256) throw new Error('nav2_approval_modified');
    if (Date.parse(approval.reviewedAt) > started || Date.parse(approval.expiresAt) <= started) throw new Error('nav2_approval_expired_or_future');
    // Clone before the asynchronous read. Caller mutations never alter the checked goal.
    const goal = freeze(nav2GoalSchema.parse(copy(args.goal)));
    commandSha256 = digest(goal);
    if (commandSha256 !== digest(approval.goal)) throw new Error('nav2_exact_goal_not_approved');
    const timeoutMs = args.captureTimeoutMs ?? 30000;
    if (!(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000)) throw new Error('invalid_nav2_capture_timeout');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let captured: unknown;
    try {
      captured = await Promise.race([Promise.resolve().then(args.capture), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('nav2_capture_timeout')), timeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); }
    current = observation(captured, clock(), args.maxAgeMs ?? 30000, started);
    if (Date.parse(approval.expiresAt) <= clock()) throw new Error('nav2_approval_expired_during_capture');
    if (digest(nav2GoalSchema.parse(args.goal)) !== commandSha256) throw new Error('nav2_goal_changed_during_capture');
    report = compareNav2ReviewInputs({ ...approval.baseline.input, goal: approval.goal }, { ...current.input, goal });
    if (report.result !== 'MATCH') throw new Error(`nav2_${report.result.toLowerCase()}`);
    if (digest(approval.baseline.binding) !== digest(current.binding)) throw new Error('nav2_graph_or_interface_binding_changed');
    // No await or caller-owned goal between the last checks and this synchronous sink.
    sinkAttempted = true;
    args.recordShadowHandoff(goal);
    return { decision: 'WOULD_ALLOW' as const, reason: 'approved_exact_goal_and_observed_configuration_match',
      approvalSha256, commandSha256, report, current, shadowHandoffs: 1, hardwareDispatch: 'NO' as const };
  } catch (error) {
    return { decision: 'WOULD_BLOCK' as const, reason: error instanceof Error ? error.message : 'nav2_check_failed',
      approvalSha256: approval?.approvalSha256, commandSha256, report, current,
      // A sink may throw after its own side effect. Never report a false zero then.
      shadowHandoffs: sinkAttempted ? null : 0, shadowSinkAttempted: sinkAttempted, hardwareDispatch: 'NO' as const };
  }
}
