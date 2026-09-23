import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export type ProjectFileInspection = {
  name: string; sha256: string; bytes: number;
  kind: 'robot-description' | 'configuration' | 'selected-file';
  parserPlugin?: string; model?: string; movableJoints?: string[]; needsExpansion?: boolean;
  controllerCandidates: string[]; jointOrderCandidates: string[][]; warnings: string[];
};

type ProjectParserPlugin = {
  id: string;
  accepts: (name: string) => boolean;
  inspect: (bytes: Buffer, result: ProjectFileInspection) => void;
};

const robotDescriptionParser: ProjectParserPlugin = {
  id: 'urdf-structure/v1', accepts: name => /\.urdf$/i.test(name),
  inspect(bytes, result) {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('urdf_dtd_or_entities_not_allowed');
    const valid = XMLValidator.validate(source);
    if (valid !== true) throw new Error('invalid_robot_description_xml');
    const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false, processEntities: false }).parse(source);
    if (!parsed?.robot || typeof parsed.robot !== 'object') throw new Error('robot_description_root_required');
    const robot = parsed.robot as Record<string, unknown>;
    const joints = robot.joint === undefined ? [] : Array.isArray(robot.joint) ? robot.joint : [robot.joint];
    const needsExpansion = /<\s*xacro:|\$\{|\$\(/i.test(source);
    result.kind = 'robot-description';
    result.model = typeof robot['@_name'] === 'string' ? robot['@_name'] : '';
    result.movableJoints = needsExpansion ? [] : joints.filter((joint): joint is Record<string, unknown> => !!joint && typeof joint === 'object')
      .filter(joint => joint['@_type'] !== 'fixed' && joint.mimic === undefined)
      .map(joint => joint['@_name']).filter((value): value is string => typeof value === 'string');
    result.needsExpansion = needsExpansion;
    if (needsExpansion) result.warnings.push('Xacro expressions are not expanded. Supply an expanded URDF before using joint names.');
  }
};

const configurationParser: ProjectParserPlugin = {
  id: 'json-yaml-structure/v1', accepts: name => /\.(?:json|ya?ml)$/i.test(name),
  inspect(bytes, result) {
    result.kind = 'configuration';
    let document: unknown;
    try { const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); document = /\.json$/i.test(result.name) ? JSON.parse(source) : yaml.load(source); }
    catch { result.warnings.push('Configuration structure could not be parsed; exact bytes can still be checked.'); return; }
    const pending: Array<[unknown, number]> = [[document, 0]], controllers = new Set<string>(), orders = new Map<string, string[]>();
    let visited = 0;
    while (pending.length) {
      const [value, depth] = pending.pop()!;
      if (++visited > 10000 || depth > 24) { result.warnings.push('Configuration is too deeply nested to inspect.'); break; }
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) { for (const item of value) pending.push([item, depth + 1]); continue; }
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.joints) && record.joints.length > 0 && record.joints.length <= 256 &&
        record.joints.every(item => typeof item === 'string' && !!item && item.length <= 128)) {
        const order = record.joints as string[];
        if (new Set(order).size === order.length) orders.set(order.join('\0'), order);
      }
      for (const [key, item] of Object.entries(record)) {
        if (item && typeof item === 'object' && !Array.isArray(item) &&
          typeof (item as Record<string, unknown>).type === 'string' && (item as Record<string, unknown>).type!.toString().includes('Controller')) controllers.add(key);
        pending.push([item, depth + 1]);
      }
    }
    result.controllerCandidates = [...controllers]; result.jointOrderCandidates = [...orders.values()];
  }
};

const projectParserPlugins: readonly ProjectParserPlugin[] = [robotDescriptionParser, configurationParser];

export function inspectProjectFile(name: string, base64: string): ProjectFileInspection {
  if (typeof name !== 'string' || name.length > 256 || !/^[A-Za-z0-9_. -]+$/.test(name)) throw new Error('invalid_project_filename');
  if (typeof base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('invalid_file_encoding');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > 8 * 1024 * 1024) throw new Error('project_file_exceeds_8MiB');
  const result: ProjectFileInspection = { name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    kind: 'selected-file', controllerCandidates: [], jointOrderCandidates: [], warnings: [] };
  const plugins = projectParserPlugins.filter(plugin => plugin.accepts(name));
  if (plugins.length > 1) throw new Error('ambiguous_project_parser');
  if (plugins[0]) { result.parserPlugin = plugins[0].id; plugins[0].inspect(bytes, result); }
  return result;
}
