import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { atPointer, topicFieldRuleSchema } from './contracts';
import { validateScalarFieldRules } from './checks/topic';

const MAX_BYTES = 8 * 1024 * 1024;
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const parserId = z.enum(['json-records/v1', 'yaml-records/v1']);
const rules = z.array(topicFieldRuleSchema).min(1).max(32);

export const localDataTemplateSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('RlsokLocalDataTemplate'),
  metadata: z.object({ id, version: z.string().regex(/^\d+\.\d+\.\d+$/), name: z.string().trim().min(1).max(160) }).strict(),
  check: z.object({ plugin: z.literal('scalar-fields/v1'), rules }).strict(),
  composedFrom: z.array(z.object({ id, version: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict()).max(16).optional()
}).strict().superRefine((value, context) => {
  const pointers = value.check.rules.map(rule => rule.pointer);
  if (new Set(pointers).size !== pointers.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate_local_data_rule_pointer' });
});
export type LocalDataTemplate = z.infer<typeof localDataTemplateSchema>;

export const localDataWorkspaceSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('RlsokLocalDataWorkspace'),
  source: z.object({ plugin: z.literal('local-file/v1'), fileName: z.string().min(1).max(256).refine(value => !/[\\/\u0000-\u001f]/.test(value)), preparedSha256: digest }).strict(),
  parser: z.object({ plugin: parserId }).strict(),
  check: z.object({ plugin: z.literal('scalar-fields/v1'), template: localDataTemplateSchema }).strict(),
  machine: z.object({ deviceId: id }).strict(),
  semanticsConfirmed: z.literal(true)
}).strict();
export type LocalDataWorkspace = z.infer<typeof localDataWorkspaceSchema>;

function boundedDocument(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) value = [value];
  if ((value as unknown[]).length === 0 || (value as unknown[]).length > 10_000) throw new Error('local_data_requires_1_to_10000_records');
  const records = value as unknown[];
  const pending: Array<[unknown, number]> = records.map(record => [record, 0]);
  const seen = new Set<object>();
  let nodes = 0;
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (++nodes > 100_000 || depth > 48) throw new Error('local_data_structure_exceeds_limits');
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) continue;
    if (!item || typeof item !== 'object' || seen.has(item)) throw new Error('local_data_value_or_alias_invalid');
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > 10_000) throw new Error('local_data_array_exceeds_limit');
      pending.push(...item.map(child => [child, depth + 1] as [unknown, number]));
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error('local_data_plain_objects_only');
      const entries = Object.entries(item);
      if (entries.length > 512) throw new Error('local_data_object_exceeds_512_fields');
      pending.push(...entries.map(([, child]) => [child, depth + 1] as [unknown, number]));
    }
  }
  if (records.some(record => !record || typeof record !== 'object' || Array.isArray(record))) throw new Error('local_data_records_must_be_objects');
  return records as Array<Record<string, unknown>>;
}

