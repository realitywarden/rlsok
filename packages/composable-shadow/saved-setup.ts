import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { JSON_SCHEMA, load } from 'js-yaml';
import { z } from 'zod';

// Configuration review only. This module neither imports robot drivers nor
// opens device nodes, ROS endpoints, sockets, cameras or serial/CAN interfaces.
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const name = z.string().trim().min(1).max(300);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const kind = z.enum(['camera', 'can', 'serial']);
const identity = z.object({
  basis: z.enum(['serial', 'usb-path']), id: name,
  interface: name.optional(), videoIndex: name.optional(),
}).strict();
export const setupBindingSchema = z.object({
  role: name, kind, identity,
  uses: z.array(z.object({ file: name, pointer: z.string().startsWith('/').max(1000) }).strict()).min(1).max(50),
}).strict();
export const setupManifestSchema = z.object({
  schemaVersion: z.literal(1), id: name,
  source: z.object({ repository: name, commit: z.string().regex(/^[a-f0-9]{40}$/) }).strict(),
  scope: z.literal('saved-configuration-only'),
  files: z.array(z.object({ id: name, path: name, format: z.enum(['json', 'yaml', 'text']) }).strict()).min(1).max(80),
  bindings: z.array(setupBindingSchema).max(30),
}).strict();
export type SetupManifest = z.infer<typeof setupManifestSchema>;
export const setupInventorySchema = z.object({
  schemaVersion: z.literal(1), observedAt: z.string().datetime({ offset: true }),
  method: z.enum(['linux-sysfs-udev', 'operator-export']),
  devices: z.array(z.object({
    kind, locator: name, aliases: z.array(name).max(30),
    serial: name.optional(), usbPath: name.optional(),
    interface: name.optional(), videoIndex: name.optional(),
  }).strict()).max(500),
  warnings: z.array(name).max(500),
}).strict();

/** Reject non-JSON YAML types, cycles/alias expansion and oversized trees. */
export function savedJson(value: unknown): Json {
  let nodes = 0;
  const visit = (item: unknown, depth: number): Json => {
    if (++nodes > 100_000 || depth > 60) throw new Error('setup_document_too_complex');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(v => visit(v, depth + 1));
    if (item && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      const out: Record<string, Json> = Object.create(null);
      for (const key of Object.keys(item).sort()) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('setup_reserved_key');
        out[key] = visit((item as Record<string, unknown>)[key], depth + 1);
      }
      // A normal object is returned for subsequent validation/serialization.
      return { ...out };
    }
    throw new Error('setup_document_must_contain_only_json_values');
  };
  return visit(value, 0);
}
export function setupHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(savedJson(value))).digest('hex');
}
export function savedBytes(path: string): Buffer {
  if (!lstatSync(path).isFile()) throw new Error(`setup_regular_file_required:${path}`);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error(`setup_regular_file_under_8MiB_required:${path}`);
    const bytes = readFileSync(fd);
    if (bytes.length > 8 * 1024 * 1024) throw new Error('setup_file_grew_too_large');
    return bytes;
  } finally { closeSync(fd); }
}
export function savedDocument(path: string, format: 'json' | 'yaml' | 'text'): Json {
  return parseSaved(savedBytes(path), format);
}
function parseSaved(bytes: Buffer, format: 'json' | 'yaml' | 'text'): Json {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (format === 'text') return text;
  if (format === 'json') JSON.parse(text); // Require JSON syntax as well as unique keys.
  // json:false deliberately rejects duplicate YAML/JSON mapping keys.
  return savedJson(load(text, { schema: JSON_SCHEMA, json: false }));
}
function pointerSlot(document: Json, pointer: string): { object: Record<string, Json>; key: string } {
  const parts = pointer.slice(1).split('/').map(part => {
    if (/~(?![01])/u.test(part)) throw new Error('setup_invalid_json_pointer');
    return part.replace(/~1/g, '/').replace(/~0/g, '~');
  });
  let current: Json = document;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)
      || (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/.test(key))) throw new Error(`setup_pointer_missing:${pointer}`);
    if (i === parts.length - 1) return { object: current as Record<string, Json>, key };
    current = (current as Record<string, Json>)[key];
  }
  throw new Error('setup_empty_pointer');
}
function unique(values: string[], reason: string): void {
  if (new Set(values).size !== values.length) throw new Error(reason);
}
const jsonSchema = z.unknown().transform(savedJson);
const observationSchema = z.object({
  schemaVersion: z.literal(1), id: name, observedAt: z.string().datetime({ offset: true }),
  scope: z.literal('saved-configuration-only'), hardwareDispatch: z.literal(false),
  status: z.enum(['READY_FOR_REVIEW', 'NEEDS_MATERIAL']), issues: z.array(z.string()),
  semantic: jsonSchema,
  files: z.array(z.object({ id: name, path: name, sha256: sha }).strict()),
  resolvedBindings: z.array(z.object({ role: name, kind, identity, locator: name, aliases: z.array(name) }).strict()),
  inventory: z.object({ observedAt: z.string(), method: z.string(), warnings: z.array(z.string()) }).strict().nullable(),
  snapshotHash: sha,
}).strict();
type Observation = z.infer<typeof observationSchema>;
function checkedObservation(value: unknown): Observation {
  const observation = observationSchema.parse(value);
  const { snapshotHash, ...body } = observation;
  if (setupHash(body) !== snapshotHash) throw new Error('setup_snapshot_hash_mismatch');
  if ((observation.status === 'READY_FOR_REVIEW') !== (observation.issues.length === 0)) throw new Error('setup_inconsistent_status');
  return observation;
}

