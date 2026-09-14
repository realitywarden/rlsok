import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { savedBytes, savedDocument, setupBindingSchema, setupManifestSchema, type SetupManifest } from './saved-setup';

const selector = setupBindingSchema.shape.identity;
const requestSchema = z.object({
  id: z.string().min(1), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  files: z.record(z.string().min(1)),
  selectors: z.record(selector).default({}),
}).strict();
const repositories: Record<string, string> = {
  piper: 'SUNNYsyy2005/bimanual-vla', metal: 'makermods-robotics/makermodslab',
  'aditya-so101': 'iAdityaDev/so_101_arm', beast: 'Dwilliestyle/Dons_Beast',
  cartesian: 'leledeyuan00/cartesian_motion_base',
};
type Obj = Record<string, any>;
function object(value: unknown, label: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) throw new Error(`nonempty_object_required:${label}`);
  return value as Obj;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`explicit_value_required:${label}`);
  return value;
}
function choice(value: unknown, choices: string[], label: string): string {
  if (typeof value !== 'string' || !choices.includes(value)) throw new Error(`explicit_${label}_required:${choices.join('|')}`);
  return value;
}
/** Copy selected inputs; never execute/import source, launch ROS or infer a rig. */
export function prepareSavedSetup(recipe: string, source: string, inputPath: string, output: string) {
  if (!Object.hasOwn(repositories, recipe)) throw new Error('unknown_saved_setup_recipe');
  const request = requestSchema.parse(savedDocument(inputPath, 'json'));
  if (existsSync(output)) throw new Error('output_already_exists');
  const files: SetupManifest['files'] = [];
  const content = new Map<string, Buffer>();
  const bindings: SetupManifest['bindings'] = [];
  const facts: string[] = [];
  const usedInputs = new Set<string>(), usedSelectors = new Set<string>();
  function add(id: string, path: string, format: 'json' | 'yaml' | 'text') {
    if (files.some(f => f.id === id)) throw new Error('duplicate_setup_file');
    const bytes = savedBytes(path);
    // Structured files are validated now, including duplicate keys.
    if (format !== 'text') savedDocument(path, format);
    const filename = `${files.length.toString().padStart(2, '0')}-${id}.${format === 'text' ? 'txt' : format}`;
    files.push({ id, path: filename, format });
    content.set(filename, bytes);
    return path;
  }
  function input(id: string, format: 'json' | 'yaml' | 'text') {
    usedInputs.add(id);
    const path = resolve(dirname(inputPath), text(request.files[id], `files.${id}`));
    return add(id, path, format);
  }
  function src(path: string) {
    add(`source-${files.length}`, resolve(source, path), 'text');
  }
  function bind(role: string, kind: 'serial' | 'camera' | 'can', file: string, pointer: string, required = false) {
    const identity = request.selectors[role];
    if (!identity) {
      if (required) throw new Error(`device_identity_required:${role}`);
      facts.push(`${role}: locator compared literally; physical device identity is not verified.`);
      return;
    }
    usedSelectors.add(role);
    bindings.push({ role, kind, identity, uses: [{ file, pointer }] });
  }
  if (recipe === 'piper') {
    const launch = object(savedDocument(input('launch', 'json'), 'json'), 'launch');
    const entrypoint = choice(launch.entrypoint, ['deployment/client.py', 'collection/teleop_single.py', 'collection/teleop_bimanual.py'], 'entrypoint');
    const args = object(launch.arguments, 'arguments');
    let deviceFields: Array<[string, 'camera' | 'can']>;
    if (entrypoint === 'deployment/client.py') {
      const mode = choice(args.arm_mode, ['single', 'bimanual'], 'arm_mode');
      choice(args.output_mode, ['joint', 'delivery'], 'output_mode_without_auto');
      choice(args.arm_side, mode === 'single' ? ['left', 'right'] : ['both'], 'arm_side');
      deviceFields = mode === 'single'
        ? [['can', 'can'], ['cam_high_device', 'camera'], ['cam_wrist_device', 'camera']]
        : [['left_can', 'can'], ['right_can', 'can'], ['cam_high_device', 'camera'], ['cam_left_wrist_device', 'camera'], ['cam_right_wrist_device', 'camera']];
    } else {
      choice(args.schema, ['joint', 'delivery'], 'schema');
      const single = entrypoint.endsWith('teleop_single.py');
      if (single) choice(args.arm_side, ['left', 'right'], 'arm_side');
      deviceFields = single
        ? [['master', 'can'], ['slave', 'can'], ['cam_high_id', 'camera'], ['cam_wrist_id', 'camera']]
        : [['left_master', 'can'], ['left_slave', 'can'], ['right_master', 'can'], ['right_slave', 'can'],
          ['cam_high_id', 'camera'], ['cam_left_wrist_id', 'camera'], ['cam_right_wrist_id', 'camera']];
    }
    for (const [field, kind] of deviceFields) {
      if (args[field] === undefined) throw new Error(`explicit_device_argument_required:${field}`);
      if (field.endsWith('_id')) {
        if (!Number.isSafeInteger(args[field]) || args[field] < 0) throw new Error(`nonnegative_camera_index_required:${field}`);
      } else text(args[field], field);
      bind(field, kind, 'launch', `/arguments/${field}`, true);
    }
    // Every launcher/device field is covered; unused fields must not silently
    // smuggle in an unreviewed second arm or camera selection.
    const allDevices = ['can', 'left_can', 'right_can', 'master', 'slave', 'left_master', 'left_slave', 'right_master', 'right_slave',
      'cam_high_device', 'cam_wrist_device', 'cam_left_wrist_device', 'cam_right_wrist_device', 'cam_high_id', 'cam_wrist_id', 'cam_left_wrist_id', 'cam_right_wrist_id'];
    for (const key of allDevices) if (Object.hasOwn(args, key) && !deviceFields.some(([f]) => f === key)) throw new Error(`inactive_device_field_in_launch:${key}`);
    for (const path of [entrypoint, 'collection/camera.py', 'collection/robot.py', 'data/action_conventions.py']) src('bimanual_vla/' + path);
    facts.push('Launch is a saved argument map, not a script to execute. All supplied arguments are compared. Unspecified defaults are only covered by selected source bytes.',
      'No RGB/capture capability is inferred from sysfs. Review the selected camera endpoint and USB role before approving.');
  } else if (recipe === 'metal') {
    const record = object(savedDocument(input('record', 'json'), 'json'), 'record');
    choice(record.arm_type, ['metal'], 'arm_type');
    const mode = choice(record.mode, ['single', 'bimanual'], 'mode');
    const arms = choice(record.arms, ['both', 'leader', 'follower'], 'arms');
    const leader = choice(record.leader_kind, ['star', 'metal'], 'leader_kind');
    const slots = (mode === 'bimanual' ? ['', 'right_'] : ['']).flatMap(prefix =>
      (arms === 'both' ? ['leader', 'follower'] : [arms]).map(side => ({ prefix, side })));
    const ports: string[] = [], selectedCalibrations: string[] = [];
    for (const { prefix, side } of slots) {
      const role = prefix + side;
      ports.push(text(record[role + '_port'], role + '_port'));
      const stem = text(record[role + '_config'], role + '_config').replace(/\.json$/, '');
      if (!stem || /[\\/]/.test(stem) || stem.includes('..')) throw new Error('unsafe_calibration_name');
      const path = input(role + '_calibration', 'json');
      const library = side === 'follower' ? 'metal_follower' : leader === 'metal' ? 'metal_leader' : 'rebot_102_leader';
      if (basename(path) !== `${stem}.json` || basename(dirname(path)) !== library) throw new Error(`selected_calibration_path_mismatch:${role}:${library}/${stem}.json`);
      object(savedDocument(path, 'json'), role + '_calibration');
      selectedCalibrations.push(path);
      // MakerMods CAN families use an slcan adapter port in these records;
      // they are serial device locators, not SocketCAN can0 names.
      bind(role, 'serial', 'record', `/${role}_port`);
    }
    if (new Set(ports).size !== ports.length || new Set(selectedCalibrations).size !== selectedCalibrations.length) throw new Error('metal_slots_share_port_or_calibration');
    if (!Array.isArray(record.cameras)) throw new Error('explicit_camera_list_required');
    const cameraNames: string[] = [];
    record.cameras.forEach((camera: unknown, index: number) => {
      const c = object(camera, 'camera');
      const cameraName = text(c.name, 'camera.name');
      cameraNames.push(cameraName);
      if (request.selectors['camera:' + cameraName]) bind('camera:' + cameraName, 'camera', 'record', `/cameras/${index}/camera_index`);
    });
    if (new Set(cameraNames).size !== cameraNames.length) throw new Error('duplicate_camera_role');
    for (const path of ['utils/config.py', 'utils/robot_factory.py', 'arms/metal.py', 'arms/can_common.py', 'arms/registry.py']) src('makermodslab/' + path);
    src('pyproject.toml');
    facts.push(`Selected Metal ${mode}, ${arms}, ${leader} leader. Maker-family calibrations are not substituted.`,
      'Metal calibration zero offsets can be identical across physical arms; matching calibration bytes does not identify a unit.',
      'This exporter does not import MakerModsLab or LeRobot. It does not ping the Damiao bus, enable torque, start a session or install a runtime gate.');
  } else if (recipe === 'aditya-so101') {
    const settings = object(savedDocument(input('bridge', 'json'), 'json'), 'bridge');
    const calibration = object(savedDocument(input('calibration', 'json'), 'json'), 'calibration');
    for (const field of ['port', 'robot_id', 'commands_topic', 'states_topic']) text(settings[field], field);
    if (!Array.isArray(settings.joint_name_map) || !settings.joint_name_map.length) throw new Error('selected_joint_name_map_required');
    const motors: string[] = [], joints: string[] = [];
    for (const entry of settings.joint_name_map) {
      const parts = text(entry, 'joint_name_map').split(':');
      if (parts.length !== 2 || !parts.every(p => p.trim())) throw new Error('invalid_joint_name_map');
      motors.push(parts[0]); joints.push(parts[1]);
      if (!Object.hasOwn(calibration, parts[0])) throw new Error(`calibration_motor_missing:${parts[0]}`);
    }
    if (new Set(motors).size !== motors.length || new Set(joints).size !== joints.length) throw new Error('joint_motor_mapping_not_one_to_one');
    const calibrationPath = resolve(dirname(inputPath), request.files.calibration);
    if (basename(calibrationPath) !== settings.robot_id + '.json') throw new Error('calibration_filename_does_not_match_selected_robot_id');
    input('controllers', 'yaml'); input('model', 'text'); input('launch', 'text');
    bind('follower', 'serial', 'bridge', '/port');
    src('so101_bridge/so101_bridge/feetech_bridge_node.py');
    src('so101_hardware/src/so101_hardware_interface.cpp');
    facts.push('Selected LeRobot bridge parameters, motor map, calibration, controllers and model are copied. The port is never opened.',
      'The public C++ hardware interface exposes position state only. Review selected controller state_interfaces before launch; source YAML also lists velocity.',
      'Gripper uses a separate percentage/radian conversion. This is not the lowercase-joint adoodevv SO101 recipe.');
  } else if (recipe === 'beast') {
    const parameters = object(savedDocument(input('parameters', 'yaml'), 'yaml'), 'parameters');
    const p = object(parameters['/**']?.ros__parameters, '/**.ros__parameters');
    text(p.serial_port, 'serial_port');
    for (const key of ['baud_rate', 'track_radius', 'track_separation', 'max_linear_speed', 'max_angular_speed']) {
      if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] <= 0) throw new Error(`positive_parameter_required:${key}`);
    }
    input('model', 'text'); input('launch', 'text');
    bind('esp32', 'serial', 'parameters', '/~1**/ros__parameters/serial_port');
    src('beast_bringup/scripts/esp32_bridge.py');
    facts.push('Duplicate YAML keys are refused: the reviewed public file defines low_voltage_threshold twice. Select an unambiguous local copy; no value is chosen automatically.',
      'The public bridge declares cmd_vel_timeout, not watchdog_timeout. An omitted cmd_vel_timeout uses the bridge default; this saved review does not establish the live value.',
      'Firmware, UART delivery, odometry, collision stopping and physical compatibility are outside this snapshot.');
  } else {
    const launch = object(savedDocument(input('settings', 'json'), 'json'), 'settings');
    choice(launch.config_type, ['single_arm', 'dual_arm'], 'config_type');
    input('controllers', 'yaml'); input('model', 'text'); input('launch', 'text');
    src('cartesian_motion_base/src/cartesian_motion_base.cpp');
    facts.push('Selected single/dual controller YAML, joint order, frames, model and launch settings are compared as saved files.',
      'PoseStamped, WrenchStamped and JointMove command authorization is not implemented by this saved-file review. Current customer-specific dual-arm configuration is still required.');
  }
  const extras = Object.keys(request.files).filter(key => !usedInputs.has(key));
  if (extras.length) throw new Error(`unused_input_files:${extras.join(',')}`);
  const extraSelectors = Object.keys(request.selectors).filter(key => !usedSelectors.has(key));
  if (extraSelectors.length) throw new Error(`unused_device_selectors:${extraSelectors.join(',')}`);
  const manifest = setupManifestSchema.parse({ schemaVersion: 1, id: request.id,
    source: { repository: repositories[recipe], commit: request.sourceCommit },
    scope: 'saved-configuration-only', files, bindings });
  mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const [filename, bytes] of content) writeFileSync(join(output, filename), bytes, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(output, 'REVIEW.md'), `# ${recipe}: selected configuration copies\n\nReview the copied inputs and manifest before capturing or approving. The supplied source commit is self-attested; copied source bytes are also bound by the snapshot.\n\n${facts.map(f => '- ' + f).join('\n')}\n\nNo source modules were imported or executed. No hardware or live ROS checks were performed.\n`, { flag: 'wx', mode: 0o600 });
  return { recipe, directory: resolve(output), manifest: join(resolve(output), 'manifest.json'), files: files.length, facts };
}
