import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { parseSaved, savedBytes, savedDocument, setupBindingSchema, setupManifestSchema, type SetupManifest } from './saved-setup';
import { inspectSavedInputs, savedInputMarkdown } from './saved-input-review';
import { beastNodeParameters } from './beast-parameters';
import { pioneerSettingsSchema } from './pioneer-settings';

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
  'kuka-sunrise': 'LufsSeccus/Ros2_Kuka_External_Control_Bridge_API',
  'armpilot-remote': 'zc110747/MeArmPilot', 'armpilot-3d': 'zc110747/MeArmPilot',
  'pioneer-x': 'DaneelOlivawXJose/pioneer-ros2-diff-drive',
  'modular-diffbot': 'E-Moynul/ros2_modular_diffbot', 'piper-cpp': 'justagist/piper_cpp',
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
  const sourcePaths: Array<{id: string; path: string}> = [];
  function add(id: string, path: string, format: 'json' | 'yaml' | 'text') {
    if (files.some(f => f.id === id)) throw new Error('duplicate_setup_file');
    const bytes = savedBytes(path);
    // Structured files are validated now, including duplicate keys.
    parseSaved(bytes, format);
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
    const id = `source-${files.length}`;
    add(id, resolve(source, path), 'text');
    sourcePaths.push({id, path});
  }
  function sourceTree(directory: string, extensions: RegExp) {
    for (const entry of readdirSync(resolve(source, directory), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || ['tests','test','tools','node_modules','__pycache__'].includes(entry.name)) continue;
      const path = directory + '/' + entry.name;
      if (entry.isSymbolicLink()) throw new Error(`source_symlink_not_supported:${path}`);
      if (entry.isDirectory()) sourceTree(path, extensions);
      else if (extensions.test(entry.name) && !/(?:_test\.|\.test\.|\.spec\.)/.test(entry.name)) src(path);
    }
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
    const leader = choice(record.leader_kind === undefined || record.leader_kind === '' ? 'star' : record.leader_kind, ['star', 'metal', 'star_vertical'], 'leader_kind');
    const slots = (mode === 'bimanual' ? ['', 'right_'] : ['']).flatMap(prefix =>
      (arms === 'both' ? ['leader', 'follower'] : [arms]).map(side => ({ prefix, side })));
    const ports: string[] = [], selectedCalibrations: string[] = [];
    for (const { prefix, side } of slots) {
      const role = prefix + side;
      ports.push(text(record[role + '_port'], role + '_port'));
      const stem = text(record[role + '_config'], role + '_config').replace(/\.json$/, '');
      if (!stem || /[\\/]/.test(stem) || stem.includes('..')) throw new Error('unsafe_calibration_name');
      const path = input(role + '_calibration', 'json');
      const library = side === 'follower' ? 'metal_follower' : leader === 'metal' ? 'metal_leader'
        : leader === 'star_vertical' ? 'rebot_102_leader_vertical' : 'rebot_102_leader';
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
    for (const path of ['utils/config.py', 'utils/robot_factory.py', 'arms/metal.py', 'arms/can_common.py', 'arms/registry.py', 'arms/base.py']) src('makermodslab/' + path);
    if (leader === 'star_vertical') src('makermodslab/star_gripper.py');
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
    if (request.files.ros2_control) input('ros2_control', 'text');
    bind('follower', 'serial', 'bridge', '/port');
    src('so101_bridge/so101_bridge/feetech_bridge_node.py');
    src('so101_hardware/src/so101_hardware_interface.cpp');
    facts.push('Selected LeRobot bridge parameters, motor map, calibration, controllers and model are copied. The port is never opened.',
      'The public C++ hardware interface exposes position state only. Review selected controller state_interfaces before launch; source YAML also lists velocity.',
      'Gripper uses a separate percentage/radian conversion. This is not the lowercase-joint adoodevv SO101 recipe.');
  } else if (recipe === 'beast') {
    const parameters = object(savedDocument(input('parameters', 'yaml'), 'yaml'), 'parameters');
    const selection = beastNodeParameters(parameters, 'esp32_bridge');
    if (selection.issues.length) throw new Error(`beast_parameter_selection:${selection.issues.join('; ')}`);
    const p = selection.values;
    text(p.serial_port, 'serial_port');
    for (const key of ['baud_rate']) {
      if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] <= 0) throw new Error(`positive_parameter_required:${key}`);
    }
    input('model', 'text'); input('launch', 'text');
    bind('esp32', 'serial', 'parameters', selection.pointers.serial_port[0]);
    // Identical overlapping selectors must all be rewritten when explicitly resolving.
    if (request.selectors.esp32) bindings[bindings.length - 1].uses = selection.pointers.serial_port.map(pointer => ({ file: 'parameters', pointer }));
    src('beast_bringup/scripts/esp32_bridge.py');
    facts.push('Root-node esp32_bridge, /esp32_bridge and /** parameter blocks are recognized. Conflicting overlapping values are refused; launch precedence is not inferred. Duplicate YAML keys remain errors.',
      'The public bridge declares cmd_vel_timeout, not watchdog_timeout. An omitted cmd_vel_timeout uses the bridge default; this saved review does not establish the live value.',
      'Firmware, UART delivery, odometry, collision stopping and physical compatibility are outside this snapshot.');
  } else if (recipe === 'armpilot-remote' || recipe === 'armpilot-3d') {
    const configuration = object(savedDocument(input('configuration', 'yaml'), 'yaml'), 'configuration');
    const remote = recipe === 'armpilot-remote';
    const serial = object(remote ? configuration.serial : configuration.device?.serial, 'serial');
    text(serial.port, 'serial.port');
    if (!Number.isSafeInteger(serial.baud) || serial.baud <= 0) throw new Error('positive_integer_serial_baud_required');
    bind('arm', 'serial', 'configuration', remote ? '/serial/port' : '/device/serial/port');
    if (remote) {
      const joystick = object(configuration.joystick, 'joystick');
      const ids = ['lx','ly','rx','ry'].map(axis => {
        const id = joystick[axis + '_servo'];
        if (!Number.isSafeInteger(id) || ![6,7,8,9].includes(id)) throw new Error(`reviewed_firmware_servo_id_required:${axis}`);
        if (typeof joystick['invert_' + axis] !== 'boolean') throw new Error(`explicit_joystick_direction_required:${axis}`);
        return id;
      });
      if (new Set(ids).size !== ids.length) throw new Error('duplicate_joystick_servo_assignment');
      if (typeof joystick.deadband_deg !== 'number' || !Number.isFinite(joystick.deadband_deg) || joystick.deadband_deg < 0) throw new Error('nonnegative_joystick_deadband_required');
      src('MeArm-RemoteControl/main.go');
      src('MeArm-RemoteControl/go.mod'); src('MeArm-RemoteControl/go.sum');
      sourceTree('MeArm-RemoteControl/internal', /\.go$/);
      sourceTree('MeArm-RemoteControl/web/static/js', /\.js$/);
      facts.push('RemoteControl: the complete selected YAML includes serial/ACK settings, web/TCP endpoints, joystick servo IDs, direction and deadband. The host and firmware source are copied, never run.');
    } else {
      choice(configuration.device?.mode, ['sim','mujoco','serial'], 'device_mode');
      const selection = object(savedDocument(input('selection', 'json'), 'json'), 'selection');
      const robotId = text(selection.robotId, 'selection.robotId');
      if (robotId !== 'mearm-v1') throw new Error('armpilot_recipe_requires_reviewed_mearm_v1_package');
      if (Object.keys(selection).some(key => key !== 'robotId')) throw new Error('unsupported_armpilot_selection_field');
      const registry = object(savedDocument(input('robot_selector', 'yaml'), 'yaml'), 'robot_selector');
      const selectedRobot = object(registry.robots?.[robotId], 'selected_robot');
      const manifest = object(savedDocument(input('robot_manifest', 'yaml'), 'yaml'), 'robot_manifest');
      const model = object(savedDocument(input('robot_model', 'yaml'), 'yaml'), 'robot_model');
      input('physics','yaml'); input('model','text');
      if (manifest.id !== robotId) throw new Error('armpilot_robot_identity_mismatch');
      text(model.robot?.id, 'robot_model.robot.id');
      if (selectedRobot.config !== manifest.model?.config || selectedRobot.physics !== manifest.model?.physics) throw new Error('armpilot_selector_manifest_mismatch');
      if (!Array.isArray(model.actuators) || !model.actuators.length) throw new Error('armpilot_actuator_map_required');
      src('MeArm-3D/backend/main.go');
      src('MeArm-3D/backend/go.mod'); src('MeArm-3D/backend/go.sum');
      sourceTree('MeArm-3D/backend/internal', /\.go$/);
      sourceTree('MeArm-3D/frontend/src/robot', /\.ts$/);
      sourceTree('MeArm-3D/frontend/src/store', /\.ts$/);
      src('MeArm-3D/frontend/src/hooks/useAutoConnect.ts');
      src('MeArm-3D/frontend/package.json');
      sourceTree('MeArm-3D/robot-package/mearm-v1/kinematics', /\.ts$/);
      sourceTree('MeArm-3D/simulation/mujoco', /\.py$/);
      facts.push(`3D backend: selected robot ${robotId}, saved device mode ${configuration.device.mode}. Selection is an operator record; command-line overrides and the installed model are not discovered.`,
        `Package id ${manifest.id} and model-internal id ${model.robot.id} are distinct upstream identifiers; they are recorded without forcing them to be identical.`,
        'The selected registry, package manifest, robot model/calibration, physics and URDF are separate copied inputs. Model dimensions, joint coupling, actuator offset/scale/reverse, limits and home pose are compared without calculating motion or running a model generator.',
        'The repository is being restructured. This recipe compares the explicitly selected files; it does not certify that deprecated config_path or other runtime selection fields are effective.');
    }
    sourceTree('MeArm-Device/core', /\.(?:c|h|cpp)$/);
    sourceTree('MeArm-Device/bsp', /\.(?:c|h|cpp)$/);
    src('MeArm-Device/platformio.ini');
    const mapName = 'source-files.json';
    files.push({id: 'source-map', path: mapName, format: 'json'});
    content.set(mapName, Buffer.from(JSON.stringify(sourcePaths,null,2)+'\n'));
    facts.push('This independent prototype copies selected source/configuration files only. It does not modify ArmPilot, launch its frontend/backend or simulator, open WebSocket/TCP/serial connections, flash firmware or send servo commands.',
      'Firmware source changes invalidate the saved comparison; the installed firmware binary, EEPROM calibration and physical unit are not observed. Source defaults are not measured hardware facts.',
      'The reviewed MeArm serial state is an internal target for an open-loop servo, not encoder evidence that the arm reached a position. UNCHANGED means selected copies match, not that motion is safe or authorized.');
  } else if (recipe === 'pioneer-x') {
    const settings = pioneerSettingsSchema.parse(savedDocument(input('settings','json'),'json'));
    input('firmware','text');
    for (const pkg of ['master_esp32','navegacion_completa_pkg','planificador_rutas','joy_controller']) {
      const directory = 'ros2_ws/src/' + pkg;
      sourceTree(directory, /\.(?:cpp|hpp|h)$/);
      src(directory + '/package.xml'); src(directory + '/CMakeLists.txt');
    }
    src('ros2_ws/src/navegacion_completa_pkg/action/NavigateToNode.action');
    files.push({id: 'source-map', path: 'source-files.json', format: 'json'});
    content.set('source-files.json', Buffer.from(JSON.stringify(sourcePaths,null,2)+'\n'));
    facts.push(`Selected saved algorithm: ${settings.algorithm}. The settings file is the JSON body used at /web/settings/algoritmo; every reviewed tracker field is explicit. No MPC callback defaults are substituted.`,
      'The master forwards PURE_PURSUIT to /settings/pure_pursuit and MPC to /settings/mpc_controller; their cmd_vel output reaches the ESP32 Twist subscription. This is a source description, not an observed connection or installed gate.',
      'Both reviewed trackers and the surrounding master/navigation/teleop source are copied with a path map. Algorithm, settings, firmware and source changes require a new comparison; the old baseline is not updated.',
      'CARROT/PROPORTIONAL is not accepted by this saved-settings recipe. At the reviewed public source the master publishes /planificador/ruta_prop while the proportional node subscribes /planificador/ruta, and no proportional settings callback is present. Its actual updated source/remapping is needed before claiming that selection.',
      'SCADA source and a live settings export are absent from the reviewed public checkout. Example settings are source-derived examples, not the owner’s running configuration. The supplied firmware file/hash and Git commit do not establish the flashed binary or dependency/toolchain versions.',
      'No SCADA, ROS, micro-ROS, node launch, firmware execution, network connection or motor command occurs. Live algorithm switching, command arbitration, physical identity and tracking performance are not evaluated. Keep any private WiFi values in firmware copies local.');
  } else if (recipe === 'modular-diffbot') {
    const settings = z.object({
      mode: z.literal('real-saved-copies'),
      parameters: z.object({
        esp_ip: z.string().min(1), esp_port: z.number().int().min(1).max(65535),
        socket_timeout_sec: z.number().finite().positive(), reconnect_interval_sec: z.number().finite().positive(),
        wheel_base: z.number().finite().positive(), wheel_radius: z.number().finite().positive(),
        max_pwm: z.number().int().min(1).max(255), speed_to_pwm_scale: z.number().finite().positive()
      }).strict(),
      teleop: z.object({ speed: z.number().finite().positive(), turn: z.number().finite().positive() }).strict(),
      remappings: z.record(z.string().min(1)),
      provenance: z.enum(['source-default-example', 'operator-selected'])
    }).strict().parse(savedDocument(input('settings','json'),'json'));
    for (const id of ['bridge','firmware','launch','model','model_core','model_gazebo']) input(id,'text');
    src('package.xml'); src('setup.py'); src('setup.cfg');
    facts.push(`Selected real-path saved copies (${settings.provenance}); all parameter, teleop and remapping entries are retained. No node or firmware is executed.`,
      'Bridge, firmware, real launch and all three model Xacro copies are compared together. The bridge performs open-loop PWM conversion; this review does not measure speed or discover the flashed binary.',
      'At reviewed upstream source 84b2fe17, bridge max_pwm defaults to 200 but firmware setMotor caps it again at 100. These are separate settings; review both source copies rather than treating max_pwm as measured motor output.',
      'The selected real launch does not start robot_state_publisher; model copies document intended geometry, not an observed live model. Gazebo plugin settings are not the real TCP/WiFi path.',
      'Selected firmware may contain WiFi credentials. All copied files and reports stay local; do not upload or email the raw workspace. No TCP, WiFi, serial, ROS, motor connection, firmware flashing or live command interception occurs.');
  } else if (recipe === 'piper-cpp') {
    const selection = z.object({
      entrypoint: z.enum(['piper_cpp_ros/piper_control.launch.py', 'piper_cpp_moveit/piper_moveit.launch.py']),
      arguments: z.object({
        description_package: z.string().min(1), description_file: z.string().min(1), controllers_file: z.string().min(1),
        use_real_hardware: z.boolean(), can_interface: z.string().min(1),
        speed_pct: z.number().int().min(1).max(100), go_to_zero_on_activate: z.boolean(),
        with_gripper: z.boolean(), gripper_max_effort: z.number().finite().min(0).max(5), home_gripper_on_activate: z.boolean()
      }).passthrough(), provenance: z.enum(['source-default-example', 'operator-selected'])
    }).strict().parse(savedDocument(input('selection','json'),'json'));
    input('controllers','yaml'); input('model','text');
    if (selection.entrypoint.startsWith('piper_cpp_moveit/')) {
      for (const id of ['moveit_controllers','joint_limits','kinematics','planning']) input(id,'yaml');
      input('semantic_model','text');
    }
    for (const pkg of ['piper_cpp','piper_cpp_ros','piper_cpp_moveit']) {
      src(pkg + '/CMakeLists.txt');
      if (pkg !== 'piper_cpp') src(pkg + '/package.xml');
    }
    sourceTree('piper_cpp/include', /\.(?:h|hpp)$/); sourceTree('piper_cpp/src', /\.(?:cpp|h|hpp)$/);
    sourceTree('piper_cpp_ros/include', /\.(?:h|hpp)$/); sourceTree('piper_cpp_ros/src', /\.(?:cpp|h|hpp)$/);
    sourceTree('piper_cpp_ros/urdf', /\.xacro$/); sourceTree('piper_cpp_ros/launch', /\.py$/);
    sourceTree('piper_cpp_moveit/launch', /\.py$/); sourceTree('piper_cpp_moveit/srdf', /\.xacro$/);
    files.push({id:'source-map',path:'source-files.json',format:'json'});
    content.set('source-files.json',Buffer.from(JSON.stringify(sourcePaths,null,2)+'\n'));
    bind('arm-can','can','selection','/arguments/can_interface');
    facts.push(`Selected ${selection.entrypoint}; gripper=${selection.arguments.with_gripper}, real hardware=${selection.arguments.use_real_hardware}, provenance=${selection.provenance}. These are saved declarations, not a controller observation.`,
      'Explicit selection retains CAN name, speed cap, activation-to-zero and gripper homing choices. Arm/gripper toggles and description/controller overrides are compared together; an override can change the meaning of a toggle.',
      'The selected model must be the complete saved expanded robot_description, including external piper_description content. Xacro is never executed by this tool. Source copies do not establish installed package resolution, hardware calibration or firmware.',
      'CAN interface names alone are not physical device identity. Optional operator-supplied selectors may bind a saved inventory; no CAN socket is opened.',
      'The SDK, hardware interface and launch sources are read as bytes only. No driver is loaded, arm enabled, CAN configured, activation/home command sent or MoveIt/controller launched. This is an independent free file comparison, not an upstream contribution or safety approval.');
  } else if (recipe === 'kuka-sunrise') {
    for (const [id, path] of Object.entries({
      bridge: 'kuka_udp_bridge_node/src/udp_bridge_node.cpp', sunrise: 'UDP_bridge.java',
      launch: 'kuka_udp_bridge_node/launch/dual_robot.launch.py',
      package: 'kuka_udp_bridge_node/package.xml', build: 'kuka_udp_bridge_node/CMakeLists.txt',
    })) {
      if (request.files[id]) input(id, 'text');
      else add(id, resolve(source, path), 'text');
    }
    if (request.files.settings) input('settings', 'json');
    facts.push('Pairs copied ROS bridge, launch and Sunrise Java source. No ROS process, UDP socket or cabinet connection is created.',
      'The supplied commit and source files are a saved comparison baseline, not proof of the deployed cabinet application.',
      'At reviewed source 26863e16 the bridge declares robot_ip, robot_port, client_port and network_interface. README robot_id is not declared in that bridge.',
      'Select actual local overrides in a settings JSON when available; no live parameter values or message logs are inferred.',
      'This is saved-file comparison, not interception of cmd_vel, goal_pose, arm_cmd_joints, arm_goal_pose or speed messages.');
  } else {
    const launch = object(savedDocument(input('settings', 'json'), 'json'), 'settings');
    choice(launch.config_type, ['single_arm', 'dual_arm'], 'config_type');
    input('controllers', 'yaml'); input('model', 'text'); input('launch', 'text');
    if (request.files.commands) input('commands', 'json');
    src('cartesian_motion_base/src/cartesian_motion_base.cpp');
    src('cartesian_motion_test/include/cartesian_motion_test/cartesian_motion_config.hpp');
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
  const inspection = ['aditya-so101', 'beast', 'cartesian'].includes(recipe) ? inspectSavedInputs(recipe, source, inputPath) : undefined;
  if (inspection) {
    writeFileSync(join(output, 'inspection.json'), JSON.stringify(inspection, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    writeFileSync(join(output, 'inspection.md'), savedInputMarkdown(inspection), { flag: 'wx', mode: 0o600 });
    facts.unshift(`Static selected-input inspection: ${inspection.decision}. Read inspection.md before approving any baseline; capture readiness means only that selected files can be compared.`);
  }
  for (const [filename, bytes] of content) writeFileSync(join(output, filename), bytes, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(output, 'REVIEW.md'), `# ${recipe}: selected configuration copies\n\nReview the copied inputs and manifest before capturing or approving. The supplied source commit is self-attested; copied source bytes are also bound by the snapshot.\n\n${facts.map(f => '- ' + f).join('\n')}\n\nNo source modules were imported or executed. No hardware or live ROS checks were performed.\n`, { flag: 'wx', mode: 0o600 });
  return { recipe, directory: resolve(output), manifest: join(resolve(output), 'manifest.json'), files: files.length, facts };
}
