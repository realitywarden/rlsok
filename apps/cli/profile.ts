import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { approveProfile, evaluateProfile, hashObject, profileHash, profileSchema, type Profile } from '../../packages/composable-shadow';
import { executablePolicySpecSchema } from '../../packages/core/exec-spec';
import { createFanucFixture, createFanucPublicFixture, fixtureCalibration, fixtureControllerState, fixtureUrdf } from '../../packages/composable-shadow/fixture';
import { interfaceSchemas } from '../../packages/composable-shadow/json-schema';
import { readConnection } from '../../packages/composable-shadow/onboarding';
import { reportMarkdown, compareReports, comparisonMarkdown } from '../../packages/composable-shadow/report';
import { prepareSourceWorkspace, refreshSourceWorkspace } from '../../packages/composable-shadow/source-workspace';
import { sourceRecipes } from '../../packages/composable-shadow/source-recipes';
import { compareControllerExports, controllerComparisonMarkdown } from '../../packages/composable-shadow/controller-comparison';
import { prepareSo101ControllerSwap } from '../../packages/composable-shadow/so101-swap';
import { compareNav2ReviewInputs, nav2ReviewMarkdown } from '../../packages/composable-shadow/nav2-review';
import { approveNav2Goal, checkNav2BeforeShadowHandoff } from '../../packages/composable-shadow/nav2-gate';
import { approveTelloSnapshot, reviewTelloObservation, telloReportMarkdown } from '../../packages/composable-shadow/tello-shadow';

const help = `Composable ROS 2 Shadow profiles (local evaluation, zero dispatch)
  rlsok profile init --template fanuc-humble|fanucpy-public-humble|ros2-trajectory --output <new-directory>
  rlsok profile inspect --profile <profile.json>
  rlsok profile discover --output <new-catalog.json> [--python <python3>]
  rlsok profile configure --input <connection.json> --output <new-directory>
  rlsok profile inspect-connection --input <connection.json>
  rlsok profile source-recipes
  rlsok profile capture-tello --manifest <selected-files-and-service.json> --output <new-observation.json> [--python <python3>]
  rlsok profile approve-tello --observation <fresh-observation.json> --actor <name> --expires-at <RFC3339> --output <new-approval.json>
  rlsok profile review-tello --approval <approval.json> --observation <observation.json> --event <client-event.json> --output <new-directory>
  rlsok profile watch-tello --manifest <manifest.json> --socket <private-unix-socket> --output <new-directory> [--approval <approval.json>] [--duration <seconds>] [--python <python3>]
  rlsok profile compare-nav2 --baseline <nav2-input.json> --changed <nav2-input.json> --output <new-directory>
  rlsok profile capture-nav2 --manifest <nav2-manifest.json> --output <new-observation.json> [--python <python3>]
  rlsok profile approve-nav2 --observation <fresh-observation.json> --goal <follow-path-goal.json> --actor <name> --expires-at <RFC3339> --output <new-approval.json>
  rlsok profile shadow-nav2 --manifest <nav2-manifest.json> --approval <approval.json> --goal <follow-path-goal.json> --output <new-directory> [--python <python3>]
  rlsok profile compare-controllers --baseline <state.json> --changed <state.json> --output <new-directory>
  rlsok profile prepare-so101-swap --input <ros2_controllers.yaml> --output <new-controllers.yaml>
  rlsok profile export-controller --manager </controller_manager> --controller <name> --node </controller_node> --output <new-state.json> [--python <python3>]
  rlsok profile export-node-settings --node </node> --output <new-settings.json> [--downstream-node </node> --topic </topic> --type <package/msg/Name>] [--python <python3>]
  rlsok profile prepare-source --recipe <id> --source <checkout> --catalog <catalog.json> --urdf <expanded.urdf> --settings <runtime-settings.json> --example <message-or-goal.json> --device-id <local-id> --output <new-directory> [--frame <frame>] [--subscriber </node>] [--controller-state <state.json>] [--node-settings <node-settings.json>]
  rlsok profile refresh-source --workspace <directory> --source <checkout> --urdf <expanded.urdf> --settings <runtime-settings.json> [--controller-state <state.json>] [--node-settings <node-settings.json>]
  rlsok profile schema --output <new-directory>
  rlsok profile approve --profile <profile.json> --actor <name> --expires-at <RFC3339> --output <new-approval.json>
  rlsok profile capture --profile <profile.json> --output <new-observation.json> [--python <python3>]
  rlsok profile describe-interface --type <package/action/Name|package/msg/Name> [--python <python3>]
  rlsok profile fingerprint-controller --input <active-controller-export.json> --output <new-controller-state.json> [--python <python3>]
  rlsok profile verify-assessment --assessment <path.assessment.json> --release <path.release.json>
  rlsok profile shadow --profile <profile.json> --approval <approval.json> --observation <observation.json> --proposals <proposals.json> --output <new-directory>
  rlsok profile compare --profile <profile.json> --approval <approval.json> --baseline <observation.json> --changed <observation.json> --proposals <proposals.json> --output <new-directory>
  rlsok profile demo --output <new-directory>
Templates contain synthetic example values. Replace them before local ROS evaluation.
Approval is a local Shadow baseline, not Cloud approval or permission to move a robot.
`;

