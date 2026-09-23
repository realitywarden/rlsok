import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { approveProfile, evaluateProfile, hashObject, profileHash, profileSchema, type Profile } from '../../packages/composable-shadow';
import { executablePolicySpecSchema } from '../../packages/core/exec-spec';
import { createFanucFixture, createFanucPublicFixture, fixtureCalibration, fixtureControllerState, fixtureUrdf } from '../../packages/composable-shadow/fixture';
import { interfaceSchemas } from '../../packages/composable-shadow/json-schema';
import { readConnection } from '../../packages/composable-shadow/onboarding';
import { composeConnectionTemplates, connectionTemplateSchema, planConnectionTemplate } from '../../packages/composable-shadow/templates';
import { reportMarkdown, compareReports, comparisonMarkdown } from '../../packages/composable-shadow/report';
import { prepareSourceWorkspace, refreshSourceWorkspace } from '../../packages/composable-shadow/source-workspace';
import { sourceRecipes } from '../../packages/composable-shadow/source-recipes';
import { compareControllerExports, controllerComparisonMarkdown } from '../../packages/composable-shadow/controller-comparison';
import { prepareSo101ControllerSwap } from '../../packages/composable-shadow/so101-swap';
import { compareNav2ReviewInputs, nav2ReviewMarkdown } from '../../packages/composable-shadow/nav2-review';
import { approveNav2Goal, checkNav2BeforeShadowHandoff } from '../../packages/composable-shadow/nav2-gate';
import { approveTelloSnapshot, reviewTelloObservation, telloReportMarkdown } from '../../packages/composable-shadow/tello-shadow';
import { approveSavedSetup, captureSavedSetup, resolveSavedSetup, reviewSavedSetup, savedDocument, savedSetupMarkdown } from '../../packages/composable-shadow/saved-setup';
import { prepareSavedSetup } from '../../packages/composable-shadow/saved-setup-recipes';
import { preparePiperSetup } from '../../packages/composable-shadow/piper-setup';
import { inspectSavedInputs, savedInputMarkdown } from '../../packages/composable-shadow/saved-input-review';
import { evaluateNavigationPreflight, navigationPreflightMarkdown } from '../../packages/composable-shadow/navigation-preflight';
import { compareCreate3VersionFiles, create3VersionMarkdown } from '../../packages/composable-shadow/create3-version';
import { composeLocalDataTemplates, evaluateLocalDataWorkspace, prepareLocalDataWorkspace, readLocalFileSource } from '../../packages/composable-shadow/local-data';

