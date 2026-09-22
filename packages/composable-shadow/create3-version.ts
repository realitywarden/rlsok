import { createHash } from 'node:crypto';
import { savedBytes } from './saved-setup';

// Saved text only. No SSH client, ROS node, device driver or subprocess.
const labels = {
  robotId: 'Robot ID', navigationSerialNumber: 'Navigation Serial Number',
  productVersion: 'Product Version', osVersion: 'OS Version',
  bootloaderVersion: 'Bootloader Version', tskFingerprint: 'TSK Fingerprint',
  navBoardRevision: 'Nav board revision', mobilityBootloaderVersion: 'Mobility Bootloader Version',
  mobilityVersion: 'Mobility Version', powerVersion: 'Power Version', safetyVersion: 'Safety Version',
  networkManagerVersion: 'Network Manager Version', localManagerVersion: 'Local Manager Version',
  cloudManagerVersion: 'Cloud Manager Version', schedulerVersion: 'Scheduler Version',
  otaManagerVersion: 'Ota Manager Version', connectivityManagerVersion: 'Connectivity Manager Version',
  buildType: 'Build Type', osBuildDate: 'OS Build Date',
} as const;
export type Create3VersionField = keyof typeof labels;
export const create3VersionFields = Object.keys(labels) as Create3VersionField[];
export const defaultCreate3VersionFields: Create3VersionField[] = [
  'robotId', 'navigationSerialNumber', 'productVersion', 'osVersion',
];
type Field = { state: 'reported' | 'missing' | 'unavailable'; value: string | null };
const unavailable = /^(?:unknown|program not installed|not installed|unavailable|n\/a|none|null|[-?]+)(?:\s*\([^\r\n]*\))?$/i;
const labelKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const lookup = new Map(Object.entries(labels).map(([key, label]) => [labelKey(label), key as Create3VersionField]));
const contextualLabels = new Map([['boot count', 'bootCount'], ['previous os version', 'previousOsVersion']]);

export function selectCreate3VersionFields(value: string | undefined): Create3VersionField[] {
  const fields = value === undefined ? [...defaultCreate3VersionFields] : value.split(',').map(v => v.trim());
  if (!fields.length || fields.some(f => !create3VersionFields.includes(f as Create3VersionField))
      || new Set(fields).size !== fields.length) throw new Error('create3_unique_known_fields_required');
  return fields.sort() as Create3VersionField[];
}

export function parseCreate3Version(bytes: Buffer) {
  if (bytes.length > 128 * 1024) throw new Error('create3_saved_output_exceeds_128KiB');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new Error('create3_control_characters_in_output');
  const fields = Object.fromEntries(create3VersionFields.map(key => [key, { state: 'missing', value: null }])) as Record<Create3VersionField, Field>;
  const context: Record<string, string | null> = {};
  const seen = new Set<string>();
  const issues: Array<{ code: string; line?: number; field?: string }> = [];
  const unparsedLineNumbers: number[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const colon = line.indexOf(':');
    const label = colon < 0 ? '' : labelKey(line.slice(0, colon));
    const key = lookup.get(label);
    const contextual = contextualLabels.get(label);
    if (!key && !contextual) { unparsedLineNumbers.push(index + 1); continue; }
    if (seen.has(label)) { issues.push({ code: 'duplicate_field', field: key ?? contextual, line: index + 1 }); continue; }
    seen.add(label);
    const value = line.slice(colon + 1).trim();
    if (value.length > 2000) { issues.push({ code: 'field_too_long', field: key ?? contextual, line: index + 1 }); continue; }
    const present = Boolean(value) && !unavailable.test(value);
    if (key) fields[key] = { state: present ? 'reported' : 'unavailable', value: present ? value : null };
    else context[contextual!] = present ? value : null;
  }
  // Self-reported product discriminator, not proof of origin or authenticity.
  if (!fields.productVersion.value || !/^create3\+/i.test(fields.productVersion.value))
    issues.push({ code: 'create3_product_version_required', field: 'productVersion' });
  return { inputSha256: createHash('sha256').update(bytes).digest('hex'), fields, context, issues, unparsedLineNumbers };
}

export function compareCreate3Versions(baselineBytes: Buffer, currentBytes: Buffer, selected?: string) {
  const selectedFields = selectCreate3VersionFields(selected);
  const baseline = parseCreate3Version(baselineBytes), current = parseCreate3Version(currentBytes);
  const missing = (['baseline', 'current'] as const).flatMap(side => {
    const parsed = side === 'baseline' ? baseline : current;
    return selectedFields.filter(field => parsed.fields[field].state !== 'reported')
      .map(field => ({ side, field, state: parsed.fields[field].state }));
  });
  const changes = selectedFields.filter(field => baseline.fields[field].state === 'reported'
      && current.fields[field].state === 'reported' && baseline.fields[field].value !== current.fields[field].value)
    .map(field => ({ field, baseline: baseline.fields[field].value, current: current.fields[field].value }));
  const decision = baseline.issues.length || current.issues.length || missing.length ? 'NEEDS_MATERIAL'
    : changes.length ? 'CHANGED' : 'UNCHANGED';
  return {
    schemaVersion: 1, kind: 'RlsokCreate3SavedVersionComparison', scope: 'operator-saved-output-only',
    hardwareDispatch: false, robotContacted: false, authenticatedDevice: false,
    decision, selectedFields, missing, changes, baseline, current,
    limitations: [
      'Only selected reported fields are compared. Unknown, absent or not-installed values never establish a match.',
      'Unselected fields are visible evidence only. Boot count and previous OS version are context, not stable identity.',
      'The baseline is an operator-selected reference file, not an RLSOK approval record or execution authorization.',
      'The saved text has no independently verified source, capture time, freshness or authenticated device binding.',
      'No robot, SSH session, firmware compatibility, physical calibration, motion gate or safety behavior was tested.',
      'Reports contain device identifiers; keep them private. Unparsed lines are not interpreted or echoed.',
    ],
  };
}

export function compareCreate3VersionFiles(baseline: string, current: string, fields?: string) {
  return compareCreate3Versions(savedBytes(baseline), savedBytes(current), fields);
}

export function create3VersionMarkdown(report: ReturnType<typeof compareCreate3Versions>) {
  return `# Create 3 saved version comparison\n\n${report.decision}\n\nNo robot contacted. No hardware dispatch.\n\n`
    + `Selected fields: ${report.selectedFields.join(', ')}.\n\n`
    + `Changed fields: ${report.changes.map(c => c.field).join(', ') || 'none'}.\n\n`
    + report.missing.map(m => `- ${m.side}.${m.field}: ${m.state}`).join('\n') + '\n\n'
    + (['baseline', 'current'] as const).flatMap(side => report[side].issues.map(i => `- ${side}: ${i.code} (${i.field ?? ''})`)).join('\n') + '\n\n'
    + 'See report.json for reported values, unavailable fields and input hashes.\n\n'
    + report.limitations.map(s => `- ${s}`).join('\n') + '\n';
}