export function readLocalFileSource(filePath: string): { fileName: string; bytes: Buffer; sha256: string } {
  if (typeof filePath !== 'string' || !filePath || !statSync(filePath).isFile() || statSync(filePath).size > MAX_BYTES)
    throw new Error('local_data_source_must_be_file_under_8MiB');
  const bytes = readFileSync(filePath);
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('local_data_source_must_be_nonempty_under_8MiB');
  return { fileName: basename(filePath), bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function parseLocalData(parser: z.infer<typeof parserId>, bytes: Uint8Array): Array<Record<string, unknown>> {
  parserId.parse(parser);
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('local_data_source_must_be_nonempty_under_8MiB');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let value: unknown;
  if (parser === 'json-records/v1') value = JSON.parse(source);
  else value = yaml.load(source, { json: true });
  return boundedDocument(value);
}

export function inspectLocalData(parser: z.infer<typeof parserId>, bytes: Uint8Array) {
  const records = parseLocalData(parser, bytes);
  const fields: Array<{ pointer: string; type: 'number' | 'integer' | 'string' | 'boolean' }> = [];
  const visit = (value: unknown, pointer: string, depth: number): void => {
    if (fields.length >= 512 || depth > 16) return;
    if (Array.isArray(value)) { if (value.length) visit(value[0], `${pointer}/0`, depth + 1); return; }
    if (value && typeof value === 'object') {
      for (const [name, child] of Object.entries(value)) {
        visit(child, `${pointer}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`, depth + 1);
        if (fields.length >= 512) break;
      }
      return;
    }
    if (pointer && typeof value === 'string') fields.push({ pointer, type: 'string' });
    else if (pointer && typeof value === 'boolean') fields.push({ pointer, type: 'boolean' });
    else if (pointer && typeof value === 'number') fields.push({ pointer, type: Number.isSafeInteger(value) ? 'integer' : 'number' });
  };
  visit(records[0], '', 0);
  return { schemaVersion: 1 as const, kind: 'RlsokLocalDataInspection' as const,
    sourcePlugin: 'local-file/v1' as const, parserPlugin: parser, checkPlugin: 'scalar-fields/v1' as const,
    records: records.length, fields, sha256: createHash('sha256').update(bytes).digest('hex'),
    limitations: ['Field structure and sample values do not establish units, meaning, producer identity or active hardware state.'] };
}

export function composeLocalDataTemplates(inputs: unknown[]): LocalDataTemplate {
  if (!inputs.length || inputs.length > 16) throw new Error('local_data_composition_requires_1_to_16_fragments');
  const fragments = inputs.map(input => localDataTemplateSchema.parse(input));
  const combined = fragments.flatMap(fragment => fragment.check.rules);
  if (combined.length > 32 || new Set(combined.map(rule => rule.pointer)).size !== combined.length)
    throw new Error('local_data_fragment_rules_exceed_limit_or_overlap');
  return localDataTemplateSchema.parse({ schemaVersion: 1, kind: 'RlsokLocalDataTemplate',
    metadata: fragments.length === 1 ? fragments[0]!.metadata : { id: 'composed-local-data', version: '1.0.0', name: 'Composed local data checks' },
    check: { plugin: 'scalar-fields/v1', rules: combined },
    composedFrom: fragments.map(fragment => ({ id: fragment.metadata.id, version: fragment.metadata.version })) });
}

export function prepareLocalDataWorkspace(input: {
  templates: unknown[]; parser: z.infer<typeof parserId>; fileName: string; bytes: Uint8Array;
  deviceId: string; semanticsConfirmed: boolean; metadata?: LocalDataTemplate['metadata'];
}): LocalDataWorkspace {
  const composed = composeLocalDataTemplates(input.templates);
  const template = input.metadata ? localDataTemplateSchema.parse({ ...composed, metadata: input.metadata }) : composed;
  const records = parseLocalData(input.parser, input.bytes);
  for (const rule of template.check.rules) if (atPointer(records[0], rule.pointer) === undefined)
    throw new Error(`local_data_field_absent_from_first_record:${rule.pointer}`);
  const workspace = localDataWorkspaceSchema.parse({ schemaVersion: 1, kind: 'RlsokLocalDataWorkspace',
    source: { plugin: 'local-file/v1', fileName: input.fileName,
      preparedSha256: createHash('sha256').update(input.bytes).digest('hex') },
    parser: { plugin: input.parser }, check: { plugin: 'scalar-fields/v1', template },
    machine: { deviceId: input.deviceId }, semanticsConfirmed: input.semanticsConfirmed });
  return workspace;
}

export function evaluateLocalDataWorkspace(workspaceInput: unknown, bytes: Uint8Array, currentFileName?: string) {
  const workspace = localDataWorkspaceSchema.parse(workspaceInput);
  const fileName = currentFileName ?? workspace.source.fileName;
  if (!z.string().min(1).max(256).refine(value => !/[\\/\u0000-\u001f]/.test(value)).safeParse(fileName).success)
    throw new Error('invalid_local_data_filename');
  const records = parseLocalData(workspace.parser.plugin, bytes);
  const violations: Array<{ record: number; reason: string }> = [];
  for (let index = 0; index < records.length; index += 1) {
    const reason = validateScalarFieldRules(workspace.check.template.check.rules, records[index]!, 'local_data_field');
    if (reason && violations.length < 64) violations.push({ record: index + 1, reason });
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { schemaVersion: 1 as const, kind: 'RlsokLocalDataCheck' as const,
    decision: violations.length ? 'LOCAL_DATA_BLOCK' as const : 'LOCAL_DATA_MATCH' as const,
    source: { plugin: workspace.source.plugin, fileName, preparedFileName: workspace.source.fileName,
      sha256, matchesPreparedBytes: sha256 === workspace.source.preparedSha256 },
    parser: workspace.parser.plugin, check: workspace.check.plugin,
    template: { id: workspace.check.template.metadata.id, version: workspace.check.template.metadata.version },
    deviceId: workspace.machine.deviceId, recordsChecked: records.length, violations,
    hardwareSignalSent: false as const, controllerGoalsAttempted: 0 as const,
    limitations: ['Local file content only; device ID, file origin, units and physical meaning are operator-declared, not authenticated.',
      'Only selected scalar rules are checked; no live transport, active controller state, unselected fields or robot safety is established.'] };
}