const help = `Composable ROS 2 Shadow profiles (local evaluation, zero dispatch)
  rlsok profile init --template fanuc-humble|fanucpy-public-humble|ros2-trajectory --output <new-directory>
  rlsok profile inspect --profile <profile.json>
  rlsok profile discover --output <new-catalog.json> [--python <python3>]
  rlsok profile configure --input <connection.json> --output <new-directory>
  rlsok profile inspect-connection --input <connection.json>
  rlsok profile inspect-template --input <template.json> [--catalog <fresh-catalog.json>]
  rlsok profile compose-templates --input <first.json> [--input <next.json> ...] --output <new-template.json>
  rlsok profile compose-local-data-templates --input <first.json> [--input <next.json> ...] --output <new-template.json>
  rlsok profile prepare-local-data --template <rules.json> --parser <json-records/v1|yaml-records/v1> --source <actual-file> --device-id <id> --confirm-semantics yes --output <new-directory>
  rlsok profile check-local-data --workspace <workspace.json> --source <current-file> --output <new-report.json>
  rlsok profile source-recipes
  rlsok profile prepare-piper-setup --input <confirmed-roles.yaml> --source <checkout> --source-commit <sha> --id <review-id> --output <new-directory>
  rlsok profile prepare-saved-setup --recipe <piper|metal|aditya-so101|beast|cartesian|kuka-sunrise|armpilot-remote|armpilot-3d|pioneer-x|modular-diffbot|piper-cpp|robstride-command-envelope|dobot-magician-homing|lerobot-so101-direct> --source <checkout> --input <selected-files.json> --output <new-directory>
  rlsok profile inspect-saved-inputs --recipe <aditya-so101|beast|cartesian|bounded-operation> --source <checkout> --input <selected-files.json> --output <new-directory>
  rlsok profile compare-create3-versions --baseline <saved-version.txt> --current <saved-version.txt> --output <new-directory> [--fields <comma-separated-field-names>]
  rlsok profile discover-setup-devices --output <new-inventory.json> [--python <python3>]
  rlsok profile resolve-setup --manifest <manifest.json> --inventory <inventory.json> --output <new-directory>
  rlsok profile capture-setup --manifest <manifest.json> [--inventory <inventory.json>] --output <new-observation.json>
  rlsok profile approve-setup --observation <observation.json> --actor <name> --output <new-baseline.json>
  rlsok profile review-setup --baseline <baseline.json> --observation <observation.json> --output <new-directory>
  rlsok profile capture-tello --manifest <selected-files-and-service.json> --output <new-observation.json> [--python <python3>]
  rlsok profile approve-tello --observation <fresh-observation.json> --actor <name> --expires-at <RFC3339> --output <new-approval.json>
  rlsok profile review-tello --approval <approval.json> --observation <observation.json> --event <client-event.json> --output <new-directory>
  rlsok profile watch-tello --manifest <manifest.json> --socket <private-unix-socket> --output <new-directory> [--approval <approval.json>] [--duration <seconds>] [--python <python3>]
  rlsok profile compare-nav2 --baseline <nav2-input.json> --changed <nav2-input.json> --output <new-directory>
  rlsok profile check-navigation-preflight --input <observation.json> --output <new-directory>
  rlsok profile capture-nav2 --manifest <nav2-manifest.json> --output <new-observation.json> [--python <python3>]
  rlsok profile approve-nav2 --observation <fresh-observation.json> --goal <follow-path-goal.json> --actor <name> --expires-at <RFC3339> --output <new-approval.json>
  rlsok profile shadow-nav2 --manifest <nav2-manifest.json> --approval <approval.json> --goal <follow-path-goal.json> --output <new-directory> [--python <python3>]
  rlsok profile compare-controllers --baseline <state.json> --changed <state.json> --output <new-directory>
  rlsok profile prepare-so101-swap --input <ros2_controllers.yaml> --output <new-controllers.yaml>
  rlsok profile export-controller --manager </controller_manager> --controller <name> --node </controller_node> --output <new-state.json> [--python <python3>]
  rlsok profile export-node-settings --node </node> --output <new-settings.json> [--downstream-node </node> --topic </topic> --type <package/msg/Name>] [--python <python3>]
  rlsok profile capture-mira-status --source-root <actual-checkout> --output <new-observation.json> [--python <python3>]
  rlsok profile capture-trik-status --source-root <actual-checkout> --output <new-observation.json> [--python <python3>]
  rlsok profile capture-lely-status --source-root <actual-checkout> --bridge-variant <python|cpp> --output <new-observation.json> [--python <python3>]
  rlsok profile capture-rebot-status --source-root <actual-checkout> --output <new-observation.json> [--python <python3>]
  rlsok profile capture-mowgli-status --source-root <actual-checkout> --output <new-observation.json> [--settings <selected-saved-settings.json>] [--python <python3>]
  rlsok profile compare-mowgli-status --baseline <saved-observation.json> --current <saved-observation.json> --output <new-report.json> [--python <python3>]
  rlsok profile capture-dual-kinova-status --source-root <actual-checkout> --output <new-observation.json> [--python <python3>]
  rlsok profile capture-ishan-gazebo-status --source-root <actual-checkout> --output <new-observation.json> [--python <python3>]
  rlsok profile capture-ruiyan-hand-status --port </dev/ttyUSB0> --device-id <1-254> --motor-count <1-8> --baud <9600-5000000> --confirm-read-only yes --output <new-observation.json> [--tactile-coefficient-index <0-255>] [--python <python3>]
  rlsok profile capture-pidog-status --repo <pidog-embodiment-checkout> --source-commit <full-sha1> --output <new-observation.json> [--units-directory </etc/systemd/system>] [--python <python3>]
  rlsok profile prepare-workbench-offline-shadow --source-root <workbench-checkout> --expected-commit <full-sha1> --demo-json <make-demo-offline-output.json> --output <tested-draft.json> [--python <python3>]
  rlsok profile approve-workbench-offline-shadow --draft <tested-draft.json> --approver <independent-reviewer> --approved-at <RFC3339> --output <approval.json> [--python <python3>]
  rlsok profile evaluate-workbench-offline-shadow --baseline-draft <approved-draft.json> --changed-draft <changed-draft.json> --approval <approval.json> --source-root <workbench-checkout> --output <result.json> [--python <python3>]
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
function compositionOptions(args: string[]): { inputs: string[]; output: string } {
  const inputs: string[] = [];
  let output = '';
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.slice(2), value = args[index + 1];
    if (!args[index]?.startsWith('--') || !value || value.startsWith('--') || !['input', 'output'].includes(key)) throw new Error(`invalid profile option: ${args[index]}`);
    if (key === 'input') inputs.push(value);
    else if (output) throw new Error('duplicate --output');
    else output = value;
  }
  if (!inputs.length) throw new Error('missing --input');
  if (!output) throw new Error('missing --output');
  if (inputs.length > 16) throw new Error('template_composition_requires_1_to_16_fragments');
  return { inputs, output };
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
  if (command === 'prepare-saved-setup') {
    const o = options(rest, ['recipe', 'source', 'input', 'output'], ['recipe', 'source', 'input', 'output']);
    process.stdout.write(JSON.stringify(prepareSavedSetup(o.recipe, resolve(o.source), resolve(o.input), resolve(o.output)), null, 2) + '\n');
    return 0;
  }
  if (command === 'discover-setup-devices') {
    const o = options(rest, ['output', 'python'], ['output']);
    return python(o, ['--output', resolve(o.output)], join(dirname(collectorScript()), 'setup_devices.py'));
  }
  if (command === 'resolve-setup') {
    const o = options(rest, ['manifest', 'inventory', 'output'], ['manifest', 'inventory', 'output']);
    process.stdout.write(JSON.stringify(resolveSavedSetup(savedDocument(o.manifest, 'json'), resolve(o.manifest), savedDocument(o.inventory, 'json'), resolve(o.output)), null, 2) + '\n');
    return 0;
  }
  if (command === 'inspect-saved-inputs') {
    const o = options(rest, ['recipe', 'source', 'input', 'output'], ['recipe', 'source', 'input', 'output']);
    const report = inspectSavedInputs(o.recipe, o.source, o.input);
    const directory = newDirectory(o.output);
    write(join(directory, 'report.json'), report);
    writeFileSync(join(directory, 'report.md'), savedInputMarkdown(report), { flag: 'wx', mode: 0o600 });
    process.stdout.write(`${report.decision} | static selected inputs | hardware dispatch: NO\n`);
    return report.decision === 'NO_STATIC_ISSUES' ? 0 : 1;
  }
  if (command === 'compare-create3-versions') {
    const o = options(rest, ['baseline', 'current', 'output', 'fields'], ['baseline', 'current', 'output']);
    const report = compareCreate3VersionFiles(o.baseline, o.current, o.fields);
    const directory = newDirectory(o.output);
    write(join(directory, 'report.json'), report);
    writeFileSync(join(directory, 'report.md'), create3VersionMarkdown(report), { flag: 'wx', mode: 0o600 });
    process.stdout.write(`${report.decision} | selected saved Create 3 fields only | robot contacted: NO | hardware dispatch: NO\n`);
    return report.decision === 'UNCHANGED' ? 0 : 1;
  }
  if (command === 'capture-setup') {
    const o = options(rest, ['manifest', 'inventory', 'output'], ['manifest', 'output']);
    const snapshot = captureSavedSetup(savedDocument(o.manifest, 'json'), resolve(o.manifest), o.inventory ? savedDocument(o.inventory, 'json') : undefined);
    write(o.output, snapshot);
    process.stdout.write(`${snapshot.status} | selected saved files only | hardware dispatch: NO\n`);
    for (const issue of snapshot.issues) process.stdout.write(`  ${issue}\n`);
    return snapshot.status === 'READY_FOR_REVIEW' ? 0 : 1;
  }
  if (command === 'approve-setup') {
    const o = options(rest, ['observation', 'actor', 'output'], ['observation', 'actor', 'output']);
    write(o.output, approveSavedSetup(savedDocument(o.observation, 'json'), o.actor));
    process.stdout.write('Saved your reviewed configuration baseline. This is not robot execution approval.\n');
    return 0;
  }
  if (command === 'review-setup') {
    const o = options(rest, ['baseline', 'observation', 'output'], ['baseline', 'observation', 'output']);
    const report = reviewSavedSetup(savedDocument(o.baseline, 'json'), savedDocument(o.observation, 'json'));
    const directory = newDirectory(o.output);
    write(join(directory, 'report.json'), report);
    writeFileSync(join(directory, 'report.md'), savedSetupMarkdown(report), { flag: 'wx', mode: 0o600 });
    process.stdout.write(`${report.decision} | selected saved files only | hardware dispatch: NO\n`);
    return report.decision === 'UNCHANGED' ? 0 : 1;
  }
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
  if (command === 'prepare-piper-setup') {
    const o = options(rest, ['input', 'source', 'source-commit', 'id', 'output'], ['input', 'source', 'source-commit', 'id', 'output']);
    process.stdout.write(JSON.stringify(preparePiperSetup(o.input, o.source, o['source-commit'], o.id, o.output), null, 2) + '\n');
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
  if (command === 'capture-mira-status') {
    const o = options(rest, ['output', 'python', 'source-root'], ['output', 'source-root']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['--output', resolve(o.output), '--source-root', resolve(o['source-root'])], join(dirname(collectorScript()), 'mira_status.py'));
  }
  if (command === 'capture-trik-status') {
    const o = options(rest, ['output', 'python', 'source-root'], ['output', 'source-root']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['--output', resolve(o.output), '--source-root', resolve(o['source-root'])], join(dirname(collectorScript()), 'trik_status.py'));
  }
  if (command === 'capture-lely-status') {
    const o = options(rest, ['output', 'python', 'source-root', 'bridge-variant'], ['output', 'source-root', 'bridge-variant']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['--output', resolve(o.output), '--source-root', resolve(o['source-root']), '--bridge-variant', o['bridge-variant']], join(dirname(collectorScript()), 'lely_status.py'));
  }
  if (command === 'capture-mowgli-status') {
    const o = options(rest, ['output', 'python', 'source-root', 'settings'], ['output', 'source-root']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['--output', resolve(o.output), '--source-root', resolve(o['source-root']), ...(o.settings ? ['--settings', resolve(o.settings)] : [])], join(dirname(collectorScript()), 'mowgli_status.py'));
  }
  if (command === 'compare-mowgli-status') {
    const o = options(rest, ['output', 'python', 'baseline', 'current'], ['output', 'baseline', 'current']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['--output', resolve(o.output), '--baseline', resolve(o.baseline), '--current', resolve(o.current)], join(dirname(collectorScript()), 'mowgli_status.py'));
  }
  if (command === 'capture-rebot-status') {
    const o = options(rest, ['output', 'python', 'source-root'], ['output', 'source-root']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['--output', resolve(o.output), '--source-root', resolve(o['source-root'])], join(dirname(collectorScript()), 'rebot_status.py'));
  }
  if (command === 'capture-dual-kinova-status') {
    const o = options(rest, ['output', 'python', 'source-root'], ['output', 'source-root']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['--output', resolve(o.output), '--source-root', resolve(o['source-root'])], join(dirname(collectorScript()), 'dual_kinova_status.py'));
  }
  if (command === 'capture-ishan-gazebo-status') {
    const o = options(rest, ['output', 'python', 'source-root'], ['output', 'source-root']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['--output', resolve(o.output), '--source-root', resolve(o['source-root'])], join(dirname(collectorScript()), 'ishan_gazebo_status.py'));
  }
  if (command === 'capture-ruiyan-hand-status') {
    const o = options(rest,
      ['output', 'python', 'port', 'device-id', 'motor-count', 'baud', 'confirm-read-only', 'tactile-coefficient-index'],
      ['output', 'port', 'device-id', 'motor-count', 'baud', 'confirm-read-only']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    if (o['confirm-read-only'] !== 'yes') throw new Error('confirm_read_only_must_be_yes');
    const args = ['--output', resolve(o.output), '--port', o.port, '--device-id', o['device-id'],
      '--motor-count', o['motor-count'], '--baud', o.baud, '--execute-read-only'];
    if (o['tactile-coefficient-index']) args.push('--tactile-coefficient-index', o['tactile-coefficient-index']);
    return python(o, args, join(dirname(collectorScript()), 'ruiyan_hand_status.py'));
  }
  if (command === 'capture-pidog-status') {
    const o = options(rest, ['output', 'python', 'repo', 'source-commit', 'units-directory'], ['output', 'repo', 'source-commit']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    const args = ['--output', resolve(o.output), '--repo', resolve(o.repo), '--source-commit', o['source-commit']];
    if (o['units-directory']) args.push('--units-directory', resolve(o['units-directory']));
    return python(o, args, join(dirname(collectorScript()), 'pidog_status.py'));
  }
  if (command === 'prepare-workbench-offline-shadow') {
    const o = options(rest, ['source-root', 'expected-commit', 'demo-json', 'output', 'python'],
      ['source-root', 'expected-commit', 'demo-json', 'output']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['prepare', '--source-root', resolve(o['source-root']), '--expected-commit', o['expected-commit'],
      '--demo-json', resolve(o['demo-json']), '--output', resolve(o.output)],
      join(dirname(collectorScript()), 'workbench_offline_shadow.py'));
  }
  if (command === 'approve-workbench-offline-shadow') {
    const o = options(rest, ['draft', 'approver', 'approved-at', 'output', 'python'],
      ['draft', 'approver', 'approved-at', 'output']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['approve', '--draft', resolve(o.draft), '--approver', o.approver,
      '--approved-at', o['approved-at'], '--output', resolve(o.output)],
      join(dirname(collectorScript()), 'workbench_offline_shadow.py'));
  }
  if (command === 'evaluate-workbench-offline-shadow') {
    const o = options(rest,
      ['baseline-draft', 'changed-draft', 'approval', 'source-root', 'output', 'python'],
      ['baseline-draft', 'changed-draft', 'approval', 'source-root', 'output']);
    if (existsSync(o.output)) throw new Error('output_already_exists');
    return python(o, ['evaluate', '--baseline-draft', resolve(o['baseline-draft']),
      '--changed-draft', resolve(o['changed-draft']), '--approval', resolve(o.approval),
      '--source-root', resolve(o['source-root']), '--output', resolve(o.output)],
    join(dirname(collectorScript()), 'workbench_offline_shadow.py'));
  }
  if (command === 'check-navigation-preflight') {
    const o = options(rest, ['input', 'output'], ['input', 'output']);
    const report = evaluateNavigationPreflight(read(o.input));
    const directory = newDirectory(o.output);
    write(join(directory, 'navigation-preflight.json'), report);
    writeFileSync(join(directory, 'navigation-preflight.md'), navigationPreflightMarkdown(report), { flag: 'wx', mode: 0o600 });
    process.stdout.write(`${report.decision} | navigation preflight | hardware dispatch: NO\n${directory}\n`);
    return report.decision === 'WOULD_ALLOW' ? 0 : 1;
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
  if (command === 'inspect-template') {
    const o = options(rest, ['input', 'catalog'], ['input']);
    const template = connectionTemplateSchema.parse(read(o.input));
    const result = o.catalog ? planConnectionTemplate(template, read(o.catalog)) : {
      schemaVersion: template.schemaVersion, kind: template.kind, metadata: template.metadata,
      requiredPaths: template.compatibility.paths, requiredFacts: template.facts,
      scope: 'template structure only; fresh discovery, private values and semantic confirmation still required'
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return o.catalog && 'readyForConfiguration' in result && !result.readyForConfiguration ? 1 : 0;
  }
  if (command === 'compose-templates') {
    const o = compositionOptions(rest);
    write(resolve(o.output), composeConnectionTemplates(o.inputs.map(read)));
    process.stdout.write(`Composed ${o.inputs.length} template fragment${o.inputs.length === 1 ? '' : 's'}: ${resolve(o.output)}\nNo private goals, fact values, approvals or robot commands were generated.\n`);
    return 0;
  }
  if (command === 'compose-local-data-templates') {
    const o = compositionOptions(rest);
    write(resolve(o.output), composeLocalDataTemplates(o.inputs.map(read)));
    process.stdout.write(`Composed ${o.inputs.length} local data rule fragments: ${resolve(o.output)}\nNo source file, machine identity or robot command was generated.\n`);
    return 0;
  }
  if (command === 'prepare-local-data') {
    const o = options(rest, ['template', 'parser', 'source', 'device-id', 'confirm-semantics', 'output'],
      ['template', 'parser', 'source', 'device-id', 'confirm-semantics', 'output']);
    if (o['confirm-semantics'] !== 'yes') throw new Error('explicit_semantic_and_unit_confirmation_required');
    const source = readLocalFileSource(o.source);
    const workspace = prepareLocalDataWorkspace({ templates: [read(o.template)],
      parser: o.parser as 'json-records/v1' | 'yaml-records/v1', fileName: source.fileName,
      bytes: source.bytes, deviceId: o['device-id'], semanticsConfirmed: true });
    const directory = newDirectory(o.output);
    mkdirSync(join(directory, 'files'), { mode: 0o700 });
    write(join(directory, 'workspace.json'), workspace);
    write(join(directory, 'template.json'), workspace.check.template);
    writeFileSync(join(directory, 'files', 'prepared-source-data'), source.bytes, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(directory, 'README.md'), '# Local structured-data check\n\nThe selected source bytes are in files/prepared-source-data. Review workspace.json, template.json and the original file before relying on a result. Run `rlsok profile check-local-data --workspace workspace.json --source files/prepared-source-data --output first-check.json`, then pass a newly captured file to the same command for another check. Parser and rules are separate. This reads files only: it does not connect to a robot, authenticate the file producer, infer units, or send a command.\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write(`Local data workspace saved: ${directory}\nNo ROS graph, cloud upload, approval or robot command was used.\n`);
    return 0;
  }
  if (command === 'check-local-data') {
    const o = options(rest, ['workspace', 'source', 'output'], ['workspace', 'source', 'output']);
    const source = readLocalFileSource(o.source);
    const report = evaluateLocalDataWorkspace(read(o.workspace), source.bytes, source.fileName);
    write(resolve(o.output), report);
    process.stdout.write(`${report.decision}: ${report.recordsChecked} local record(s) checked; ${report.violations.length} reported violation(s). No robot command was sent.\n`);
    return report.decision === 'LOCAL_DATA_MATCH' ? 0 : 1;
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
