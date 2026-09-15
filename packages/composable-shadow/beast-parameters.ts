type ObjectValue = Record<string, unknown>;
const isObject = (value: unknown): value is ObjectValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const escapePointer = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1');

/** Inspect saved root-node YAML only. Never execute launch files or guess overrides. */
export function beastNodeParameters(document: unknown, node: string) {
  const values: ObjectValue = {};
  const pointers: Record<string, string[]> = {};
  const issues: string[] = [];
  const conflicts = new Set<string>();
  if (!isObject(document)) return { values, pointers, issues: ['Expected a parameter-file object.'], selectors: [] as string[] };
  const selectors = ['/**', node, '/' + node].filter(key => Object.hasOwn(document, key));
  for (const key of selectors) {
    const block = document[key];
    const parameters = isObject(block) ? block.ros__parameters : undefined;
    if (!isObject(parameters)) { issues.push(`${key}.ros__parameters must be an object.`); continue; }
    for (const [field, value] of Object.entries(parameters)) {
      (pointers[field] ??= []).push(`/${escapePointer(key)}/ros__parameters/${escapePointer(field)}`);
      if (Object.hasOwn(values, field) && JSON.stringify(values[field]) !== JSON.stringify(value)) {
        conflicts.add(field);
        issues.push(`${node}.${field} has conflicting saved selectors; select one effective file instead of inferring launch precedence.`);
      } else if (!conflicts.has(field)) values[field] = value;
    }
  }
  for (const field of conflicts) { delete values[field]; delete pointers[field]; }
  if (!selectors.length) issues.push(`No /**, ${node} or /${node} parameter block. Namespaced/custom node selections need an explicitly selected effective file.`);
  return { values, pointers, issues, selectors };
}
