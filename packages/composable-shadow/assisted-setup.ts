import { catalogInterfaces, readCatalog, readConnection, type Connection } from './onboarding';
import { composeConnectionTemplates } from './templates';
import { type Profile } from './contracts';

export type AssistedDecision = {
  pathId: string;
  endpoint: string;
  mapping: Record<string, string>;
  goal: Record<string, unknown>;
  confirmed: boolean;
};

export type AssistedSetupInput = {
  catalog: unknown;
  fragments: unknown[];
  robot: { id: string; deviceId: string; model: string; controller: string; jointOrder: string[]; maxObservationAgeMs: number };
  facts: Profile['facts'];
  decisions: AssistedDecision[];
};

function fields(adapter: string, mapping: Record<string, string>): unknown {
  const m = mapping;
  if (adapter === 'joint_trajectory') return { jointNames: m.jointNames, points: m.points };
  if (adapter === 'cartesian_pose') return { position: [m.px, m.py, m.pz], orientation: [m.qx, m.qy, m.qz, m.qw], frame: m.frame, expectedFrame: m.expectedFrame };
  if (adapter === 'cartesian_delta') return {
    translation: [m.tx, m.ty, m.tz], rotation: [m.rw, m.rp, m.rr], velocity: m.velocity,
    frame: m.frame, expectedFrame: m.expectedFrame,
    maxTranslationMm: Number(m.maxTranslationMm), maxRotationDeg: Number(m.maxRotationDeg), maxVelocityMmS: Number(m.maxVelocityMmS)
  };
  if (adapter === 'cartesian_absolute_wpr') return {
    position: [m.px, m.py, m.pz], rotation: [m.rw, m.rp, m.rr], velocity: m.velocity,
    frame: m.frame, expectedFrame: m.expectedFrame,
    defaultVelocityMmS: Number(m.defaultVelocityMmS), maxVelocityMmS: Number(m.maxVelocityMmS)
  };
  if (adapter === 'tp_program') return { program: m.program, allowedPrograms: (m.allowedPrograms ?? '').split('\n').map(value => value.trim()).filter(Boolean) };
  throw new Error(`unsupported_adapter:${adapter}`);
}

function fieldRules(value: string | undefined): unknown {
  try { return { rules: JSON.parse(value ?? '') }; }
  catch { throw new Error('field_rules_must_be_json_array'); }
}

export async function buildAssistedConnection(input: AssistedSetupInput): Promise<Connection> {
  const catalog = await readCatalog(input.catalog);
  const template = composeConnectionTemplates(input.fragments);
  if (template.compatibility.rosDistro && template.compatibility.rosDistro !== catalog.environment.rosDistro)
    throw new Error(`template_ros_distro_mismatch:${template.compatibility.rosDistro}:${catalog.environment.rosDistro}`);
  if (input.decisions.length !== template.paths.length || new Set(input.decisions.map(item => item.pathId)).size !== input.decisions.length)
    throw new Error('one_confirmed_decision_required_per_template_path');
  const available = catalogInterfaces(catalog).filter(item => !item.unavailable);
  const paths = template.compatibility.paths.map(requirement => {
    const configured = template.paths.find(item => item.id === requirement.id)!;
    const decision = input.decisions.find(item => item.pathId === requirement.id);
    if (!decision?.confirmed) throw new Error(`confirm_meaning_units_and_frame:${requirement.id}`);
    const compatible = available.filter(item => item.kind === requirement.kind && item.interfaceType === requirement.interfaceType &&
      (!requirement.interfaceSha256 || item.interfaceSha256 === requirement.interfaceSha256));
    const selected = compatible.find(item => item.endpoint === decision.endpoint);
    if (!selected) throw new Error(`selected_interface_not_compatible:${requirement.id}`);
    const mapping = { ...configured.mapping, ...decision.mapping };
    const common = { id: requirement.id, endpoint: selected.endpoint, interfaceSha256: selected.interfaceSha256, adapter: configured.adapter,
      checks: input.facts.map(fact => fact.id) };
    if (configured.adapter === 'topic_twist' || configured.adapter === 'topic_fields') {
      if (selected.kind !== 'topic') throw new Error(`topic_required:${requirement.id}`);
      const receiver = selected.subscribers.find(node => `${node.namespace}|${node.name}` === mapping.subscriber && node.count === 1);
      if (!receiver) throw new Error(`choose_unambiguous_receiver:${requirement.id}`);
      if (configured.adapter === 'topic_fields') return { ...common, messageType: selected.messageType,
        subscriber: { name: receiver.name, namespace: receiver.namespace }, fields: fieldRules(mapping.rulesJson) };
      return { ...common, messageType: selected.messageType, subscriber: { name: receiver.name, namespace: receiver.namespace },
        fields: { linear: mapping.linear, angular: mapping.angular }, commandFrame: mapping.commandFrame };
    }
    if (selected.kind !== 'action' || selected.serverCount !== 1) throw new Error(`choose_unambiguous_action_server:${requirement.id}`);
    return { ...common, actionType: selected.actionType,
      fields: configured.adapter === 'action_fields' ? fieldRules(mapping.rulesJson) : fields(configured.adapter, mapping) };
  });
  const urdf = input.facts.find(fact => fact.kind === 'file_sha256' && (fact.id === 'robot-description' || /\.urdf$/i.test(fact.path)));
  if (!urdf) throw new Error('robot_description_file_fact_required');
  return readConnection({ schemaVersion: 1, kind: 'RlsokShadowConnection', catalog,
    profile: { schemaVersion: 1, id: input.robot.id, mode: 'shadow', environment: catalog.environment,
      robot: { deviceId: input.robot.deviceId, model: input.robot.model, controller: input.robot.controller, urdfSha256: urdf.expected },
      jointOrder: input.robot.jointOrder, maxObservationAgeMs: input.robot.maxObservationAgeMs, facts: input.facts, paths },
    proposals: { schemaVersion: 1, proposals: input.decisions.map(item => ({ id: `goal-${item.pathId}`, pathId: item.pathId, goal: item.goal })) }
  });
}
