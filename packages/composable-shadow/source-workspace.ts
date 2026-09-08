import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readCatalog, readConnection, type Connection } from './onboarding';
import { sourceRecipes } from './source-recipes';
import { readControllerExport, requireControllerBaseline } from './controller-state';
import type { Profile } from './contracts';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const MAX_BYTES = 8 * 1024 * 1024;
function bytes(path: string): Buffer {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_BYTES) throw new Error(`source_input_requires_regular_file_under_8MiB:${path}`);
  const value = readFileSync(path);
  if (value.length > MAX_BYTES) throw new Error('source_input_too_large');
  return value;
}
function sourceFile(root: string, path: string): Buffer {
  const base = realpathSync(root), target = join(base, path);
  let current = base;
  for (const part of path.split('/')) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`source_symlink_not_allowed:${path}`);
  }
  const rel = relative(base, realpathSync(target));
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('source_file_escapes_root');
  return bytes(target);
}
function json(path: string): unknown { return JSON.parse(bytes(path).toString('utf8')); }
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

export interface SourceInputs { recipe: string; source: string; urdf: string; settings: string; controllerState?: string }
function readInputs(input: SourceInputs): Map<string, Buffer> {
  const recipe = sourceRecipes[input.recipe];
  if (!recipe) throw new Error('unknown_source_recipe');
  const result = new Map(recipe.files.map(path => [`source/${path}`, sourceFile(input.source, path)]));
  const urdf = bytes(input.urdf);
  // This deliberately requires the expanded description; source xacro alone omits resolved arguments/includes.
  const xml = urdf.toString('utf8');
  if (!/<robot(?:\s|>)/.test(xml) || /<\/?xacro:|\$\{/.test(xml)) throw new Error('supply_expanded_robot_urdf');
  const settings = bytes(input.settings);
  const parsed = JSON.parse(settings.toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.keys(parsed).length) throw new Error('supply_nonempty_operator_runtime_settings_object');
  result.set('robot.urdf', urdf);
  result.set('runtime-settings.json', settings);
  if (recipe.controllerState) {
    if (!input.controllerState) throw new Error('source_recipe_requires_read_only_controller_state_export');
    result.set('controller-state.json', bytes(input.controllerState));
  } else if (input.controllerState) throw new Error('this_recipe_has_no_reviewed_controller_state_mapping');
  return result;
}

export async function prepareSourceWorkspace(input: SourceInputs & {
  catalog: string; example: string; deviceId: string; output: string; frame?: string; subscriber?: string;
}): Promise<string> {
  const recipe = sourceRecipes[input.recipe];
  if (!recipe) throw new Error('unknown_source_recipe');
  const output = resolve(input.output);
  if (existsSync(output)) throw new Error('output_already_exists');
  const catalog = await readCatalog(json(input.catalog));
  const files = readInputs(input);
  const controllerState = recipe.controllerState ? await readControllerExport(JSON.parse(files.get('controller-state.json')!.toString('utf8'))) : undefined;
  if (controllerState) {
    requireControllerBaseline(controllerState, recipe.controllerState!);
    if (JSON.stringify(controllerState.configuration.source.environment) !== JSON.stringify(catalog.environment)) throw new Error('controller_export_environment_differs_from_catalog');
  }
  const facts: Profile['facts'] = [...files].map(([path, data], index) => path === 'controller-state.json'
    ? { id: 'active-controller', kind: 'json_value', path: 'files/controller-state.json', pointer: '/configurationSha256', expected: controllerState!.configurationSha256 }
    : { id: `file-${index + 1}-${basename(path)}`, kind: 'file_sha256', path: `files/${path}`, expected: hash(data) });
  const checks = facts.map(fact => fact.id);
  let selectedPath: Connection['profile']['paths'][number];
  if (recipe.joints) {
    if (input.frame || input.subscriber) throw new Error('trajectory_recipe_does_not_use_frame_or_subscriber');
    const action = catalog.actions.find(a => a.endpoint === recipe.endpoint && a.actionType === recipe.interfaceType);
    if (!action?.interfaceSha256 || action.serverCount !== 1) throw new Error('source_action_requires_one_discovered_server');
    selectedPath = { id: 'command', adapter: 'joint_trajectory', endpoint: recipe.endpoint, actionType: recipe.interfaceType,
      interfaceSha256: action.interfaceSha256, fields: { jointNames: '/trajectory/joint_names', points: '/trajectory/points' }, checks };
  } else {
    const subscriber = input.subscriber ?? (recipe.subscriber ? `/${recipe.subscriber}` : undefined);
    if (!subscriber || !/^\/(?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*$/.test(subscriber)) throw new Error('supply_actual_subscriber_fully_qualified_name');
    const split = subscriber.lastIndexOf('/'), name = subscriber.slice(split + 1), namespace = subscriber.slice(0, split) || '/';
    // Named source nodes may be namespaced explicitly, but are never silently replaced with a logger or nearby interface.
    if (recipe.subscriber && name !== recipe.subscriber) throw new Error('receiver_name_differs_from_reviewed_source_recipe');
    const topic = catalog.topics?.find(t => t.endpoint === recipe.endpoint && t.messageType === recipe.interfaceType);
    if (!topic?.interfaceSha256 || topic.subscribers.find(n => n.name === name && n.namespace === namespace)?.count !== 1) throw new Error('source_topic_requires_one_discovered_subscription_on_selected_receiver');
    if (!input.frame) throw new Error('supply_reviewed_command_frame');
    const stamped = recipe.interfaceType === 'geometry_msgs/msg/TwistStamped';
    selectedPath = { id: 'command', adapter: 'topic_twist', endpoint: recipe.endpoint,
      messageType: stamped ? 'geometry_msgs/msg/TwistStamped' : 'geometry_msgs/msg/Twist', subscriber: { name, namespace },
      interfaceSha256: topic.interfaceSha256, commandFrame: input.frame,
      fields: { linear: stamped ? '/twist/linear' : '/linear', angular: stamped ? '/twist/angular' : '/angular' }, checks };
  }
  if (controllerState && selectedPath.adapter === 'topic_twist') {
    const receiver = `${selectedPath.subscriber.namespace === '/' ? '' : selectedPath.subscriber.namespace}/${selectedPath.subscriber.name}`;
    if (controllerState.configuration.source.controllerNode !== receiver) throw new Error('controller_export_node_differs_from_selected_receiver');
  }
  const connection = await readConnection({ schemaVersion: 1, kind: 'RlsokShadowConnection', catalog,
    profile: { schemaVersion: 1, id: input.recipe, mode: 'shadow', environment: catalog.environment,
      robot: { deviceId: input.deviceId, model: recipe.model, controller: recipe.endpoint, urdfSha256: hash(files.get('robot.urdf')!) },
      jointOrder: recipe.joints ?? [], maxObservationAgeMs: 300000, facts, paths: [selectedPath] },
    proposals: { schemaVersion: 1, proposals: [{ id: 'reviewed-example', pathId: 'command', goal: json(input.example) }] } });
  mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const [path, data] of files) {
    const target = join(output, 'files', path); mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, data, { flag: 'wx', mode: 0o600 });
  }
  writeJson(join(output, 'connection.json'), connection);
  writeJson(join(output, 'profile.json'), connection.profile);
  writeJson(join(output, 'proposals.json'), connection.proposals);
  writeJson(join(output, 'catalog.json'), catalog);
  writeJson(join(output, 'source-map.json'), { schemaVersion: 1, kind: 'RlsokSourceWorkspace', recipe: input.recipe,
    referenceRepository: recipe.repository, referenceCommit: recipe.referenceCommit,
    ...(controllerState ? { controllerStateSource: controllerState.configuration.source } : {}),
    scope: recipe.boundary, files: [...files.keys()].map(path => `files/${path}`) });
  writeFileSync(join(output, 'README.md'), `# ${input.recipe} local review\n\n${recipe.boundary}\n\nSource mapping reference: https://github.com/${recipe.repository}/tree/${recipe.referenceCommit}\nThe reference commit describes the mapping; it does not assert that your checkout or running robot uses that commit.\n\nReview profile.json, proposals.json, runtime settings, and every copied file before approving. No approval or observation is generated here. The catalog is a discovery snapshot.\n\nBefore each capture, use profile refresh-source with the current source, expanded URDF and operator settings. Refresh only replaces local input copies; it never changes the approved profile or evidence. An incomplete refresh is an error: do not capture until refresh succeeds.\n\nFor SO-101/TRIK, run export-controller before each capture and pass --controller-state to every prepare/refresh. Export timestamps are preserved; copying an old file cannot refresh them. Local source files and operator settings are proxies. The separate export reports the selected ROS software state, not authenticated hardware/firmware. A source-file change alone is not an actual running controller swap. Keep first use isolated from hardware; zero RLSOK dispatch does not stop other nodes.\n\nSee docs/source-shadow-workspaces.md in the installed bundle for commands and per-project prerequisites.\n`, { flag: 'wx', mode: 0o600 });
  return output;
}

