import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export type ProjectFileInspection = {
  name: string; sha256: string; bytes: number;
  kind: 'robot-description' | 'configuration' | 'interface-declaration' | 'selected-file';
  parserPlugin?: string; model?: string; movableJoints?: string[]; needsExpansion?: boolean;
  declaredFields?: Array<{ section: string; type: string; name: string }>;
  planningGroups?: Array<{ name: string; joints: string[]; chains: Array<{ baseLink: string; tipLink: string }> }>;
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

const semanticRobotParser: ProjectParserPlugin = {
  id: 'srdf-structure/v1', accepts: name => /\.srdf$/i.test(name),
  inspect(bytes, result) {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('srdf_dtd_or_entities_not_allowed');
    if (XMLValidator.validate(source) !== true) throw new Error('invalid_semantic_robot_description_xml');
    const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false, processEntities: false }).parse(source);
    if (!parsed?.robot || typeof parsed.robot !== 'object') throw new Error('semantic_robot_description_root_required');
    const robot = parsed.robot as Record<string, unknown>;
    const entries = robot.group === undefined ? [] : Array.isArray(robot.group) ? robot.group : [robot.group];
    if (entries.length > 64) throw new Error('semantic_robot_description_exceeds_64_groups');
    const groups: NonNullable<ProjectFileInspection['planningGroups']> = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const group = entry as Record<string, unknown>;
      const name = group['@_name'];
      if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) continue;
      const jointEntries = group.joint === undefined ? [] : Array.isArray(group.joint) ? group.joint : [group.joint];
      const chainEntries = group.chain === undefined ? [] : Array.isArray(group.chain) ? group.chain : [group.chain];
      if (jointEntries.length > 256 || chainEntries.length > 32) throw new Error('semantic_robot_group_exceeds_limits');
      const joints = jointEntries.map(item => item && typeof item === 'object' ? (item as Record<string, unknown>)['@_name'] : undefined)
        .filter((item): item is string => typeof item === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(item));
      const chains = chainEntries.map(item => item && typeof item === 'object' ? item as Record<string, unknown> : {})
        .filter(item => typeof item['@_base_link'] === 'string' && typeof item['@_tip_link'] === 'string')
        .map(item => ({ baseLink: item['@_base_link'] as string, tipLink: item['@_tip_link'] as string }));
      groups.push({ name, joints, chains });
    }
    result.kind = 'configuration';
    result.model = typeof robot['@_name'] === 'string' ? robot['@_name'] : '';
    result.planningGroups = groups;
    result.warnings.push('SRDF planning groups describe robot semantics, not the active controller or actual command joint order.');
  }
};

const interfaceDeclarationParser: ProjectParserPlugin = {
  id: 'ros-interface-declaration/v1', accepts: name => /\.(?:msg|action|srv|idl)$/i.test(name),
  inspect(bytes, result) {
    result.kind = 'interface-declaration';
    if (bytes.length > 1024 * 1024) throw new Error('interface_declaration_exceeds_1MiB');
    if (/\.idl$/i.test(result.name)) {
      result.declaredFields = [];
      result.warnings.push('IDL source found. Field structure is not parsed here; discover the installed ROS interface and live endpoint.');
      return;
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
    if (lines.length > 8192) throw new Error('interface_declaration_too_many_lines');
    const sections = /\.action$/i.test(result.name) ? ['goal', 'result', 'feedback'] :
      /\.srv$/i.test(result.name) ? ['request', 'response'] : ['message'];
    const fields: NonNullable<ProjectFileInspection['declaredFields']> = [];
    let section = 0, skipped = 0;
    for (const raw of lines) {
      const line = raw.split('#', 1)[0]!.trim();
      if (!line) continue;
      if (line === '---') { if (++section >= sections.length) throw new Error('unexpected_interface_section'); continue; }
      if (line.length > 512) throw new Error('interface_declaration_line_too_long');
      if (/^[^\s]+\s+[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_/<>=\[\]]*)\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(line);
      if (!match) { skipped += 1; continue; }
      if (fields.length >= 256) throw new Error('interface_declaration_exceeds_256_fields');
      fields.push({ section: sections[section]!, type: match[1]!, name: match[2]! });
    }
    result.declaredFields = fields;
    if (skipped) result.warnings.push(String(skipped) + ' declaration lines were not interpreted; inspect the installed ROS type before mapping fields.');
    result.warnings.push('Source declarations do not prove an installed type, interface fingerprint, live endpoint, receiver, units or meaning.');
  }
};

const projectParserPlugins: readonly ProjectParserPlugin[] = [robotDescriptionParser, configurationParser, semanticRobotParser, interfaceDeclarationParser];

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
