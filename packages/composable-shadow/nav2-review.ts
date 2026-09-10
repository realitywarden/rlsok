import { z } from 'zod';
import { canonicalJson, sha256 } from '../core/evidence';

const label = z.string().min(1).max(256).regex(/^[^\r\n`<>]+$/);
const rosName = z.string().regex(/^\/(?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const plugin = z.object({ id: label, implementation: label, version: label, configurationSha256: digest }).strict();
const selectorKeys = ['controller_id', 'goal_checker_id', 'progress_checker_id'] as const;
const pluginList = z.array(plugin).min(1).max(64);

/** Local supplied inputs; no collector, execution approval or Nav2 transport. */
export const nav2ReviewInputSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('RlsokNav2ReviewInput'),
  distribution: z.literal('jazzy'), inputSource: z.enum(['synthetic', 'operator-supplied']),
  observedAt: z.string().datetime({ offset: true }), actionEndpoint: rosName,
  software: z.array(z.object({ identity: label, version: label }).strict()).min(1).max(64),
  smoother: z.object({
    feedback: z.enum(['OPEN_LOOP', 'CLOSED_LOOP']), scale_velocities: z.boolean(),
    smoothing_frequency: z.number().finite().positive(), velocity_timeout: z.number().finite().nonnegative(),
    max_velocity: vector, min_velocity: vector, max_accel: vector, max_decel: vector, deadband_velocity: vector,
    stamp_smoothed_velocity_with_smoothing_time: z.boolean(), timestampConsumed: z.boolean(),
    use_realtime_priority: z.boolean().optional(),
    odometry: z.object({ topic: rosName, sourceNode: rosName, frame: label, duration: z.number().finite().positive() }).strict().optional()
  }).strict(),
  topology: z.object({
    selectedPathComplete: z.boolean(),
    stages: z.array(z.object({
      role: z.enum(['controller', 'smoother', 'gate', 'base']), node: rosName,
      inputTopic: rosName.nullable(), outputTopic: rosName.nullable(),
      implementation: label, version: label, configurationSha256: digest
    }).strict()).min(3).max(12),
    edges: z.array(z.object({
      publisher: rosName, subscriber: rosName, topic: rosName,
      selectedPublisherCount: z.number().int().nonnegative(),
      selectedSubscriptionCount: z.number().int().nonnegative(), otherPublisherCount: z.number().int().nonnegative()
    }).strict()).max(32)
  }).strict(),
  loadedPlugins: z.object({ controller_id: pluginList, goal_checker_id: pluginList, progress_checker_id: pluginList }).strict(),
  // Path bytes are opaque JSON here; this does not validate path geometry or motion.
  goal: z.object({ path: z.record(z.unknown()), controller_id: z.string().max(256),
    goal_checker_id: z.string().max(256), progress_checker_id: z.string().max(256) }).strict(),
  volatile: z.record(z.unknown()).optional(), diagnostics: z.record(z.unknown()).optional()
}).strict();
export type Nav2ReviewInput = z.infer<typeof nav2ReviewInputSchema>;

function jsonOnly(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error('nav2_json_nesting_too_deep');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach(v => jsonOnly(v, depth + 1)); return; }
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    Object.values(value).forEach(v => jsonOnly(v, depth + 1)); return;
  }
  throw new Error('nav2_input_requires_finite_json_values');
}
function selected(input: unknown) {
  jsonOnly(input);
  const value = nav2ReviewInputSchema.parse(input), issues: string[] = [];
  const unique = (values: string[], reason: string) => { if (new Set(values).size !== values.length) issues.push(reason); };
  unique(value.software.map(s => s.identity), 'duplicate_software_identity');
  const s = value.smoother;
  for (let i = 0; i < 3; i++) {
    if (s.min_velocity[i] > s.max_velocity[i] || s.max_accel[i] < 0 || s.max_decel[i] > 0 || s.deadband_velocity[i] < 0) issues.push(`invalid_selected_limits_axis_${i}`);
  }
  if (s.feedback === 'CLOSED_LOOP' && !s.odometry) issues.push('closed_loop_requires_odometry_source_binding');
  const stages = value.topology.stages;
  unique(stages.map(s => s.node), 'duplicate_selected_path_node');
  if (!value.topology.selectedPathComplete) issues.push('selected_command_path_not_confirmed_complete');
  if (stages[0].role !== 'controller' || stages[1].role !== 'smoother' || stages.at(-1)!.role !== 'base' ||
    stages.slice(2, -1).some(s => s.role !== 'gate') || stages[0].inputTopic !== null || stages.at(-1)!.outputTopic !== null) issues.push('invalid_selected_command_path_roles');
  for (let i = 1; i < stages.length; i++) {
    const before = stages[i - 1], after = stages[i];
    if (!before.outputTopic || before.outputTopic !== after.inputTopic) issues.push(`disconnected_path_stage_${i}`);
    const edges = value.topology.edges.filter(e => e.publisher === before.node && e.subscriber === after.node && e.topic === before.outputTopic);
    if (edges.length !== 1 || edges[0].selectedPublisherCount !== 1 || edges[0].selectedSubscriptionCount !== 1 || edges[0].otherPublisherCount !== 0) issues.push(`missing_or_ambiguous_selected_edge_${i}`);
  }
  for (const edge of value.topology.edges) {
    const index = stages.findIndex(stage => stage.node === edge.subscriber && stage.inputTopic === edge.topic);
    if (index > 0 && stages[index - 1].node !== edge.publisher) issues.push('unreviewed_publisher_on_selected_command_input');
  }
  const selectors: Record<string, string | null> = {};
  for (const key of selectorKeys) {
    const plugins = value.loadedPlugins[key]; unique(plugins.map(p => p.id), `duplicate_${key}`);
    const requested = value.goal[key];
    const chosen = requested === '' && plugins.length === 1 ? plugins[0] : plugins.find(p => p.id === requested);
    selectors[key] = chosen?.id ?? null;
    if (!chosen) issues.push(`unresolved_goal_${key}`);
  }
  const { odometry, use_realtime_priority: _priority, stamp_smoothed_velocity_with_smoothing_time: stamp, ...semantics } = s;
  const stable = {
    distribution: value.distribution, actionEndpoint: value.actionEndpoint,
    software: [...value.software].sort((a, b) => a.identity.localeCompare(b.identity)),
    smoother: { ...semantics, ...(s.timestampConsumed ? { stamp_smoothed_velocity_with_smoothing_time: stamp } : {}) },
    odometry: s.feedback === 'CLOSED_LOOP' ? odometry ?? null : null,
    topology: stages,
    loadedPlugins: Object.fromEntries(selectorKeys.map(k => [k, [...value.loadedPlugins[k]].sort((a, b) => a.id.localeCompare(b.id))]))
  };
  return { value, issues: [...new Set(issues)], stable, selectors,
    configurationSha256: sha256(canonicalJson(stable)),
    commandSha256: sha256(canonicalJson({ ...value.goal, ...selectors })) };
}

export function compareNav2ReviewInputs(baseline: unknown, changed: unknown) {
  const a = selected(baseline), b = selected(changed);
  if (Date.parse(b.value.observedAt) < Date.parse(a.value.observedAt)) throw new Error('changed_nav2_observation_precedes_baseline');
  const expected = { ...a.stable, goalSelectors: a.selectors, commandSha256: a.commandSha256 };
  const observed = { ...b.stable, goalSelectors: b.selectors, commandSha256: b.commandSha256 };
  const differences = Object.keys(expected).filter(k => canonicalJson(expected[k as keyof typeof expected]) !== canonicalJson(observed[k as keyof typeof observed]))
    .map(group => ({ group, expected: expected[group as keyof typeof expected], observed: observed[group as keyof typeof observed] }));
  return {
    schemaVersion: 1, kind: 'RlsokNav2LocalReview' as const,
    result: a.issues.length || b.issues.length ? 'INCOMPLETE' as const : differences.length ? 'REVIEW_REQUIRED' as const : 'MATCH' as const,
    hardwareDispatch: 'NO' as const, createsApproval: false, liveGraphVerified: false,
    baseline: { source: a.value.inputSource, observedAt: a.value.observedAt, configurationSha256: a.configurationSha256, commandSha256: a.commandSha256, issues: a.issues },
    changed: { source: b.value.inputSource, observedAt: b.value.observedAt, configurationSha256: b.configurationSha256, commandSha256: b.commandSha256, issues: b.issues },
    differences,
    boundary: 'Historical comparison of supplied selected facts and an exact local goal sample. MATCH is not execution permission, physical-envelope validation, authenticated ROS topology, a Nav2 adapter or a stop command. OPEN_LOOP is command-space only.'
  };
}

export function nav2ReviewMarkdown(report: ReturnType<typeof compareNav2ReviewInputs>): string {
  return `# Nav2 local review: ${report.result}\n\n${report.boundary}\n\nHardware dispatch: NO. No approval created.\n\n` +
    `Baseline issues: ${report.baseline.issues.join(', ') || 'none in selected input'}\n\nChanged issues: ${report.changed.issues.join(', ') || 'none in selected input'}\n\n` +
    report.differences.map(d => `## ${d.group}\n\nExpected / observed:\n\n\`\`\`json\n${JSON.stringify({ expected: d.expected, observed: d.observed }, null, 2)}\n\`\`\`\n`).join('\n');
}
