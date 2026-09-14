import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { parseSaved, savedBytes, savedDocument } from './saved-setup';

// Static selected-file inspection. No robot module is imported or executed.
const requestSchema = z.object({ id: z.string().min(1), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  files: z.record(z.string().min(1)), selectors: z.record(z.unknown()).optional() }).strict();
type Obj = Record<string, any>;
const object = (v: any): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const strings = (v: any): string[] => Array.isArray(v) && v.every(x => typeof x === 'string' && x.trim()) ? v : [];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const vector = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }).strict();
const header = z.object({ stamp: z.object({ sec: z.number().int(), nanosec: z.number().int().min(0).max(999999999) }).strict(), frame_id: z.string() }).strict();
const pose = z.object({ header, pose: z.object({ position: vector,
  orientation: vector.extend({ w: z.number().finite() }).strict() }).strict() }).strict();
const wrench = z.object({ header, wrench: z.object({ force: vector, torque: vector }).strict() }).strict();
const jointMove = z.object({ cmd: z.object({ layout: z.object({ dim: z.array(z.object({ label: z.string(), size: z.number().int().nonnegative(), stride: z.number().int().nonnegative() }).strict()), data_offset: z.number().int().nonnegative() }).strict(), data: z.array(z.number().finite()).min(1) }).strict(), duration: z.number().finite().positive() }).strict();