function options(args: string[], allowed: string[], required: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2);
    if (!args[i]?.startsWith('--') || !allowed.includes(key) || result[key] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`invalid profile option: ${args[i]}`);
    result[key] = args[i + 1];
  }
  for (const key of required) if (!result[key]) throw new Error(`missing --${key}`);
  return result;
}
function read(path: string): unknown {
  if (!statSync(path).isFile() || statSync(path).size > 2 * 1024 * 1024) throw new Error('profile_input_must_be_a_file_under_2MiB');
  return JSON.parse(readFileSync(path, 'utf8'));
}
function write(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}
function newDirectory(path: string): string {
  const target = resolve(path);
  if (existsSync(target)) throw new Error(`output_already_exists:${target}`);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  return target;
}
function collectorScript(): string {
  let directory = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = join(directory, 'experimental', 'composable-shadow', 'collect.py');
    if (existsSync(candidate)) return candidate;
    directory = dirname(directory);
  }
  throw new Error('composable_shadow_collector_missing');
}
function python(options: Record<string, string>, args: string[], script = collectorScript()): number {
  const result = spawnSync(options.python ?? (process.platform === 'win32' ? 'python' : 'python3'), [script, ...args], {
    stdio: 'inherit', timeout: 60_000, windowsHide: true
  });
  if (result.error) throw result.error;
  return result.status === 0 ? 0 : 2;
}

function initialize(output: string, template: string, now = new Date()) {
  if (!['fanuc-humble', 'fanucpy-public-humble', 'ros2-trajectory'].includes(template)) throw new Error('unknown_profile_template');
  const fixture = template === 'fanucpy-public-humble' ? createFanucPublicFixture(now) : createFanucFixture(now);
  if (template === 'ros2-trajectory') {
    fixture.profile.id = 'ros2-trajectory-example';
    fixture.profile.robot = { ...fixture.profile.robot, deviceId: 'isolated-ros2-example', model: 'User-defined ROS 2 arm', controller: 'User-defined ROS 2 controller' };
    fixture.profile.paths = fixture.profile.paths.filter(p => p.adapter === 'joint_trajectory');
    fixture.observation.profileId = fixture.profile.id;
    fixture.observation.paths = fixture.observation.paths.filter(p => p.id === fixture.profile.paths[0].id);
    fixture.proposals.proposals = fixture.proposals.proposals.filter(p => p.pathId === fixture.profile.paths[0].id);
  }
  const directory = newDirectory(output);
  write(join(directory, 'profile.json'), fixture.profile);
  write(join(directory, 'fixture-observation.json'), fixture.observation);
  write(join(directory, 'proposals.json'), fixture.proposals);
  write(join(directory, 'controller-state.json'), fixtureControllerState(fixture.profile, now));
  writeFileSync(join(directory, 'eye-to-hand.yaml'), fixtureCalibration, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'robot.urdf'), fixtureUrdf, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'README.md'), `# Composable Shadow workspace\n\nThis is a **synthetic example**, not a verified FANUC integration.\n\nEdit profile.json to match your actual ROS domain, RMW, robot model, joint order, endpoints, custom action types, interface hashes and fact sources. All paths are required. Unlisted robot actions are outside the evaluation.\n\nUse rlsok profile describe-interface for each installed action type. Read-only controller exports must contain their actual observedAt timestamp; never replace stale timestamps just to pass. Local calibration files are only proxies for the active robot calibration unless your exporter verifies that binding.\n\nSee the installed docs/composable-shadow.md for the complete setup, approval, capture, evaluation and evidence verification procedure. The fixture-observation.json exists only for learning; capture a fresh observation to inspect a ROS graph.\n`, { flag: 'wx' });
  return { directory, ...fixture };
}
function saveReport(directory: string, report: Awaited<ReturnType<typeof evaluateProfile>>): void {
  write(join(directory, 'report.json'), report);
  writeFileSync(join(directory, 'report.md'), reportMarkdown(report), { flag: 'wx', mode: 0o600 });
  for (const result of report.results) {
    write(join(directory, `${result.pathId}.assessment.json`), result.assessment);
    write(join(directory, `${result.pathId}.release.json`), result.release);
    write(join(directory, `${result.pathId}.evidence.json`), result.evidence);
  }
}
function printReport(directory: string, report: Awaited<ReturnType<typeof evaluateProfile>>): void {
  process.stdout.write(`${report.decision} | ${report.collector} | local Shadow | hardware dispatch: NO\n`);
  for (const result of report.results) process.stdout.write(`  ${result.pathId}: ${result.decision} (${result.reason})\n`);
  process.stdout.write(`Report: ${join(directory, 'report.json')}\n`);
}