export function captureSavedSetup(manifestValue: unknown, manifestPath: string, inventoryValue?: unknown): Observation {
  const manifest = setupManifestSchema.parse(manifestValue);
  unique(manifest.files.map(f => f.id), 'setup_duplicate_file_id');
  unique(manifest.bindings.map(b => b.role), 'setup_duplicate_role');
  const documents: Record<string, Json> = {};
  const files = manifest.files.map(file => {
    if (['__proto__', 'constructor', 'prototype'].includes(file.id)) throw new Error('setup_reserved_file_id');
    const path = resolve(dirname(manifestPath), file.path);
    const bytes = savedBytes(path);
    documents[file.id] = parseSaved(bytes, file.format);
    return { id: file.id, path, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  const inventory = inventoryValue === undefined ? undefined : setupInventorySchema.parse(inventoryValue);
  if (manifest.bindings.length && !inventory) throw new Error('setup_inventory_required_for_device_bindings');
  if (inventory) unique(inventory.devices.map(d => `${d.kind}:${d.locator}`), 'setup_duplicate_inventory_endpoint');
  const issues: string[] = [];
  const occupied = new Set<string>();
  const replaced = new Set<string>();
  const resolvedBindings: Observation['resolvedBindings'] = [];
  for (const binding of manifest.bindings) {
    const wanted = binding.identity;
    const matches = inventory!.devices.filter(d => d.kind === binding.kind
      && (wanted.basis === 'serial' ? d.serial === wanted.id : d.usbPath === wanted.id)
      && (wanted.interface === undefined || d.interface === wanted.interface)
      && (wanted.videoIndex === undefined || d.videoIndex === wanted.videoIndex));
    if (matches.length !== 1) {
      issues.push(`${binding.role}: ${matches.length ? 'ambiguous_identity' : 'identity_not_found'} (${matches.length} matches)`);
      continue;
    }
    const device = matches[0];
    const key = `${device.kind}:${device.locator}`;
    if (occupied.has(key)) { issues.push(`${binding.role}: endpoint_already_assigned`); continue; }
    occupied.add(key);
    resolvedBindings.push({ role: binding.role, kind: binding.kind, identity: wanted, locator: device.locator, aliases: device.aliases });
    for (const use of binding.uses) {
      const slotKey = `${use.file}:${use.pointer}`;
      if (replaced.has(slotKey)) throw new Error('setup_duplicate_binding_pointer');
      replaced.add(slotKey);
      const document = documents[use.file];
      if (document === undefined || manifest.files.find(f => f.id === use.file)?.format === 'text') throw new Error('setup_binding_requires_structured_file');
      const { object, key: field } = pointerSlot(document, use.pointer);
      const value = object[field];
      // Numeric camera indices and explicit saved /dev paths are compared only
      // against this inventory's observed aliases, never against the selector.
      if (!['string', 'number'].includes(typeof value) || ![device.locator, ...device.aliases].includes(String(value))) {
        issues.push(`${binding.role}: configured_locator_does_not_match_identity at ${slotKey}`);
        continue;
      }
      object[field] = { rlsokDeviceRole: binding.role, kind: binding.kind, identity: { ...wanted } };
    }
  }
  const body = {
    schemaVersion: 1 as const, id: manifest.id, observedAt: new Date().toISOString(),
    scope: 'saved-configuration-only' as const, hardwareDispatch: false as const,
    status: issues.length ? 'NEEDS_MATERIAL' as const : 'READY_FOR_REVIEW' as const, issues,
    semantic: savedJson({ source: manifest.source, files: documents, bindings: manifest.bindings }),
    files, resolvedBindings,
    inventory: inventory ? { observedAt: inventory.observedAt, method: inventory.method, warnings: inventory.warnings } : null,
  };
  return { ...body, snapshotHash: setupHash(body) };
}

/** Explicitly project reviewed identities into NEW config copies after replug.
 * This is separate from capture: capture must detect a wrong/stale selector,
 * whereas resolution intentionally edits the marked locators in copies only.
 */
export function resolveSavedSetup(manifestValue: unknown, manifestPath: string, inventoryValue: unknown, output: string) {
  const manifest = setupManifestSchema.parse(manifestValue);
  const inventory = setupInventorySchema.parse(inventoryValue);
  if (existsSync(output)) throw new Error('output_already_exists');
  unique(manifest.files.map(f => f.id), 'setup_duplicate_file_id');
  unique(manifest.bindings.map(b => b.role), 'setup_duplicate_role');
  unique(inventory.devices.map(d => `${d.kind}:${d.locator}`), 'setup_duplicate_inventory_endpoint');
  const documents = new Map(manifest.files.map(f => [f.id, savedDocument(resolve(dirname(manifestPath), f.path), f.format)]));
  const occupied = new Set<string>(), pointers = new Set<string>();
  const edits: Array<{ role: string; file: string; pointer: string; before: Json; after: Json }> = [];
  for (const binding of manifest.bindings) {
    const wanted = binding.identity;
    const matches = inventory.devices.filter(d => d.kind === binding.kind
      && (wanted.basis === 'serial' ? d.serial === wanted.id : d.usbPath === wanted.id)
      && (wanted.interface === undefined || d.interface === wanted.interface)
      && (wanted.videoIndex === undefined || d.videoIndex === wanted.videoIndex));
    if (matches.length !== 1) throw new Error(`setup_identity_not_unique:${binding.role}:${matches.length}`);
    const device = matches[0], key = `${device.kind}:${device.locator}`;
    if (occupied.has(key)) throw new Error(`setup_endpoint_already_assigned:${binding.role}`);
    occupied.add(key);
    for (const use of binding.uses) {
      const pointerKey = `${use.file}:${use.pointer}`;
      if (pointers.has(pointerKey)) throw new Error('setup_duplicate_binding_pointer');
      pointers.add(pointerKey);
      const document = documents.get(use.file);
      if (document === undefined || manifest.files.find(f => f.id === use.file)?.format === 'text') throw new Error('setup_binding_requires_structured_file');
      const { object, key: field } = pointerSlot(document, use.pointer);
      const before = object[field];
      if (!['string', 'number'].includes(typeof before)) throw new Error('setup_locator_must_be_string_or_number');
      let after: Json = device.locator;
      // Preserve argparse integer camera inputs. Never choose an arbitrary
      // number when a non-Linux export cannot supply a unique numeric alias.
      if (typeof before === 'number') {
        const numeric = device.aliases.filter(alias => /^(0|[1-9][0-9]*)$/.test(alias));
        if (binding.kind !== 'camera' || numeric.length !== 1 || !Number.isSafeInteger(Number(numeric[0]))) throw new Error('setup_unique_camera_index_required');
        after = Number(numeric[0]);
      }
      object[field] = after;
      edits.push({ role: binding.role, file: use.file, pointer: use.pointer, before, after });
    }
  }
  // JSON is a YAML subset; normalize structured output to JSON without
  // dropping any other parameters. Original files are never overwritten.
  const resolvedFiles = manifest.files.map((file, i) => ({ ...file,
    path: `${i.toString().padStart(2, '0')}-resolved.${file.format === 'text' ? 'txt' : 'json'}`,
    format: file.format === 'text' ? 'text' as const : 'json' as const }));
  mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const file of resolvedFiles) writeFileSync(join(output, file.path),
    file.format === 'text' ? String(documents.get(file.id)) : JSON.stringify(documents.get(file.id), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const next = { ...manifest, files: resolvedFiles };
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(output, 'resolution.json'), JSON.stringify({ schemaVersion: 1, scope: 'saved-configuration-only',
    hardwareDispatch: false, inventoryObservedAt: inventory.observedAt, edits,
    note: 'Review these copies; no live configuration was changed or run.' }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { directory: resolve(output), manifest: join(resolve(output), 'manifest.json'), edits };
}

const approvalSchema = z.object({
  schemaVersion: z.literal(1), scope: z.literal('saved-configuration-only'),
  actor: name, approvedAt: z.string().datetime({ offset: true }),
  baseline: observationSchema, approvalHash: sha,
}).strict();
export function approveSavedSetup(value: unknown, actor: string) {
  const baseline = checkedObservation(value);
  if (baseline.status !== 'READY_FOR_REVIEW') throw new Error('setup_cannot_approve_unresolved_bindings');
  const body = { schemaVersion: 1 as const, scope: 'saved-configuration-only' as const,
    actor: name.parse(actor), approvedAt: new Date().toISOString(), baseline };
  return { ...body, approvalHash: setupHash(body) };
}
function changedPaths(a: Json, b: Json, path = ''): string[] {
  if (setupHash(a) === setupHash(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const left = a as Record<string, Json>, right = b as Record<string, Json>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap(key => {
      const next = `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      return Object.hasOwn(left, key) && Object.hasOwn(right, key) ? changedPaths(left[key], right[key], next) : [next];
    });
  }
  return [path || '/'];
}
export function reviewSavedSetup(approvalValue: unknown, observationValue: unknown) {
  const approval = approvalSchema.parse(approvalValue);
  const { approvalHash, ...body } = approval;
  if (setupHash(body) !== approvalHash) throw new Error('setup_approval_hash_mismatch');
  const baseline = checkedObservation(approval.baseline);
  if (baseline.status !== 'READY_FOR_REVIEW') throw new Error('setup_invalid_approved_baseline');
  const current = checkedObservation(observationValue);
  if (baseline.id !== current.id) throw new Error('setup_id_mismatch');
  const changes = changedPaths(baseline.semantic, current.semantic);
  const byteChanges = current.files.filter(f => baseline.files.find(old => old.id === f.id)?.sha256 !== f.sha256).map(f => f.id);
  const locatorChanges = current.resolvedBindings.flatMap(b => {
    const old = baseline.resolvedBindings.find(o => o.role === b.role);
    return old && old.locator !== b.locator ? [{ role: b.role, before: old.locator, after: b.locator }] : [];
  });
  return {
    schemaVersion: 1, id: current.id, scope: 'saved-configuration-only', hardwareDispatch: false,
    decision: current.issues.length ? 'NEEDS_MATERIAL' : changes.length ? 'REVIEW_REQUIRED' : 'UNCHANGED',
    baselineHash: baseline.snapshotHash, currentHash: current.snapshotHash,
    changes, issues: current.issues, byteChanges, locatorChanges,
    limitations: ['Saved files and enumeration are self-attested, not active robot state.',
      'USB path binds a port/topology, not a physical unit. Replacing a unit on that port needs operator review.',
      'An unchanged report is not permission to move, live compatibility, a command gate or customer acceptance.'],
  };
}
export function savedSetupMarkdown(report: ReturnType<typeof reviewSavedSetup>): string {
  return `# Saved configuration review\n\n${report.decision} · ${report.id}\n\nHardware dispatch: **none**.\n\n`
    + `Semantic changes:\n${report.changes.map(p => `- ${p}`).join('\n') || '- None in the selected scope.'}\n\n`
    + `Unresolved bindings:\n${report.issues.map(p => `- ${p}`).join('\n') || '- None.'}\n\n`
    + `Device renumbering:\n${report.locatorChanges.map(p => `- ${p.role}: ${p.before} → ${p.after}`).join('\n') || '- None observed.'}\n\n`
    + `Changed file bytes: ${report.byteChanges.join(', ') || 'none'} (formatting and resolved aliases can change without a semantic change).\n\n`
    + report.limitations.map(p => `- ${p}`).join('\n') + '\n';
}