export function inspectSavedInputs(recipe: string, source: string, inputPath: string) {
  if (!['aditya-so101', 'beast', 'cartesian'].includes(recipe)) throw new Error('unsupported_saved_input_inspection');
  const request = requestSchema.parse(savedDocument(inputPath, 'json'));
  const issues: Array<{ code: string; file: string; detail: string }> = [];
  const facts: Obj = {}, evidence: Array<{ id: string; path: string; sha256: string }> = [];
  const selectedInputs = new Set<string>();
  const add = (code: string, file: string, detail: string) => { issues.push({ code, file, detail }); };
  function read(id: string, format: 'json' | 'yaml' | 'text', sourceFile?: string): any {
    if (!sourceFile) selectedInputs.add(id);
    const selected = sourceFile ? resolve(source, sourceFile) : request.files[id] ? resolve(dirname(inputPath), request.files[id]) : undefined;
    if (!selected) { add('MISSING_INPUT', id, 'Select the actual file; no project default is substituted.'); return undefined; }
    try {
      const bytes = savedBytes(selected);
      evidence.push({ id, path: selected, sha256: createHash('sha256').update(bytes).digest('hex') });
      return parseSaved(bytes, format);
    } catch (error) { add('UNREADABLE_OR_INVALID', id, (error instanceof Error ? error.message : String(error)).slice(0,1600)); return undefined; }
  }
  if (recipe === 'aditya-so101') {
    const bridge = object(read('bridge','json')), calibration = object(read('calibration','json'));
    const controllers = object(read('controllers','yaml'));
    const model = read('model','text'), control = request.files.ros2_control ? read('ros2_control','text') : model;
    read('launch','text');
    const driver = String(read('hardware-source','text','so101_hardware/src/so101_hardware_interface.cpp') ?? '');
    const bridgeSource = String(read('bridge-source','text','so101_bridge/so101_bridge/feetech_bridge_node.py') ?? '');
    if (!driver.includes('joint.state_interfaces.size() != 1') || !driver.includes('HW_IF_POSITION'))
      add('SOURCE_CONTRACT_CHANGED','hardware-source','This inspector models the reviewed position-only SO101HardwareInterface; review the selected source before using its checks.');
    const map: Record<string,string> = {};
    for (const entry of strings(bridge.joint_name_map)) {
      const parts = entry.split(':');
      if (parts.length !== 2 || parts.some(p => !p.trim()) || Object.hasOwn(map,parts[0])) add('INVALID_MOTOR_MAP','bridge',entry);
      else map[parts[0]] = parts[1];
    }
    const motorNames = ['shoulder_pan','shoulder_lift','elbow_flex','wrist_flex','wrist_roll','gripper'];
    if (!same(Object.keys(map).sort(), [...motorNames].sort()) || new Set(Object.values(map)).size !== motorNames.length)
      add('INCOMPLETE_OR_DUPLICATE_MOTOR_MAP','bridge','Select all five arm motors and the separate gripper exactly once.');
    if (!same(Object.keys(calibration).sort(), [...motorNames].sort())) add('CALIBRATION_MOTOR_SET','calibration','Selected calibration keys must match the six mapped SO101 follower motors.');
    const ids: number[] = [];
    for (const [motor, joint] of Object.entries(map)) {
      const c = object(calibration[motor]);
      if (!['id','drive_mode','homing_offset','range_min','range_max'].every(k => Number.isSafeInteger(c[k])) || c.range_max <= c.range_min)
        add('INVALID_MOTOR_CALIBRATION','calibration',`${motor}: require integer calibration fields and range_max > range_min.`);
      else ids.push(c.id);
      const escaped = joint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (typeof model !== 'string' || !new RegExp(`<joint\\s+[^>]*name=["'](?:\\$\\{prefix\\})?${escaped}["']`).test(model.replace(/<!--[\s\S]*?-->/g,'')))
        add('JOINT_NOT_IN_SELECTED_MODEL','model',`${motor} -> ${joint}`);
    }
    if (new Set(ids).size !== ids.length) add('DUPLICATE_MOTOR_ID','calibration','Two calibration entries select the same motor ID.');
    for (const field of ['port','robot_id','commands_topic','states_topic']) if (typeof bridge[field] !== 'string' || !bridge[field].trim()) add('MISSING_BRIDGE_PARAMETER','bridge',field);
    if (bridge.commands_topic === bridge.states_topic) add('TOPIC_COLLISION','bridge','Commands and states must use distinct topics.');
    if (request.files.calibration && !request.files.calibration.replace(/\\/g,'/').endsWith('/'+bridge.robot_id+'.json') && request.files.calibration !== bridge.robot_id+'.json')
      add('CALIBRATION_FILENAME','calibration','Filename must equal the selected robot_id plus .json.');
    const selected = strings(bridge.selected_controllers);
    if (!selected.length) add('MISSING_CONTROLLER_SELECTION','bridge','Add selected_controllers listing the controllers intended for this physical position-only bridge.');
    for (const name of selected) {
      const p = object(controllers[name]?.ros__parameters), type = controllers.controller_manager?.ros__parameters?.[name]?.type;
      const joints = strings(p.joints).length ? strings(p.joints) : typeof p.joint === 'string' ? [p.joint] : [];
      if (!type || !joints.length) add('CONTROLLER_NOT_CONFIGURED','controllers',name);
      for (const joint of joints) if (!Object.values(map).includes(joint)) add('CONTROLLER_JOINT_NOT_MAPPED','controllers',`${name}: ${joint}`);
      for (const kind of ['command_interfaces','state_interfaces']) {
        const required = strings(p[kind]);
        if (!required.length || required.some(v => v !== 'position')) add('UNSUPPORTED_PHYSICAL_INTERFACE','controllers',`${name}.${kind}=${JSON.stringify(p[kind])}; reviewed C++ driver exports position only.`);
      }
    }
    if (typeof control === 'string') {
      const clean = control.replace(/<!--[\s\S]*?-->/g,'');
      if (!clean.includes('<ros2_control')) add('MISSING_ROS2_CONTROL_MODEL','ros2_control','Select the ros2_control xacro or expanded model as files.ros2_control.');
      for (const m of clean.matchAll(/<joint\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/joint>/g)) {
        const states = [...m[2].matchAll(/<state_interface\s+name=["']([^"']+)["']/g)].map(x => x[1]);
        if (states.some(x => x !== 'position')) add('MODEL_REQUIRES_UNEXPORTED_STATE','ros2_control',`${m[1]} declares ${states.join(', ')}. Inspect xacro conditions for the physical branch; no xacro was executed.`);
      }
      for (const field of ['commands_topic','states_topic']) {
        const value = new RegExp(`<param\\s+name=["']${field}["']>([^<]+)</param>`).exec(clean)?.[1];
        if (!value || value !== bridge[field]) add('HARDWARE_BRIDGE_TOPIC_MISMATCH','ros2_control',`${field}: model=${value ?? '(unresolved)'}, bridge=${bridge[field]}`);
      }
    }
    facts.motorToJoint = map;
    facts.selectedControllers = selected;
    facts.positionContract = 'Five arm joints use radians on ROS and degrees in the bridge; gripper uses its separate percentage/radian conversion. Static checks do not determine measured calibration or torque behavior.';
    facts.bridgeSourceSelected = Boolean(bridgeSource);
  } else if (recipe === 'beast') {
    const sourceText = String(read('bridge-source','text','beast_bringup/scripts/esp32_bridge.py') ?? '');
    const declared = [...sourceText.matchAll(/self\.declare_parameter\(\s*['"]([^'"]+)['"]\s*,\s*([^\n)]+)\)/g)].map(m => ({ name: m[1], defaultExpression: m[2].trim() }));
    facts.bridgeParameterDeclarations = declared;
    const selectedParameters = read('parameters','yaml');
    const parameters = object(selectedParameters), p = object(parameters['/**']?.ros__parameters);
    read('model','text'); read('launch','text');
    if (Object.keys(parameters).length && !Object.keys(p).length) add('MISSING_PARAMETER_NAMESPACE','parameters','Expected selected /**.ros__parameters, or supply the effective wildcard file used by this bridge.');
    if (Object.hasOwn(p,'watchdog_timeout') && !declared.some(d => d.name === 'watchdog_timeout')) add('UNUSED_WATCHDOG_PARAMETER','parameters',`watchdog_timeout=${p.watchdog_timeout} is not declared by this bridge; cmd_vel_timeout is a different parameter.`);
    if (selectedParameters !== undefined && !Object.hasOwn(p,'cmd_vel_timeout')) add('TIMEOUT_NOT_EXPLICIT','parameters',`cmd_vel_timeout is absent. Source default: ${declared.find(d => d.name === 'cmd_vel_timeout')?.defaultExpression ?? 'unresolved'}; launch overrides are not inferred.`);
    for (const key of ['baud_rate','track_radius','track_separation','max_linear_speed','max_angular_speed']) if (Object.keys(p).length && !(typeof p[key] === 'number' && Number.isFinite(p[key]) && p[key] > 0)) add('INVALID_DRIVE_PARAMETER','parameters',`${key} must be explicit and positive.`);
    facts.selectedBridgeParameters = selectedParameters === undefined ? { unavailable: true } : Object.fromEntries(declared.map(d => [d.name, Object.hasOwn(p,d.name) ? { selected: p[d.name] } : { absent: true, defaultExpression: d.defaultExpression }]));
    facts.voltagePolicy = 'Duplicate low_voltage_threshold keys are rejected with source line information. No voltage value is chosen automatically.';
  } else {
    const settings = object(read('settings','json')), controllers = object(read('controllers','yaml'));
    read('model','text'); read('launch','text');
    const sourceMap = String(read('endpoint-source','text','cartesian_motion_test/include/cartesian_motion_test/cartesian_motion_config.hpp') ?? '');
    read('motion-source','text','cartesian_motion_base/src/cartesian_motion_base.cpp');
    const roles = settings.config_type === 'single_arm' ? ['ur'] : settings.config_type === 'dual_arm' ? ['left','right'] : [];
    if (!roles.length) add('MISSING_CONFIG_TYPE','settings','Select single_arm or dual_arm.');
    const contexts: Obj = {}, claimedJoints = new Set<string>();
    for (const role of roles) {
      const name = (role === 'ur' ? '' : role+'_')+'cartesian_compliance_controller';
      const p = object(controllers[name]?.ros__parameters), joints = strings(p.joints);
      const endpoints = { pose: `/${name}/target_frame`, wrench: `/${name}/target_wrench`, joint: `/${name}/target_joint` };
      if (!Object.keys(p).length || !joints.length || new Set(joints).size !== joints.length) add('INVALID_CONTROLLER_JOINTS','controllers',name);
      for (const joint of joints) { if (claimedJoints.has(joint)) add('ARM_JOINT_COLLISION','controllers',`${role}: ${joint}`); claimedJoints.add(joint); }
      for (const field of ['robot_base_link','end_effector_link','ft_sensor_ref_link','compliance_ref_link']) if (typeof p[field] !== 'string' || !p[field]) add('MISSING_FRAME','controllers',`${name}.${field}`);
      for (const endpoint of Object.values(endpoints)) if (!sourceMap.includes('"'+endpoint+'"')) add('SOURCE_ENDPOINT_MISMATCH','endpoint-source',endpoint);
      if (p.hand_frame_control !== undefined && typeof p.hand_frame_control !== 'boolean') add('INVALID_WRENCH_FRAME_POLICY','controllers',name);
      contexts[role] = { controller: name, jointOrder: joints, robotBaseFrame: p.robot_base_link,
        endEffectorFrame: p.end_effector_link, wrenchFrame: p.hand_frame_control === true ? p.end_effector_link : p.robot_base_link,
        handFrameControl: p.hand_frame_control ?? false, forceEnabled: p.force_enable, endpoints };
    }
    facts.controllerContexts = contexts;
    facts.controllerContractSource = 'leledeyuan00/cartesian_controllers@b0832524b458232a8923403ca6694cd82f99572d (garment); source contract only, installed/deployed dependency not observed.';
    facts.wrenchHeaderPolicy = 'The reviewed targetWrenchCallback ignores header.frame_id. hand_frame_control selects end-effector coordinates when true and base coordinates when false (source default). Never infer a transform from the header.';
    if (request.files.commands) {
      const commands = read('commands','json');
      if (!Array.isArray(commands) || !commands.length) add('INVALID_COMMAND_LIST','commands','Provide a nonempty list of saved message envelopes.');
      else commands.forEach((raw: any, i: number) => {
        const c = object(raw), ctx = Object.hasOwn(contexts,c.role) ? contexts[c.role] : undefined, field = `commands[${i}]`;
        if (!ctx) { add('UNKNOWN_COMMAND_ROLE',field,String(c.role)); return; }
        const check = (ok: boolean, code: string, detail: string) => { if (!ok) add(code,field,detail); };
        if (c.type === 'geometry_msgs/msg/PoseStamped') {
          const parsed = pose.safeParse(c.message);
          check(parsed.success,'INVALID_POSE_MESSAGE',parsed.success ? '' : parsed.error.message);
          check(c.endpoint === ctx.endpoints.pose,'COMMAND_ENDPOINT_MISMATCH',ctx.endpoints.pose);
          check(c.units === 'm','MISSING_OR_WRONG_POSE_UNITS','Declare units=m for position.');
          if (parsed.success) { const q = parsed.data.pose.orientation;
            check(parsed.data.header.frame_id === ctx.robotBaseFrame,'POSE_FRAME_MISMATCH',`Receiver requires ${ctx.robotBaseFrame}.`);
            check(Math.abs(Math.hypot(q.x,q.y,q.z,q.w)-1) <= 1e-6,'INVALID_QUATERNION','Expected unit quaternion with named x,y,z,w components.'); }
        } else if (c.type === 'geometry_msgs/msg/WrenchStamped') {
          const parsed = wrench.safeParse(c.message);
          check(parsed.success,'INVALID_WRENCH_MESSAGE',parsed.success ? '' : parsed.error.message);
          check(c.endpoint === ctx.endpoints.wrench,'COMMAND_ENDPOINT_MISMATCH',ctx.endpoints.wrench);
          check(c.units === 'N,Nm','MISSING_OR_WRONG_WRENCH_UNITS','Declare units=N,Nm.');
          check(c.expressedIn === ctx.wrenchFrame,'WRENCH_FRAME_MISMATCH',`Explicit expressedIn must be ${ctx.wrenchFrame}; receiver ignores the message header.`);
          check(ctx.forceEnabled === true,'FORCE_CONTROL_NOT_ENABLED','Selected force_enable is not true; receipt does not establish an applied wrench.');
        } else if (c.type === 'cartesian_controller_msgs/srv/JointMove') {
          const parsed = jointMove.safeParse(c.message);
          check(parsed.success,'INVALID_JOINT_MOVE',parsed.success ? '' : parsed.error.message);
          check(c.endpoint === ctx.endpoints.joint,'COMMAND_ENDPOINT_MISMATCH',ctx.endpoints.joint);
          check(c.units === 'rad','MISSING_OR_WRONG_JOINT_UNITS','This reviewed UR example uses radians. Other joint types need a separately reviewed contract.');
          check(same(c.jointOrder,ctx.jointOrder),'JOINT_ORDER_MISMATCH','Declare the exact controller joint order; JointMove.cmd.data has no joint names.');
          if (parsed.success) { check(parsed.data.cmd.data.length === ctx.jointOrder.length,'JOINT_COUNT_MISMATCH',`${ctx.jointOrder.length} positions required.`);
            check(parsed.data.cmd.layout.data_offset === 0 && parsed.data.cmd.layout.dim.length === 0,'UNSUPPORTED_ARRAY_LAYOUT','Reviewed service uses the whole data array; select the flat, zero-offset form.'); }
        } else add('UNSUPPORTED_COMMAND_TYPE',field,String(c.type));
      });
      facts.savedCommandsReviewed = Array.isArray(commands) ? commands.length : 0;
    }
  }
  for (const id of Object.keys(request.files)) if (!selectedInputs.has(id)) add('UNREVIEWED_SELECTED_FILE', id, 'This recipe does not interpret this selected input; include it in the saved-file manifest for byte/semantic comparison.');
  return { schemaVersion: 1, recipe, id: request.id, sourceCommit: request.sourceCommit, scope: 'static-selected-inputs', hardwareDispatch: false,
    decision: issues.some(i => ['MISSING_INPUT','UNREADABLE_OR_INVALID','MISSING_CONTROLLER_SELECTION','MISSING_ROS2_CONTROL_MODEL'].includes(i.code)) ? 'NEEDS_MATERIAL' : issues.length ? 'REVIEW_REQUIRED' : 'NO_STATIC_ISSUES',
    issues, facts, evidence, limitations: ['No source module, ROS node, xacro, driver or robot was executed.',
      'Source commit and selected inputs are self-attested. This report is neither live state nor motion permission.',
      'A clear static report does not prove collision freedom, joint limits, calibration accuracy, compatibility or customer acceptance.'] };
}

export function savedInputMarkdown(report: ReturnType<typeof inspectSavedInputs>) {
  return `# Selected input inspection\n\n${report.decision} · ${report.recipe}\n\nHardware dispatch: none.\n\n`
    + report.issues.map(i => `- ${i.code} (${i.file}): ${i.detail}`).join('\n') + '\n\n'
    + JSON.stringify(report.facts,null,2).split('\n').map(line => '    '+line).join('\n') + '\n\n'
    + report.limitations.map(s => '- '+s).join('\n')+'\n';
}
