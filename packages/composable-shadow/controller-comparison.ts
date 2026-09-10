import { readControllerExport, type ControllerExport } from './controller-state';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Explain two real exports. This is historical comparison, not a new approval. */
export async function compareControllerExports(baselineInput: unknown, changedInput: unknown) {
  const baseline = await readControllerExport(baselineInput);
  const changed = await readControllerExport(changedInput);
  if (canonical(baseline.configuration.source) !== canonical(changed.configuration.source)) throw new Error('controller_comparison_requires_same_source');
  if (Date.parse(changed.observedAt) < Date.parse(baseline.observedAt)) throw new Error('changed_controller_export_precedes_baseline');
  const differences: { group: string; before: unknown; after: unknown }[] = [];
  const add = (group: string, before: unknown, after: unknown) => {
    if (canonical(before) !== canonical(after)) differences.push({ group, before, after });
  };
  const select = (e: ControllerExport) => e.configuration;
  const a = select(baseline), b = select(changed);
  add('controller', a.controller, b.controller);
  add('action-endpoints', a.actionServers, b.actionServers);
  for (const key of [...new Set([...Object.keys(a.parameters), ...Object.keys(b.parameters)])].sort()) {
    add(`parameter:${key}`, a.parameters[key] ?? null, b.parameters[key] ?? null);
  }
  return { schemaVersion: 1, kind: 'RlsokControllerComparison', source: a.source,
    baselineObservedAt: baseline.observedAt, changedObservedAt: changed.observedAt,
    baselineConfigurationSha256: baseline.configurationSha256, changedConfigurationSha256: changed.configurationSha256,
    configurationMatches: baseline.configurationSha256 === changed.configurationSha256, differences,
    scope: 'Historical, self-attested ROS software exports. No approval, motion command, hardware attestation or freshness decision is produced.' };
}

export function controllerComparisonMarkdown(report: Awaited<ReturnType<typeof compareControllerExports>>): string {
  const jsonBlock = (value: unknown) => JSON.stringify(value, null, 2).split('\n').map(line => `    ${line}`).join('\n');
  return `# Controller configuration comparison\n\nConfiguration ${report.configurationMatches ? 'matches' : 'changed'}.\n\nBaseline: ${report.baselineObservedAt}\n\nChanged: ${report.changedObservedAt}\n\n${report.scope}\n\n` +
    report.differences.map(d => `## ${d.group.replace(/[\r\n]/g, ' ')}\n\nBefore:\n\n${jsonBlock(d.before)}\n\nAfter:\n\n${jsonBlock(d.after)}\n`).join('\n');
}
