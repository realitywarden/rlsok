import { z } from 'zod';
import { catalogInterfaces, catalogSchema, type Catalog } from './onboarding';
import { topicFieldRuleSchema } from './contracts';

const adapterSchema = z.enum(['topic_twist', 'topic_fields', 'joint_trajectory', 'cartesian_pose', 'cartesian_delta', 'cartesian_absolute_wpr', 'tp_program']);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);

export const connectionTemplateSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('RlsokConnectionTemplate'),
  metadata: z.object({ id, name: z.string().min(1).max(160), version: z.string().regex(/^\d+\.\d+\.\d+$/), description: z.string().max(1000), visibility: z.enum(['private', 'contribution-candidate']), createdAt: z.string().datetime({ offset: true }) }).strict(),
  compatibility: z.object({ rosDistro: z.string().min(1).max(64).optional(), paths: z.array(z.object({ id, kind: z.enum(['action', 'topic']), interfaceType: z.string().min(1).max(512), interfaceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()).min(1).max(32) }).strict(),
  defaults: z.object({ model: z.string().max(256).optional(), controller: z.string().max(256).optional(), jointOrder: z.array(z.string().min(1).max(128)).max(256).optional(), maxObservationAgeMs: z.number().int().min(1).max(300000) }).strict(),
  paths: z.array(z.object({ id, kind: z.enum(['action', 'topic']), endpointHint: z.string().max(512).optional(), adapter: adapterSchema, mapping: z.record(z.string().max(65536)), requiresSemanticConfirmation: z.literal(true) }).strict()).min(1).max(32),
  facts: z.array(z.object({ id, kind: z.enum(['file_sha256', 'json_value']), path: z.string().min(1).max(1024), pointer: z.string().max(1024).optional() }).strict()).min(1).max(64),
  contribution: z.object({ terms: z.literal('separate-contribution-agreement-required'), status: z.literal('not-submitted') }).strict().optional(),
}).strict().superRefine((value, context) => {
  const declared = value.compatibility.paths.map(path => path.id);
  const configured = value.paths.map(path => path.id);
  if (new Set(declared).size !== declared.length || new Set(configured).size !== configured.length || declared.length !== configured.length || declared.some(pathId => !configured.includes(pathId))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Template compatibility and configured path IDs must match exactly.' });
  }
  if (new Set(value.facts.map(fact => fact.id)).size !== value.facts.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Template fact IDs must be unique.' });
  for (const path of value.paths) {
    const declaredKind = value.compatibility.paths.find(item => item.id === path.id)?.kind;
    if (declaredKind !== path.kind || (path.kind === 'topic') !== ['topic_twist', 'topic_fields'].includes(path.adapter))
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Template path kind and adapter disagree: ${path.id}` });
    if (path.adapter === 'topic_fields' && path.mapping.rulesJson?.trim()) {
      let rules: unknown;
      try { rules = JSON.parse(path.mapping.rulesJson); }
      catch { context.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid topic field rules JSON: ${path.id}` }); continue; }
      const parsed = z.array(topicFieldRuleSchema).min(1).max(32).safeParse(rules);
      if (!parsed.success || new Set(parsed.data.map(rule => rule.pointer)).size !== parsed.data.length)
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid topic field rules: ${path.id}` });
    }
  }
});

export type ConnectionTemplate = z.infer<typeof connectionTemplateSchema>;

function allocateTemplateItemId(preferred: string, fragmentId: string, used: Set<string>): string {
  for (const candidate of [preferred, `${fragmentId}.${preferred}`]) {
    const value = candidate.slice(0, 128);
    if (!used.has(value)) { used.add(value); return value; }
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const tail = `-${suffix}`;
    const value = `${fragmentId}.${preferred}`.slice(0, 128 - tail.length) + tail;
    if (!used.has(value)) { used.add(value); return value; }
  }
  throw new Error('template_item_id_exhausted');
}

export function composeConnectionTemplates(inputs: unknown[]): ConnectionTemplate {
  if (!inputs.length || inputs.length > 16) throw new Error('template_composition_requires_1_to_16_fragments');
  const fragments = inputs.map(input => connectionTemplateSchema.parse(input));
  const distributions = [...new Set(fragments.map(fragment => fragment.compatibility.rosDistro).filter((value): value is string => !!value))];
  if (distributions.length > 1) throw new Error(`template_ros_distro_conflict:${distributions.join(',')}`);
  const usedPaths = new Set<string>(), usedFacts = new Set<string>(), factKeys = new Set<string>();
  const compatibilityPaths: ConnectionTemplate['compatibility']['paths'] = [];
  const paths: ConnectionTemplate['paths'] = [], facts: ConnectionTemplate['facts'] = [];
  let defaults: ConnectionTemplate['defaults'] = { maxObservationAgeMs: 30000 };
  for (const fragment of fragments) {
    const pathIds = new Map<string, string>();
    for (const requirement of fragment.compatibility.paths) {
      const id = allocateTemplateItemId(requirement.id, fragment.metadata.id, usedPaths);
      pathIds.set(requirement.id, id);
      compatibilityPaths.push({ ...requirement, id });
    }
    paths.push(...fragment.paths.map(path => ({ ...path, id: pathIds.get(path.id)! })));
    for (const fact of fragment.facts) {
      const key = `${fact.kind}|${fact.path}|${fact.pointer ?? ''}`;
      if (factKeys.has(key)) continue;
      factKeys.add(key);
      facts.push({ ...fact, id: allocateTemplateItemId(fact.id, fragment.metadata.id, usedFacts) });
    }
    defaults = { ...defaults, ...fragment.defaults };
  }
  if (paths.length > 32) throw new Error('template_composition_exceeds_32_paths');
  if (facts.length > 64) throw new Error('template_composition_exceeds_64_facts');
  return connectionTemplateSchema.parse({ schemaVersion: 1, kind: 'RlsokConnectionTemplate',
    metadata: { id: 'composed-template', name: fragments.length === 1 ? fragments[0]!.metadata.name : `${fragments.length} composed fragments`, version: '1.0.0',
      description: `Locally composed from ${fragments.map(fragment => `${fragment.metadata.id}@${fragment.metadata.version}`).join(', ')}.`.slice(0, 1000), visibility: 'private', createdAt: new Date().toISOString() },
    compatibility: { ...(distributions[0] ? { rosDistro: distributions[0] } : {}), paths: compatibilityPaths }, defaults, paths, facts });
}

export function planConnectionTemplate(templateInput: unknown, catalogInput: unknown) {
  const template = connectionTemplateSchema.parse(templateInput);
  const catalog: Catalog = catalogSchema.parse(catalogInput);
  const available = catalogInterfaces(catalog).filter(item => !item.unavailable);
  const paths = template.compatibility.paths.map(requirement => {
    const configured = template.paths.find(path => path.id === requirement.id)!;
    const matching = available.filter(item => item.kind === requirement.kind && item.interfaceType === requirement.interfaceType && (!requirement.interfaceSha256 || item.interfaceSha256 === requirement.interfaceSha256));
    const unusableActionServers = matching.filter(item => item.kind === 'action' && item.serverCount !== 1).map(item => item.endpoint);
    const unusableTopicReceivers = matching.filter(item => item.kind === 'topic' && !item.subscribers.some(node => node.count === 1)).map(item => item.endpoint);
    const candidates = matching.filter(item => item.kind === 'action' ? item.serverCount === 1 : item.subscribers.some(node => node.count === 1));
    const hinted = candidates.find(item => item.endpoint === configured.endpointHint);
    const selected = hinted ?? (candidates.length === 1 ? candidates[0] : undefined);
    return { id: requirement.id, adapter: configured.adapter, interfaceType: requirement.interfaceType,
      status: selected ? 'MATCHED' as const : matching.length ? 'AMBIGUOUS' as const : 'MISSING' as const,
      selectedEndpoint: selected?.endpoint ?? null, candidates: candidates.map(item => item.endpoint), unusableActionServers, unusableTopicReceivers,
      requiresSemanticConfirmation: true as const };
  });
  const distroMatched = !template.compatibility.rosDistro || template.compatibility.rosDistro === catalog.environment.rosDistro;
  return { schemaVersion: 1 as const, kind: 'RlsokTemplatePlan' as const, template: { id: template.metadata.id, version: template.metadata.version },
    catalogObservedAt: catalog.observedAt, distroMatched, readyForConfiguration: distroMatched && paths.every(path => path.status === 'MATCHED'), paths,
    missingInputs: ['configuration ID', 'device ID', 'real example goal or message for every path', 'actual robot description and selected fact files', 'explicit confirmation of meanings, units and frames'],
    hardwareSignalSent: false as const };
}