export async function refreshSourceWorkspace(input: Omit<SourceInputs, 'recipe'> & { workspace: string }): Promise<void> {
  const root = realpathSync(input.workspace);
  const marker = json(join(root, 'source-map.json')) as { kind?: string; schemaVersion?: number; recipe?: string; files?: string[]; controllerStateSource?: unknown };
  if (marker.kind !== 'RlsokSourceWorkspace' || marker.schemaVersion !== 1 || !marker.recipe || !sourceRecipes[marker.recipe]) throw new Error('not_a_source_workspace');
  const connection = await readConnection(json(join(root, 'connection.json')));
  const savedProfile = json(join(root, 'profile.json'));
  if (JSON.stringify(savedProfile) !== JSON.stringify(connection.profile)) throw new Error('workspace_profile_changed_reprepare_and_review');
  const files = readInputs({ ...input, recipe: marker.recipe });
  if (files.has('controller-state.json')) {
    const state = await readControllerExport(JSON.parse(files.get('controller-state.json')!.toString('utf8')));
    if (JSON.stringify(state.configuration.source) !== JSON.stringify(marker.controllerStateSource)) throw new Error('refresh_requires_the_same_controller_state_source');
    // Inactive, absent or changed bindings must survive refresh so capture can record
    // their actual digest and original observedAt against the unchanged approval.
  }
  const expectedPaths = [...files.keys()].map(path => `files/${path}`);
  if (JSON.stringify(marker.files) !== JSON.stringify(expectedPaths) ||
      JSON.stringify(connection.profile.facts.map(f => f.path)) !== JSON.stringify(expectedPaths)) throw new Error('source_workspace_file_map_changed');
  // Read and validate everything before the first write. Never follow workspace links.
  for (const path of expectedPaths) sourceFile(root, path);
  for (const [path, data] of files) {
    const target = join(root, 'files', path), temporary = `${target}.rlsok-refresh`;
    writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, target);
  }
}