export async function runProfileCommand(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (!command || ['help', '--help', '-h'].includes(command)) { process.stdout.write(help); return 0; }
  if (command === 'capture-tello') {
    const o = options(rest, ['manifest', 'output', 'python'], ['manifest', 'output']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['--manifest', resolve(o.manifest), '--output', resolve(o.output)], join(dirname(collectorScript()), 'tello-passive/tello_context.py'));
  }
  if (command === 'approve-tello') {
    const o = options(rest, ['observation', 'actor', 'expires-at', 'output'], ['observation', 'actor', 'expires-at', 'output']);
    write(o.output, approveTelloSnapshot(read(o.observation), o.actor, o['expires-at']));
    process.stdout.write('Reviewed the observed Tello software binding for passive local Shadow only.\n');
    return 0;
  }
  if (command === 'review-tello') {
    const o = options(rest, ['approval', 'observation', 'event', 'output'], ['approval', 'observation', 'event', 'output']);
    const report = reviewTelloObservation({ approval: read(o.approval), observation: read(o.observation), event: read(o.event) });
    const directory = newDirectory(o.output);
    write(join(directory, 'report.json'), report);
    writeFileSync(join(directory, 'report.md'), telloReportMarkdown(report), { flag: 'wx', mode: 0o600 });
    process.stdout.write(`${report.decision}: ${report.reasons.join(',') || 'selected configuration matched'} | passive: 0 commands sent, 0 commands blocked\n`);
    return report.decision === 'WOULD_ALLOW' ? 0 : 1;
  }
  if (command === 'watch-tello') {
    const o = options(rest, ['manifest', 'approval', 'socket', 'output', 'duration', 'python'], ['manifest', 'socket', 'output']);
    const duration = Number(o.duration ?? 300);
    if (!(Number.isFinite(duration) && duration > 0 && duration <= 3600)) throw new Error('invalid_tello_duration');
    const result = spawnSync(o.python ?? (process.platform === 'win32' ? 'python' : 'python3'),
      [join(dirname(collectorScript()), 'tello-passive/tello_watch.py'), '--manifest', resolve(o.manifest),
        ...(o.approval ? ['--approval', resolve(o.approval)] : []), '--socket', resolve(o.socket), '--output', resolve(o.output),
        '--node', process.execPath, '--cli', join(__dirname, 'rlsok.js'), '--duration', String(duration)],
      { stdio: 'inherit', timeout: (duration + 45) * 1000, windowsHide: true });
    if (result.error) throw result.error;
    return result.status === 0 ? 0 : 2;
  }
  if (command === 'export-node-settings') {
    const o = options(rest, ['node', 'output', 'downstream-node', 'topic', 'type', 'python'], ['node', 'output']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    const link = ['downstream-node', 'topic', 'type'].flatMap(key => o[key] ? [`--${key}`, o[key]] : []);
    return python(o, ['--node', o.node, '--output', resolve(o.output), ...link], join(dirname(collectorScript()), 'node_settings.py'));
  }
  if (command === 'capture-nav2') {
    const o = options(rest, ['manifest', 'output', 'python'], ['manifest', 'output']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['--manifest', resolve(o.manifest), '--output', resolve(o.output)], join(dirname(collectorScript()), 'nav2_observe.py'));
  }
  if (command === 'approve-nav2') {
    const o = options(rest, ['observation', 'goal', 'actor', 'expires-at', 'output'], ['observation', 'goal', 'actor', 'expires-at', 'output']);
    write(o.output, approveNav2Goal(read(o.observation), read(o.goal), o.actor, o['expires-at']));
    process.stdout.write('Reviewed this exact goal and observed Nav2 configuration for local Shadow only.\n');
    return 0;
  }
  if (command === 'shadow-nav2') {
    const o = options(rest, ['manifest', 'approval', 'goal', 'output', 'python'], ['manifest', 'approval', 'goal', 'output']);
    const directory = newDirectory(o.output), goal = read(o.goal);
    const report = await checkNav2BeforeShadowHandoff({ approval: read(o.approval), goal,
      capture: async () => {
        const result = spawnSync(o.python ?? (process.platform === 'win32' ? 'python' : 'python3'),
          [join(dirname(collectorScript()), 'nav2_observe.py'), '--manifest', resolve(o.manifest)],
          { encoding: 'utf8', timeout: 30000, maxBuffer: 2*1024*1024, windowsHide: true });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`nav2_capture_failed:${result.stderr.slice(-2000)}`);
        return JSON.parse(result.stdout);
      }, recordShadowHandoff: checkedGoal => write(join(directory, 'shadow-handoff.json'), {
        kind: 'RlsokNav2ShadowHandoff', goal: checkedGoal, hardwareDispatch: 'NO', actionGoalsSent: 0, velocityCommandsPublished: 0 }) });
    write(join(directory, 'report.json'), report);
    process.stdout.write(`${report.decision}: ${report.reason} | hardware dispatch: NO\n${directory}\n`);
    return report.decision === 'WOULD_ALLOW' ? 0 : 1;
  }
  if (command === 'export-controller') {
    const o = options(rest, ['manager', 'controller', 'node', 'output', 'python'], ['manager', 'controller', 'node', 'output']);
    return python(o, ['--manager', o.manager, '--controller', o.controller, '--node', o.node, '--output', resolve(o.output)], join(dirname(collectorScript()), 'controller_state.py'));
  }
  if (command === 'source-recipes') {
    options(rest, [], []);
    process.stdout.write(`${JSON.stringify(sourceRecipes, null, 2)}\nPublic source mappings only; verify the actual local graph and files.\n`);
    return 0;
  }
  if (command === 'compare-controllers') {
    const o = options(rest, ['baseline', 'changed', 'output'], ['baseline', 'changed', 'output']);
    const report = await compareControllerExports(read(o.baseline), read(o.changed));
    const directory = newDirectory(o.output);
    write(join(directory, 'controller-comparison.json'), report);
    writeFileSync(join(directory, 'controller-comparison.md'), controllerComparisonMarkdown(report), { flag: 'wx', mode: 0o600 });
    process.stdout.write(`Controller configuration ${report.configurationMatches ? 'matches' : 'changed'}; ${report.differences.length} differing groups. Historical comparison only.\n${directory}\n`);
    return 0;
  }
  if (command === 'prepare-so101-swap') {
    // Configuration copy only; controller changes are never dispatched by this CLI.
    const o = options(rest, ['input', 'output'], ['input', 'output']);
    if (!statSync(o.input).isFile() || statSync(o.input).size > 2 * 1024 * 1024) throw new Error('controller_yaml_must_be_a_file_under_2MiB');
    const yaml = prepareSo101ControllerSwap(readFileSync(o.input, 'utf8'));
    writeFileSync(resolve(o.output), yaml, { flag: 'wx', mode: 0o600 });
    process.stdout.write('Prepared SO-101 controller-type change; five arm joints and gripper configuration preserved. File only: no controller was switched.\n');
    return 0;
  }
  if (command === 'compare-nav2') {
    const o = options(rest, ['baseline', 'changed', 'output'], ['baseline', 'changed', 'output']);
    const report = compareNav2ReviewInputs(read(o.baseline), read(o.changed));
    const directory = newDirectory(o.output);
    write(join(directory, 'nav2-review.json'), report);
    writeFileSync(join(directory, 'nav2-review.md'), nav2ReviewMarkdown(report), { flag: 'wx', mode: 0o600 });
    process.stdout.write(`${report.result} | supplied Nav2 inputs | hardware dispatch: NO | not execution approval\n${directory}\n`);
    return report.result === 'INCOMPLETE' ? 2 : report.result === 'REVIEW_REQUIRED' ? 1 : 0;
  }
  if (command === 'prepare-source') {
    const o = options(rest, ['recipe', 'source', 'catalog', 'urdf', 'settings', 'example', 'device-id', 'output', 'frame', 'subscriber', 'controller-state', 'node-settings'],
      ['recipe', 'source', 'catalog', 'urdf', 'settings', 'example', 'device-id', 'output']);
    const directory = await prepareSourceWorkspace({ recipe: o.recipe, source: o.source, catalog: o.catalog, urdf: o.urdf,
      settings: o.settings, example: o.example, deviceId: o['device-id'], output: o.output, frame: o.frame, subscriber: o.subscriber, controllerState: o['controller-state'], nodeSettings: o['node-settings'] });
    process.stdout.write(`Source review workspace: ${directory}\nReview all inputs before approving. No observation, approval or robot command was generated.\n`);
    return 0;
  }
  if (command === 'refresh-source') {
    const o = options(rest, ['workspace', 'source', 'urdf', 'settings', 'controller-state', 'node-settings'], ['workspace', 'source', 'urdf', 'settings']);
    await refreshSourceWorkspace({ workspace: o.workspace, source: o.source, urdf: o.urdf, settings: o.settings, controllerState: o['controller-state'], nodeSettings: o['node-settings'] });
    process.stdout.write('Local source inputs refreshed. Approved profile and evidence unchanged. Capture a fresh observation next.\n');
    return 0;
  }
  if (command === 'discover') {
    const o = options(rest, ['output', 'python'], ['output']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['--discover', '--output', resolve(o.output)]);
  }
  if (command === 'configure' || command === 'inspect-connection') {
    const o = options(rest, command === 'configure' ? ['input', 'output'] : ['input'], command === 'configure' ? ['input', 'output'] : ['input']);
    const connection = await readConnection(read(o.input));
    if (command === 'configure') {
      const directory = newDirectory(o.output);
      write(join(directory, 'profile.json'), connection.profile);
      write(join(directory, 'proposals.json'), connection.proposals);
      write(join(directory, 'catalog.json'), connection.catalog);
      write(join(directory, 'connection.json'), connection);
      writeFileSync(join(directory, 'REQUIRED-FILES.txt'), connection.profile.facts.map(fact => `${fact.path}\n`).join(''), { flag: 'wx', mode: 0o600 });
      process.stdout.write(`Configuration saved: ${directory}\nCopy your actual fact files into the relative locations in REQUIRED-FILES.txt. No controller state or approvals were generated.\n`);
    }
    process.stdout.write(`Configuration and mapped example goals are valid for ${connection.profile.paths.length} declared paths.\nCatalog is a local snapshot, not a fresh observation or compatibility certificate. Continue with local approve, capture and shadow.\n`);
    return 0;
  }
  if (command === 'init') {
    const o = options(rest, ['template', 'output'], ['template', 'output']);
    const fixture = initialize(o.output, o.template);
    process.stdout.write(`Created example workspace: ${fixture.directory}\nReplace synthetic values before ROS evaluation.\n`);
    return 0;
  }
  if (command === 'inspect') {
    const o = options(rest, ['profile'], ['profile']);
    const p: Profile = profileSchema.parse(read(o.profile));
    process.stdout.write(`${JSON.stringify({ profileId: p.id, profileSha256: profileHash(p), mode: p.mode,
      paths: p.paths.map(a => ({ id: a.id, adapter: a.adapter, endpoint: a.endpoint, checks: a.checks })),
      scope: 'configuration validation only; use capture and shadow for observed state' }, null, 2)}\n`);
    return 0;
  }
  if (command === 'schema') {
    const o = options(rest, ['output'], ['output']);
    const directory = newDirectory(o.output);
    for (const [name, schema] of Object.entries(interfaceSchemas())) write(join(directory, name), schema);
    process.stdout.write(`Interface schemas saved: ${directory}\nSee manifest.json for semantic checks enforced by the CLI.\n`);
    return 0;
  }
  if (command === 'approve') {
    const o = options(rest, ['profile', 'actor', 'expires-at', 'output'], ['profile', 'actor', 'expires-at', 'output']);
    write(resolve(o.output), approveProfile(read(o.profile), o.actor, o['expires-at']));
    process.stdout.write(`Local Shadow baseline saved: ${resolve(o.output)}\n`);
    return 0;
  }
  if (command === 'describe-interface') {
    const o = options(rest, ['type', 'python'], ['type']);
    return python(o, ['--describe-interface', o.type]);
  }
  if (command === 'fingerprint-controller') {
    const o = options(rest, ['input', 'output', 'python'], ['input', 'output']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['--fingerprint-controller', resolve(o.input), '--output', resolve(o.output)]);
  }
  if (command === 'verify-assessment') {
    const o = options(rest, ['assessment', 'release'], ['assessment', 'release']);
    const assessment = read(o.assessment);
    const release = executablePolicySpecSchema.parse(read(o.release));
    if (hashObject(assessment) !== release.evidence.testReportSha256) throw new Error('assessment_hash_mismatch');
    process.stdout.write('Assessment hash matches the supplied release. Verify its Evidence separately; this does not authenticate the source.\n');
    return 0;
  }
  if (command === 'capture') {
    const o = options(rest, ['profile', 'output', 'python'], ['profile', 'output']);
    profileSchema.parse(read(o.profile));
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['--profile', resolve(o.profile), '--output', resolve(o.output)]);
  }
  if (command === 'compare') {
    const o = options(rest, ['profile', 'approval', 'baseline', 'changed', 'proposals', 'output'], ['profile', 'approval', 'baseline', 'changed', 'proposals', 'output']);
    const shared = { profile: read(o.profile), approval: read(o.approval), proposals: read(o.proposals), now: new Date() };
    const baseline = await evaluateProfile({ ...shared, observation: read(o.baseline) });
    const changed = await evaluateProfile({ ...shared, observation: read(o.changed) });
    const comparison = compareReports(baseline, changed);
    const directory = newDirectory(o.output);
    saveReport(newDirectory(join(directory, 'baseline')), baseline);
    saveReport(newDirectory(join(directory, 'changed')), changed);
    write(join(directory, 'comparison.json'), comparison);
    writeFileSync(join(directory, 'comparison.md'), comparisonMarkdown(comparison), { flag: 'wx', mode: 0o600 });
    printReport(join(directory, 'baseline'), baseline); printReport(join(directory, 'changed'), changed);
    process.stdout.write(`Comparison: ${join(directory, 'comparison.md')}\nReview the exact failed checks; stale/missing data can also block.\n`);
    return 0;
  }
  if (command === 'shadow') {
    const o = options(rest, ['profile', 'approval', 'observation', 'proposals', 'output'], ['profile', 'approval', 'observation', 'proposals', 'output']);
    const report = await evaluateProfile({ profile: read(o.profile), approval: read(o.approval), observation: read(o.observation), proposals: read(o.proposals) });
    const directory = newDirectory(o.output);
    saveReport(directory, report); printReport(directory, report);
    return report.decision === 'WOULD_ALLOW' ? 0 : 2;
  }
  if (command === 'demo') {
    const o = options(rest, ['output'], ['output']);
    const now = new Date();
    const fixture = initialize(o.output, 'fanuc-humble', now);
    const approval = approveProfile(fixture.profile, 'fixture-operator', new Date(now.getTime() + 3600_000).toISOString(), now);
    write(join(fixture.directory, 'fixture-approval.json'), approval);
    const normal = await evaluateProfile({ ...fixture, approval, now });
    const baseline = newDirectory(join(fixture.directory, 'baseline'));
    saveReport(baseline, normal); printReport(baseline, normal);
    const changed = structuredClone(fixture.observation);
    changed.facts.find(f => f.id === 'calibration')!.value = 'f'.repeat(64);
    write(join(fixture.directory, 'changed-calibration-observation.json'), changed);
    const negative = await evaluateProfile({ ...fixture, approval, observation: changed, now });
    const negativeOutput = newDirectory(join(fixture.directory, 'changed-calibration'));
    saveReport(negativeOutput, negative); printReport(negativeOutput, negative);
    if (normal.decision !== 'WOULD_ALLOW' || negative.decision !== 'WOULD_BLOCK') throw new Error('composable_shadow_demo_failed');
    return 0;
  }
  throw new Error(`unknown profile command: ${command}`);
}
