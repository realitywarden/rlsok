import { z } from 'zod';
import { digest, environmentSchema } from './contracts';
import { assertBoundedInput, sha256Bytes } from './onboarding';
const node = z.string().regex(/^\/(?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*$/);
const name = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const parameter = z.object({ type: z.number().int().min(0).max(9),
  value: z.union([z.null(), z.boolean(), z.string(), z.array(z.union([z.string(), z.boolean()]))]) }).strict();
export const controllerExportSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('RlsokRosControllerState'),
  observedAt: z.string().datetime({ offset: true }), configurationSha256: digest,
  configuration: z.object({ schemaVersion: z.literal(1),
    source: z.object({ controllerManager: node, controllerName: name, controllerNode: node, environment: environmentSchema }).strict(),
    controller: z.object({ name, state: z.string().min(1), type: z.string().min(1), claimed_interfaces: z.array(z.string()) }).passthrough().nullable(),
    actionServers: z.array(z.object({ endpoint: node, type: z.string().regex(/^[a-z][a-z0-9_]*\/action\/[A-Z][A-Za-z0-9]*$/) }).strict()).max(128),
    parameters: z.record(parameter)
  }).strict()
}).strict();
export type ControllerExport = z.infer<typeof controllerExportSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${canonical(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('controller_metadata_requires_portable_integers');
  return JSON.stringify(value).replace(/[\u0080-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
export async function controllerConfigurationHash(value: ControllerExport['configuration']): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(canonical(value)));
}
export async function readControllerExport(input: unknown): Promise<ControllerExport> {
  assertBoundedInput(input);
  const state = controllerExportSchema.parse(input);
  if (Object.keys(state.configuration.parameters).length > 512) throw new Error('too_many_controller_parameters');
  if (state.configuration.controller && state.configuration.controller.name !== state.configuration.source.controllerName) throw new Error('controller_export_name_mismatch');
  if (!state.configuration.controller && (Object.keys(state.configuration.parameters).length || state.configuration.actionServers.length)) throw new Error('absent_controller_cannot_have_parameters_or_actions');
  if (await controllerConfigurationHash(state.configuration) !== state.configurationSha256) throw new Error('controller_export_digest_mismatch');
  return state;
}

export function requireControllerBaseline(state: ControllerExport, requirement: {
  name: string; type: string; claimedInterfaces: string[]; parameters: Record<string, string[]>; actionEndpoint?: string;
}, now = new Date()): void {
  const age = now.getTime() - Date.parse(state.observedAt);
  if (age < 0 || age > 300000) throw new Error('controller_export_stale_or_future');
  const { source, controller, parameters } = state.configuration;
  if (source.controllerName !== requirement.name || source.controllerNode !== `/${requirement.name}` ||
      !controller || controller.state !== 'active' || controller.type !== requirement.type) throw new Error('source_recipe_requires_its_active_controller');
  const actual = controller.claimed_interfaces;
  if (new Set(actual).size !== actual.length || JSON.stringify([...actual].sort()) !== JSON.stringify([...requirement.claimedInterfaces].sort())) throw new Error('controller_claimed_interfaces_differ_from_source_recipe');
  for (const [key, expected] of Object.entries(requirement.parameters)) {
    if (parameters[key]?.type !== 9 || JSON.stringify(parameters[key].value) !== JSON.stringify(expected)) throw new Error(`controller_parameter_differs_from_source_recipe:${key}`);
  }
  if (requirement.actionEndpoint && state.configuration.actionServers.filter(action => action.endpoint === requirement.actionEndpoint && action.type === 'control_msgs/action/FollowJointTrajectory').length !== 1) throw new Error('selected_controller_does_not_host_the_reviewed_action');
}
