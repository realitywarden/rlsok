import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { composeConnectionTemplates, connectionTemplateSchema, planConnectionTemplate } from '../../packages/composable-shadow/templates';
import { catalogInterfaces, readCatalog, type Catalog } from '../../packages/composable-shadow/onboarding';
import { buildAssistedConnection, type AssistedSetupInput } from '../../packages/composable-shadow/assisted-setup';
import { buildSetupWorkspace, type WorkspaceFile } from './setup-workspace';
import { inspectProjectFile } from './setup-project';
import { expandTrustedXacro, type XacroInput } from './setup-xacro';
import { launchBrowser } from './browser-launch';

const MAX_BODY = 2 * 1024 * 1024;
const ADAPTERS = [
  { id: 'topic_twist', source: 'ROS 2 topic', interfaceTypes: ['geometry_msgs/msg/Twist', 'geometry_msgs/msg/TwistStamped'], purpose: 'Mobile base velocity' },
  { id: 'topic_fields', source: 'ROS 2 topic', interfaceTypes: ['selected installed message type'], purpose: 'User-declared field rules' },
  { id: 'action_fields', source: 'ROS 2 action', interfaceTypes: ['selected installed action type'], purpose: 'User-declared Goal field rules' },
  { id: 'joint_trajectory', source: 'ROS 2 action', interfaceTypes: ['control_msgs/action/FollowJointTrajectory'], purpose: 'Joint trajectory' },
  { id: 'cartesian_pose', source: 'ROS 2 action', interfaceTypes: ['custom pose action'], purpose: 'Cartesian pose' },
  { id: 'cartesian_delta', source: 'ROS 2 action', interfaceTypes: ['custom delta action'], purpose: 'Cartesian delta' },
  { id: 'cartesian_absolute_wpr', source: 'ROS 2 action', interfaceTypes: ['custom WPR action'], purpose: 'Absolute WPR pose' },
  { id: 'tp_program', source: 'ROS 2 action', interfaceTypes: ['custom program action'], purpose: 'Program selection' },
] as const;

export function starterTemplate(catalog: Catalog, input: { endpoint?: string; kind?: string; adapter?: string; projectFiles?: Array<{ name: string; kind: string }> }): unknown {
  const found = catalogInterfaces(catalog).find(item => item.endpoint === input.endpoint && item.kind === input.kind && !item.unavailable);
  if (!found || !found.interfaceSha256) throw new Error('choose_an_available_interface');
  const adapter = input.adapter;
  if (found.kind === 'topic' && (adapter !== 'topic_fields' &&
    (!['geometry_msgs/msg/Twist', 'geometry_msgs/msg/TwistStamped'].includes(found.messageType) || adapter !== 'topic_twist')))
    throw new Error('topic_requires_selected_meaning');
  if (found.kind === 'action' && (found.actionType === 'control_msgs/action/FollowJointTrajectory' ? !['joint_trajectory', 'action_fields'].includes(adapter ?? '') :
    !['cartesian_pose', 'cartesian_delta', 'cartesian_absolute_wpr', 'tp_program', 'action_fields'].includes(adapter ?? '')))
    throw new Error('choose_supported_action_meaning');
  const mapping = adapter === 'topic_twist' ? { linear: found.interfaceType === 'geometry_msgs/msg/TwistStamped' ? '/twist/linear' : '/linear',
    angular: found.interfaceType === 'geometry_msgs/msg/TwistStamped' ? '/twist/angular' : '/angular' } :
    adapter === 'joint_trajectory' ? { jointNames: '/trajectory/joint_names', points: '/trajectory/points' } : {};
  const projectFiles = input.projectFiles ?? [];
  if (!Array.isArray(projectFiles) || projectFiles.length > 16 || projectFiles.some(file => !file || typeof file.name !== 'string' || !/^[A-Za-z0-9_. -]+$/.test(file.name) || file.name.length > 256) ||
    new Set(projectFiles.map(file => file.name)).size !== projectFiles.length) throw new Error('invalid_project_files');
  if (projectFiles.filter(file => file.kind === 'robot-description').length > 1) throw new Error('choose_one_robot_description');
  const robot = projectFiles.find(file => file.kind === 'robot-description' && /\.urdf$/i.test(file.name));
  const configurationFiles = projectFiles.filter(file => file.kind === 'configuration' && /\.(?:json|ya?ml|srdf)$/i.test(file.name));
  return { schemaVersion: 1, kind: 'RlsokConnectionTemplate',
    metadata: { id: 'local-starter', name: 'Local project starter', version: '1.0.0', description: 'Generated from one selected, read-only discovered interface.',
      visibility: 'private', createdAt: new Date().toISOString() },
    compatibility: { rosDistro: catalog.environment.rosDistro,
      paths: [{ id: 'path-1', kind: found.kind, interfaceType: found.interfaceType, interfaceSha256: found.interfaceSha256 }] },
    defaults: { maxObservationAgeMs: 30000 },
    paths: [{ id: 'path-1', kind: found.kind, endpointHint: found.endpoint, adapter, mapping, requiresSemanticConfirmation: true }],
    facts: [{ id: 'robot-description', kind: 'file_sha256', path: `files/${robot?.name ?? 'robot.urdf'}` },
      ...configurationFiles.map((file, index) => ({ id: `project-config-${index + 1}`, kind: 'file_sha256', path: `files/${file.name}` }))] };
}

function collectorScript(): string {
  let directory = __dirname;
  for (let index = 0; index < 7; index += 1) {
    const candidate = join(directory, 'experimental', 'composable-shadow', 'collect.py');
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    directory = dirname(directory);
  }
  throw new Error('composable_shadow_collector_missing');
}

function sampleScript(): string {
  let directory = __dirname;
  for (let index = 0; index < 7; index += 1) {
    const candidate = join(directory, 'experimental', 'composable-shadow', 'sample_topic.py');
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    directory = dirname(directory);
  }
  throw new Error('composable_shadow_topic_sampler_missing');
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage, maximum = MAX_BODY): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > maximum) throw new Error('request_body_too_large');
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function discover(python: string): Promise<unknown> {
  return mkdtemp(join(tmpdir(), 'rlsok-setup-')).then(directory => new Promise((resolve, reject) => {
    const output = join(directory, 'catalog.json');
    const child = spawn(python, [collectorScript(), '--discover', '--output', output], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => child.kill(), 60_000);
    child.stderr.on('data', chunk => { if (stderr.length < 16_384) stderr += chunk.toString(); });
    child.once('error', error => { clearTimeout(timer); rmSync(directory, { recursive: true, force: true }); reject(error); });
    child.once('exit', async code => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error(stderr.trim() || `collector_exited_${code ?? 'unknown'}`);
        resolve(JSON.parse(readFileSync(output, 'utf8')));
      } catch (error) { reject(error); }
      finally { rmSync(directory, { recursive: true, force: true }); }
    });
  }));
}

export async function sampleTopic(python: string, catalogInput: unknown, endpoint: string): Promise<Record<string, unknown>> {
  const catalog = await readCatalog(catalogInput);
  const topic = catalog.topics?.find(item => item.endpoint === endpoint);
  const fingerprint = topic?.interfaceSha256, messageType = topic?.messageType;
  if (!fingerprint || !messageType || topic?.unavailable || typeof endpoint !== 'string') throw new Error('choose_available_discovered_topic');
  return new Promise((resolve, reject) => {
    const child = spawn(python, [sampleScript(), '--topic', endpoint, '--message-type', messageType,
      '--interface-sha256', fingerprint], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
    let stdout = '', stderr = '', settled = false;
    const finish = (error?: Error, result?: Record<string, unknown>) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result!); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('topic_sample_timed_out')); }, 8_000);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 1024 * 1024) { child.kill(); finish(new Error('topic_sample_exceeds_1MiB')); } });
    child.stderr.on('data', chunk => { if (stderr.length < 16_384) stderr += chunk.toString(); });
    child.once('error', error => finish(error));
    child.once('close', code => {
      if (settled) return;
      if (code !== 0) return finish(new Error(stderr.trim() || `topic_sampler_exited_${code ?? 'unknown'}`));
      try {
        const result = JSON.parse(stdout) as Record<string, unknown>;
        if (result.kind !== 'RlsokLocalTopicSample' || result.topic !== endpoint || result.messageType !== messageType ||
          result.interfaceSha256 !== fingerprint || !result.payload || typeof result.payload !== 'object' || Array.isArray(result.payload))
          throw new Error('topic_sample_mismatches_selected_interface');
        finish(undefined, result);
      } catch (error) { finish(error instanceof Error ? error : new Error('invalid_topic_sample')); }
    });
  });
}

type InterfaceSourcePlugin = { id: string; parserId: string; read: (input: unknown, python: string) => Promise<unknown> };
type InterfaceParserPlugin = { id: string; parse: (input: unknown) => Promise<Catalog> };
const interfaceParserPlugins: readonly InterfaceParserPlugin[] = [
  { id: 'rosidl-catalog/v1', parse: readCatalog }
];
const interfaceSourcePlugins: readonly InterfaceSourcePlugin[] = [
  { id: 'ros2-live-graph/v1', parserId: 'rosidl-catalog/v1', read: (_input, python) => discover(python) },
  { id: 'saved-ros2-catalog/v1', parserId: 'rosidl-catalog/v1', read: async input => input }
];

export function loadInterfaceSource(pluginId: string, input: unknown, python: string): Promise<Catalog> {
  const plugin = interfaceSourcePlugins.find(item => item.id === pluginId);
  if (!plugin) throw new Error(`unsupported_interface_source:${pluginId}`);
  const parser = interfaceParserPlugins.find(item => item.id === plugin.parserId);
  if (!parser) throw new Error(`unsupported_interface_parser:${plugin.parserId}`);
  return plugin.read(input, python).then(raw => parser.parse(raw));
}

export function page(token: string): string {
  const safeToken = JSON.stringify(token).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RLSOK Local Setup Assistant</title><style>
:root{color-scheme:light;--ink:#15231f;--muted:#60716a;--line:#dce5e1;--soft:#f3f7f5;--accent:#087a5b;--accent2:#e3f4ee}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink);background:#f8faf9}header{padding:30px max(24px,calc((100vw - 1120px)/2));background:#10241e;color:white}header p{margin:6px 0 0;color:#bfd0ca}main{max-width:1120px;margin:24px auto;padding:0 24px 60px}.notice{padding:12px 16px;border:1px solid #b9ded1;background:var(--accent2);border-radius:10px;margin-bottom:18px}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.step{padding:13px;border:1px solid var(--line);border-radius:10px;background:white}.step b{display:block;color:var(--accent)}.grid{display:grid;grid-template-columns:1.1fr .9fr;gap:18px}.card{background:white;border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:18px}.card h2{font-size:19px;margin:0 0 6px}.card p{color:var(--muted);margin:0 0 14px}button,.button{display:inline-block;border:0;border-radius:8px;padding:10px 14px;background:var(--accent);color:white;font-weight:650;cursor:pointer;margin:0 7px 7px 0}button.secondary,.button.secondary{background:#e8eeeb;color:var(--ink)}input[type=file]{position:absolute;inline-size:1px;block-size:1px;opacity:0;overflow:hidden}.list{display:grid;gap:8px}.item{padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--soft)}.item small{display:block;color:var(--muted)}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:330px;overflow:auto;background:#10241e;color:#d7eee6;padding:14px;border-radius:9px;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.status{min-height:24px;color:var(--muted)}.good{color:#087a5b}.bad{color:#a33b2f}.field{display:block;margin:12px 0;font-weight:600}.field input,.field select,.field textarea{display:block;width:100%;margin-top:5px;padding:9px;border:1px solid #b4c6bd;border-radius:7px;background:white;color:var(--ink);font:inherit}.field textarea{min-height:115px;font-family:ui-monospace,Consolas,monospace}.field input[type=file]{position:static;inline-size:auto;block-size:auto;opacity:1;overflow:visible}.field input[type=checkbox]{display:inline;width:auto;margin-right:8px}.path{border:1px solid var(--line);border-radius:10px;padding:14px;margin:14px 0}.path h3{margin:0}.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.missing{border-left:4px solid #ba7735;padding-left:12px}@media(max-width:760px){.steps,.grid,.two{grid-template-columns:1fr}header{padding:24px}.steps{gap:6px}}
</style></head><body><header><h1>Local Setup Assistant</h1><p>Discover, compose, match, and export locally. No account, cloud upload, AI, or robot command.</p></header><main>
<div class="notice"><strong>Read-only setup:</strong> discovery reads the visible ROS 2 graph and interface definitions. This assistant never publishes a topic, sends an action goal, or grants execution permission.</div>
<div class="steps"><div class="step"><b>1 · Discover</b>Read a live graph or import a catalog.</div><div class="step"><b>2 · Compose</b>Combine reusable template fragments.</div><div class="step"><b>3 · Match</b>Resolve interfaces and show gaps.</div><div class="step"><b>4 · Export</b>Save the local setup workspace.</div></div>
<div class="grid"><section>
<div class="card"><h2>Project inputs</h2><p>Open a project folder to find robot descriptions and configuration candidates, or choose individual files. Nothing is uploaded to a cloud service. Review the selected files before inspection; units and physical meaning cannot be inferred.</p><label class="button" for="projectFolder">Open project folder</label><input id="projectFolder" type="file" webkitdirectory multiple><label class="button secondary" for="projectFiles">Choose individual files</label><input id="projectFiles" type="file" accept=".urdf,.srdf,.json,.yaml,.yml" multiple><div id="folderStatus" class="status"></div><div id="folderSavedChoices" class="list"></div><div id="folderChoices" class="list"></div><button id="inspectFolder" class="secondary" hidden>Inspect selected project files</button><div id="projectInterfaceControls" hidden><h3>Project interface declarations</h3><p>Source .msg, .action, .srv or .idl files are offline clues, not installed ROS types or live endpoints. Inspect a declaration before choosing an installed interface from discovery.</p><label class="field">Declaration file<select id="projectDeclaration"></select></label><button id="inspectDeclaration" class="secondary">Inspect selected declaration</button><div id="projectDeclarationStatus" class="status"></div></div><div id="xacroControls" hidden><h3>Expand a trusted Xacro locally</h3><p>Xacro may evaluate expressions and read included files. Only run this on a project you trust. The installed ROS Python environment must provide xacro. Expansion sends no robot command and uploads nothing to a cloud service.</p><label class="field">Xacro entry file<select id="xacroEntry"></select></label><label class="field">Optional Xacro arguments, one name:=value per line<textarea id="xacroArgs"></textarea></label><label class="field"><input id="xacroTrust" type="checkbox">I trust this project and explicitly allow local Xacro expansion</label><button id="expandXacro" class="secondary">Expand and inspect URDF</button><div id="xacroStatus" class="status"></div></div><div id="projectStatus" class="status">No project files inspected.</div><div id="projectList" class="list"></div></div>
<div class="card"><h2>1. Interface discovery</h2><p>Use the ROS environment sourced in the terminal that started this assistant, or import a previously discovered catalog.</p><button id="discover">Discover this ROS graph</button><label class="button secondary" for="catalog">Import catalog JSON</label><input id="catalog" type="file" accept="application/json,.json"><div id="catalogStatus" class="status">No catalog loaded.</div></div>
<div class="card"><h2>2. Start from discovery or reuse fragments</h2><p>Choose one discovered interface, or add up to 16 private template fragments to combine reusable mappings and checks.</p><label class="field">Discovered interface<select id="starterInterface"><option value="">Choose an interface</option></select></label><label class="field">Check rule and meaning<select id="starterAdapter"><option value="">Choose the documented meaning</option></select></label><label class="button" for="fragments">Add template fragments</label><input id="fragments" type="file" accept="application/json,.json" multiple><button id="clear" class="secondary">Clear</button><div id="fragmentList" class="list"></div></div>
<div class="card"><h2>3. Generate and match</h2><p>The generated plan chooses a unique or explicitly hinted endpoint. Units, frames, and physical meaning still require your confirmation.</p><button id="generate">Prepare from selected interface or fragments</button><div id="planStatus" class="status">Waiting for a catalog and an interface choice or fragments.</div></div>
</section><aside>
<div class="card"><h2>Source · parser · check</h2><p>Change the source or mapped fields without replacing the selected check rules. Unsupported meanings are not guessed.</p><div id="pipelineStatus" class="status">Source: choose a project or ROS graph. Parser: waiting for files and interface definitions. Check: choose a documented meaning or saved rule.</div><div id="adapters" class="list"></div></div>
<div class="card"><h2>4. Review the plan</h2><p>The plan shows recognized interfaces and gaps. The workspace ZIP below includes validated configuration and actual files after you confirm the remaining inputs.</p><div class="two"><label class="field">Reusable template ID<input id="templateId" value="local-project"></label><label class="field">Template version<input id="templateVersion" value="1.0.0"></label></div><label class="field">Reusable template name<input id="templateName" value="Local project rules"></label><p>Save after mapping fields to reuse them. Machine endpoint, receiver and frame remain parameters for the next project.</p><button id="download" disabled>Download plan JSON</button><button id="templateDownload" disabled class="secondary">Save reusable template</button><div id="summary" class="status">Next: read project files and discover interfaces.</div><div id="missingStatus" class="status"></div><details><summary>Advanced plan JSON</summary><pre id="preview">Nothing generated yet.</pre></details></div>
</aside></div><section id="finish" class="card" hidden><h2>Finish the check workspace</h2><p>Review detected paths, attach actual files and provide a real example message or goal for each path. Confirm units and meaning from your interface documentation.</p><div id="finishFields"></div><button id="complete">Validate and download workspace ZIP</button><div id="completeStatus" class="status"></div></section></main><script>
const token=${safeToken};let catalog=null,catalogOrigin='none',fragments=[],workspace=null,formControls=null,projectFiles=[],inspections=[],folderCandidates=[],folderCatalogFiles=[],folderTemplateFiles=[],folderXacroFiles=[],folderXacroResources=[],folderInterfaceFiles=[],declarationInspection=null;
const $=id=>document.getElementById(id);const show=(id,text,kind='')=>{const el=$(id);el.textContent=text;el.className='status '+kind};const render=(target,items)=>{const root=$(target);root.replaceChildren(...items.map(item=>{const row=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('small');row.className='item';title.textContent=item.title;detail.textContent=item.detail;row.append(title,detail);return row}))};
async function api(path,payload){const response=await fetch('/'+token+'/api/'+path,{method:'POST',headers:{'content-type':'application/json','x-rlsok-session':token},body:JSON.stringify(payload||{})});const value=await response.json();if(!response.ok)throw new Error(value.error||'Request failed');return value}
async function files(input){return Promise.all([...input.files].map(file=>file.text().then(JSON.parse)))}
function field(parent,title,value='',kind='text'){
  const label=document.createElement('label'),control=document.createElement(kind==='textarea'?'textarea':kind==='select'?'select':'input');label.className='field';label.append(document.createTextNode(title));
  if(kind!=='textarea'&&kind!=='select')control.type=kind;
  if(kind==='textarea')control.value=value;else if(kind!=='select')control.value=value;
  label.append(control);parent.append(label);return control;
}
function option(select,value,title){const item=document.createElement('option');item.value=value;item.textContent=title;select.append(item)}
const requiredMappings={topic_twist:['linear','angular','commandFrame'],topic_fields:['rulesJson'],action_fields:['rulesJson'],joint_trajectory:['jointNames','points'],cartesian_pose:['px','py','pz','qx','qy','qz','qw','frame','expectedFrame'],cartesian_delta:['tx','ty','tz','rw','rp','rr','velocity','frame','expectedFrame','maxTranslationMm','maxRotationDeg','maxVelocityMmS'],cartesian_absolute_wpr:['px','py','pz','rw','rp','rr','velocity','frame','expectedFrame','defaultVelocityMmS','maxVelocityMmS'],tp_program:['program','allowedPrograms']};
const conventions={topic_twist:'Standard Twist: linear m/s, angular rad/s. Select the intended receiving node and confirm the command frame.',topic_fields:'Custom topic: add a rule for each field you want checked. Choose the detected field and type, then supply its actual meaning, unit and any limits. Only declared fields are checked. A type tree does not supply a payload or physical meaning; an optional temporary subscription can copy one incoming message as an example.',action_fields:'Custom action Goal: choose installed scalar fields and declare their actual meaning, unit and limits. Supply a real Goal example. Only selected fields are checked; no Goal is sent, and interface structure does not prove physical meaning or safety.',joint_trajectory:'FollowJointTrajectory: exact command joint order, radians and increasing time_from_start.',cartesian_pose:'Absolute XYZ meters and normalized X/Y/Z/W quaternion; no Euler or unit conversion.',cartesian_delta:'Relative XYZ millimeters, W/P/R degrees and velocity mm/s with explicit per-component bounds.',cartesian_absolute_wpr:'Absolute XYZ millimeters and native W/P/R degrees. Zero is a literal target; no transform or unit conversion.',tp_program:'Exact program selector with an explicit allowlist. Program contents and side effects are not inspected.'};
function projectSuggestions(){
  const robots=inspections.filter(item=>item.kind==='robot-description'&&!item.needsExpansion),robot=robots.length===1?robots[0]:null,configs=inspections.filter(item=>item.kind==='configuration');
  const orders=new Map();for(const order of [...configs.flatMap(item=>item.jointOrderCandidates),...(robot?.movableJoints?.length?[robot.movableJoints]:[])])orders.set(JSON.stringify(order),order);
  return {robot,robotCount:robots.length,model:robot?.model||'',controllers:[...new Set(configs.flatMap(item=>item.controllerCandidates))],orders:[...orders.values()]};
}
function renderPipeline(){const parsers=[...new Set([...inspections.map(item=>item.parserPlugin),declarationInspection?.parserPlugin,catalog?'rosidl-catalog/v1':null].filter(Boolean))],checks=[...new Set((workspace?.template.paths||fragments.flatMap(fragment=>fragment.paths||[])).map(path=>path.adapter))];
  $('pipelineStatus').textContent='Source: '+(catalogOrigin==='live'?'ros2-live-graph/v1':catalogOrigin==='saved'?'saved-ros2-catalog/v1':'not selected')+' + local project files. Parser: '+(parsers.length?parsers.join(', '):'awaiting selected project files')+'. Check: '+(checks.length?checks.join(', '):'choose a documented meaning or saved rule')+'.';}
function updateNextStep(){if(workspace)return;
  const next=!inspections.length?(folderCandidates.some(file=>/\\.urdf$/i.test(file.name))?'Choose the intended robot/config files and click Inspect selected project files.':folderXacroFiles.length?'Review the Xacro entry file and click Expand and inspect URDF if you trust this project.':folderInterfaceFiles.length?(declarationInspection?'Source the project ROS environment and discover installed interfaces, or import a saved catalog.':'Inspect a project interface declaration, then discover the installed ROS graph or import a catalog.'):folderCandidates.length?'Choose the intended config files and click Inspect selected project files.':'Open a project folder or choose project files.'):projectSuggestions().robotCount>1?'Choose one intended expanded robot description and inspect again.':inspections.some(item=>item.kind==='robot-description'&&item.needsExpansion)&&folderXacroFiles.length?'Review the matching Xacro entry file and expand it locally if you trust this project.':!projectSuggestions().robot?'Choose an expanded URDF with Choose individual files, or open a project folder and select its intended URDF.':!catalog?(folderInterfaceFiles.length?'Project declarations found but no live endpoint: discover the sourced ROS graph or import a saved catalog.':'Import a catalog or click Discover this ROS graph.'):fragments.length?'Click Prepare to match the saved rules to this project.':$('starterInterface').options.length<=1?'No interface has one visible server or receiving node; correct the graph and rediscover, or import another catalog.':'Choose a discovered interface or reusable fragments, then click Prepare.';
  show('summary','Next: '+next);
  const suggestions=projectSuggestions(),missing=[];
  if(suggestions.robotCount>1)missing.push('choose one intended expanded robot description');
  else if(!suggestions.robot)missing.push('expanded robot URDF');
  if(!catalog)missing.push('interface discovery or saved catalog');
  missing.push(suggestions.controllers.length?'confirm active controller ('+suggestions.controllers.length+' candidate'+(suggestions.controllers.length===1?'':'s')+')':'actual controller identity');
  missing.push(suggestions.orders.length?'confirm command joint order ('+suggestions.orders.length+' candidate'+(suggestions.orders.length===1?'':'s')+') if applicable':'command joint order if applicable');
  missing.push('example goal/message and confirmed units, frame and meaning');
  show('missingStatus','Still needed: '+missing.join('; ')+'.','bad');
  renderPipeline();
}
function showProject(){const suggestion=projectSuggestions();render('projectList',inspections.map(item=>({title:item.name+' · '+item.kind,detail:[item.model&&'model '+item.model,item.movableJoints?.length&&item.movableJoints.length+' movable joints',item.controllerCandidates.length&&item.controllerCandidates.length+' controller candidates',item.planningGroups?.length&&'planning groups: '+item.planningGroups.map(group=>group.name+' ('+(group.joints.length?group.joints.length+' listed joints':group.chains.length?group.chains.length+' chains':'nested/empty')+')').join(', '),item.declaredCommandInterfaces?.length&&'declared command interfaces: '+item.declaredCommandInterfaces.slice(0,8).map(entry=>entry.joint+' ['+entry.interfaces.join(', ')+']').join(', ')+(item.declaredCommandInterfaces.length>8?' and '+(item.declaredCommandInterfaces.length-8)+' more':''),...item.warnings].filter(Boolean).join(' · ')||'File recognized; no safe configuration assumption.'})));
  show('projectStatus',inspections.length+' files inspected. '+(suggestion.robot?'Expanded robot description recognized.':suggestion.robotCount>1?'Several expanded robot descriptions found; choose the intended one.':'Expanded URDF still needed.')+' '+(suggestion.orders.length?'Controller joint-list candidates found; confirm the actual command order if required.':'No controller command order identified; supply one only if the selected check requires it.'),suggestion.robot?'good':'bad');updateNextStep()}
function fieldPointers(tree){if(!tree)return[];const output=[],root=tree.components.Goal||tree.components.Message;function walk(node,path,seen,depth){if(!node||output.length>=512||depth>16)return;if(path)output.push(path);if(node.kind==='message'&&!seen.includes(node.name))for(const field of tree.definitions[node.name]?.fields||[])walk(field.type,path+'/'+field.name,[...seen,node.name],depth+1);else if(node.kind==='array'||node.kind==='sequence')walk(node.element,path+'/0',seen,depth+1)}walk(root,'',[],0);return output}
function scalarFields(tree){if(!tree)return[];const output=[],root=tree.components.Goal||tree.components.Message;function walk(node,path,seen,depth){if(!node||output.length>=512||depth>16)return;if(node.kind==='message'&&!seen.includes(node.name)){for(const item of tree.definitions[node.name]?.fields||[])walk(item.type,path+'/'+item.name,[...seen,node.name],depth+1)}else if(node.kind==='array'||node.kind==='sequence')walk(node.element,path+'/0',seen,depth+1);else if(path&&['primitive','string','wstring'].includes(node.kind)){const kind=node.kind==='primitive'?(node.name==='boolean'?'boolean':/^(?:u?)int/.test(node.name)?'integer':'number'):'string';output.push({pointer:path,type:kind})}}walk(root,'',[],0);return output}
function ruleEditor(card,value,treeForEndpoint,endpoint){
  const hidden=field(card,'Selected field rules (generated from the controls below)',value,'textarea');hidden.parentElement.hidden=true;
  const heading=document.createElement('p');heading.textContent='Pick a scalar field from the installed message or action Goal definition, then state its actual meaning and unit. Add only fields you intend to check.';card.append(heading);
  const list=document.createElement('div'),add=document.createElement('button');list.className='list';add.type='button';add.className='secondary';add.textContent='Add field rule';card.append(list,add);
  let choices=[];const datalist=document.createElement('datalist');datalist.id='rule-pointers-'+Math.random().toString(36).slice(2);card.append(datalist);
  function refreshChoices(){choices=scalarFields(treeForEndpoint());datalist.replaceChildren();for(const choice of choices)option(datalist,choice.pointer,choice.pointer+' · '+choice.type)}endpoint.addEventListener('change',refreshChoices);refreshChoices();
  function sync(){try{const rules=[...list.children].map(row=>{const inputs=row.querySelectorAll('input,select,textarea'),pointer=inputs[0].value.trim(),type=inputs[1].value,meaning=inputs[2].value.trim(),unit=inputs[3].value.trim(),minimum=inputs[4].value.trim(),maximum=inputs[5].value.trim(),allowed=inputs[6].value.trim();if(!pointer||!meaning||!unit)throw new Error('incomplete');const rule={pointer,type,meaning,unit};if(minimum)rule.minimum=Number(minimum);if(maximum)rule.maximum=Number(maximum);if(allowed){rule.allowed=allowed.split(String.fromCharCode(10)).map(line=>line.trim()).filter(Boolean).map(item=>{if(type==='boolean'){if(item!=='true'&&item!=='false')throw new Error('invalid boolean');return item==='true'}if(type==='number'||type==='integer'){const number=Number(item);if(!Number.isFinite(number)||(type==='integer'&&!Number.isSafeInteger(number)))throw new Error('invalid number');return number}return item})}return rule});hidden.value=rules.length?JSON.stringify(rules):''}catch{hidden.value=''}updateMissing()}
  function appendRule(rule={}){const row=document.createElement('section');row.className='path';list.append(row);const fields=[];
    fields.push(field(row,'Message or Goal field pointer',rule.pointer||''));fields[0].setAttribute('list',datalist.id);
    const type=field(row,'Declared value type','','select');for(const kind of ['number','integer','string','boolean'])option(type,kind,kind);type.value=rule.type||'number';fields.push(type);
    fields.push(field(row,'Actual field meaning',rule.meaning||''));fields.push(field(row,'Unit or explicit non-physical label',rule.unit||''));
    fields.push(field(row,'Minimum (optional)',rule.minimum===undefined?'':String(rule.minimum),'number'));
    fields.push(field(row,'Maximum (optional)',rule.maximum===undefined?'':String(rule.maximum),'number'));
    fields.push(field(row,'Allowed values, one per line (optional)',rule.allowed?rule.allowed.join(String.fromCharCode(10)):'','textarea'));
    const remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='Remove field';row.append(remove);remove.onclick=()=>{row.remove();sync()};
    fields[0].onchange=()=>{const found=choices.find(choice=>choice.pointer===fields[0].value);if(found)type.value=found.type;sync()};for(const input of fields)input.addEventListener('input',sync);type.addEventListener('change',sync);sync()}
  add.onclick=()=>appendRule();let saved=[];try{saved=JSON.parse(value||'[]')}catch{}if(Array.isArray(saved))for(const rule of saved)appendRule(rule);sync();return hidden;
}
function updateMissing(){if(!workspace||!formControls){$('missingStatus').textContent='';return}const missing=[],robot=formControls.robot;
  for(const [key,label] of [['id','configuration ID'],['deviceId','device ID'],['model','robot model'],['controller','controller implementation']])if(!robot[key].value.trim())missing.push(label);
  if(workspace.template.paths.some(path=>!['topic_twist','topic_fields','action_fields','tp_program'].includes(path.adapter))&&!robot.jointOrder.value.trim())missing.push('command joint order');
  for(const path of formControls.paths){if(!path.endpoint.value)missing.push(path.pathId+' endpoint');for(const [key,input] of Object.entries(path.mapping))if(!input.value.trim())missing.push(path.pathId+' '+(key==='rulesJson'?'field rules':key));try{const goal=JSON.parse(path.goal.value);if(!goal||typeof goal!=='object'||Array.isArray(goal))missing.push(path.pathId+' real example')}catch{missing.push(path.pathId+' real example')}if(!path.confirmed.checked)missing.push(path.pathId+' meaning/units confirmation')}
  for(const [path,input] of formControls.files)if(!input.files?.length)missing.push(path+' file');
  if(!workspace.plan.distroMatched)missing.push('compatible ROS distribution');
  show('missingStatus',missing.length?'Still needed ('+missing.length+'): '+missing.slice(0,8).join(', ')+(missing.length>8?', and '+(missing.length-8)+' more.':''):'All required inputs supplied. Next: validate and download the workspace ZIP.',missing.length?'bad':'good');
}
function reusableTemplate(){if(!workspace)throw new Error('Generate a setup plan first.');const id=$('templateId').value.trim(),version=$('templateVersion').value.trim(),name=$('templateName').value.trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)||!/^[0-9]+[.][0-9]+[.][0-9]+$/.test(version)||!name||name.length>160)throw new Error('Use a valid template ID, name and major.minor.patch version.');
  for(const path of workspace.template.paths)if(path.adapter==='topic_fields'||path.adapter==='action_fields'){const value=formControls?.paths.find(item=>item.pathId===path.id)?.mapping.rulesJson?.value;let rules;try{rules=JSON.parse(value||'')}catch{throw new Error('Add valid custom field rules before saving this template.')}if(!Array.isArray(rules)||!rules.length)throw new Error('Add at least one custom field rule before saving this template.')}
  const machineSpecific=new Set(['subscriber','commandFrame','expectedFrame']);
  return {...workspace.template,metadata:{...workspace.template.metadata,id,name,version},defaults:{maxObservationAgeMs:workspace.template.defaults.maxObservationAgeMs},paths:workspace.template.paths.map(path=>{const controls=formControls?.paths.find(item=>item.pathId===path.id),mapping={...path.mapping};for(const [key,input] of Object.entries(controls?.mapping||{}))if(input.value.trim()&&!machineSpecific.has(key))mapping[key]=input.value.trim();for(const key of machineSpecific)delete mapping[key];const {endpointHint,...rest}=path;return {...rest,mapping}}),facts:workspace.template.facts.map((fact,index)=>({...fact,path:'files/'+(fact.id==='robot-description'?'robot.urdf':'fact-'+(index+1)+(fact.kind==='json_value'?'.json':'.bin'))}))};
}
function renderInterfaceChoices(){
  const select=$('starterInterface');select.replaceChildren();option(select,'','Choose an interface');
  for(const item of [...(catalog?.actions||[]).map(value=>({kind:'action',endpoint:value.endpoint,type:value.actionType,unavailable:value.unavailable,servers:value.serverCount})),
    ...(catalog?.topics||[]).map(value=>({kind:'topic',endpoint:value.endpoint,type:value.messageType,unavailable:value.unavailable,servers:value.subscribers.some(node=>node.count===1)?1:0}))]){
    if(item.unavailable||item.servers!==1)continue;
    option(select,item.kind+'|'+item.endpoint,item.endpoint+' · '+item.type);
  }
  renderAdapterChoices();updateNextStep();
}
function renderAdapterChoices(){
  const select=$('starterAdapter');select.replaceChildren();option(select,'','Choose the documented meaning');
  const [kind,endpoint]=($('starterInterface').value||'|').split('|');
  if(!endpoint)return;
  const action=(catalog?.actions||[]).find(item=>kind==='action'&&item.endpoint===endpoint),topic=(catalog?.topics||[]).find(item=>kind==='topic'&&item.endpoint===endpoint);
  if(topic){if(['geometry_msgs/msg/Twist','geometry_msgs/msg/TwistStamped'].includes(topic.messageType)){option(select,'topic_twist','Standard Twist velocity');select.value='topic_twist'}option(select,'topic_fields','Custom field rules for this message');}
  else if(action?.actionType==='control_msgs/action/FollowJointTrajectory'){option(select,'joint_trajectory','Standard joint trajectory');option(select,'action_fields','Custom Goal field rules');select.value='joint_trajectory'}
  else if(action){for(const [id,label] of [['cartesian_pose','Absolute XYZ meters / quaternion'],['cartesian_delta','Relative XYZ mm / WPR degrees'],['cartesian_absolute_wpr','Absolute XYZ mm / WPR degrees'],['tp_program','Allowlisted program selector'],['action_fields','Custom Goal field rules']])option(select,id,label)}
}
function invalidatePlan(){if(!workspace)return;workspace=null;renderFinish();$('download').disabled=true;$('templateDownload').disabled=true;$('preview').textContent='Nothing generated yet.';updateNextStep()}
$('starterInterface').onchange=()=>{renderAdapterChoices();invalidatePlan()};
$('starterAdapter').onchange=invalidatePlan;
function useCatalog(value,origin,live=false){catalog=value;catalogOrigin=live?'live':'saved';workspace=null;renderFinish();$('download').disabled=true;$('templateDownload').disabled=true;$('preview').textContent='Nothing generated yet.';renderInterfaceChoices();const usable=$('starterInterface').options.length-1;show('catalogStatus',(catalog.actions.length+(catalog.topics||[]).length)+' interfaces loaded from '+origin+'; '+usable+' have one visible server or receiving node.'+(usable?' Confirm the intended endpoint and meaning.':' Correct the graph and rediscover, or import another catalog.')+(live?' Discovery is graph-only, not physical-hardware proof.':' A saved catalog is not live-state proof.'),usable?'good':'bad')}
function renderFinish(){
  const root=$('finishFields');root.replaceChildren();formControls={robot:{},paths:[],files:new Map()};
  if(!workspace){$('finish').hidden=true;updateMissing();return}
  $('finish').hidden=false;
  const plan=workspace.plan,template=workspace.template;
  if(!plan.distroMatched){const warning=document.createElement('p');warning.className='missing';warning.textContent='ROS distribution differs from this template. Use compatible fragments or rediscover the correct environment.';root.append(warning)}
  const identity=document.createElement('div');identity.className='two';root.append(identity);
  const suggestions=projectSuggestions();
  if(template.defaults.model||template.defaults.controller||template.defaults.jointOrder?.length){const note=document.createElement('p');note.className='missing';note.textContent='This saved template contains robot-specific defaults from another setup. They are not copied into this machine. Review the current project and enter its actual identity, controller and command joint order.';root.append(note)}
  for(const [key,title,value] of [['id','Configuration ID',''],['deviceId','Device ID',''],['model','Robot model',suggestions.model],['controller','Controller implementation',suggestions.controllers.length===1?suggestions.controllers[0]:'']])
    formControls.robot[key]=field(identity,title,value);
  const requiresJointOrder=template.paths.some(path=>!['topic_twist','topic_fields','action_fields','tp_program'].includes(path.adapter));
  formControls.robot.jointOrder=requiresJointOrder?field(root,'Joint names in actual command order (comma separated)',((suggestions.orders.length===1)?suggestions.orders[0]:[]).join(', ')):{value:''};
  if(suggestions.controllers.length>1||(requiresJointOrder&&suggestions.orders.length>1)){const note=document.createElement('p');note.className='missing';note.textContent='Several controller or joint-order candidates were found. Compare them with the real command controller and choose deliberately.';root.append(note)}
  formControls.robot.age=field(root,'Maximum observation age in milliseconds',String(template.defaults.maxObservationAgeMs),'number');
  for(const planned of plan.paths){
    const specification=template.paths.find(path=>path.id===planned.id),card=document.createElement('section');card.className='path';root.append(card);
    const heading=document.createElement('h3');heading.textContent=planned.id+' · '+specification.adapter;card.append(heading);
    const convention=document.createElement('p');convention.textContent=conventions[specification.adapter]||'Confirm the physical meaning against the actual interface documentation.';card.append(convention);
    const status=document.createElement('p');status.textContent=(planned.status==='MATCHED'?(catalogOrigin==='saved'?'Matched in saved catalog (not live-verified) ':'Recognized in current graph ')+planned.selectedEndpoint:planned.status==='AMBIGUOUS'&&planned.candidates.length?'Several compatible endpoints found; choose the intended one.':planned.status==='AMBIGUOUS'?'Matching interfaces have no uniquely visible server or receiving node; correct the ROS graph and rediscover.':'Required interface is missing from discovery.')+(planned.unusableActionServers.length?' Multiple-server action endpoints cannot be selected: '+planned.unusableActionServers.join(', ')+'.':'')+(planned.unusableTopicReceivers.length?' Topics without one visible receiving node cannot be selected: '+planned.unusableTopicReceivers.join(', ')+'.':'');card.append(status);
    const endpoint=field(card,'Selected endpoint','','select');
    option(endpoint,'','Choose an endpoint');for(const candidate of planned.candidates)option(endpoint,candidate,candidate);
    endpoint.value=planned.selectedEndpoint||'';
    const controls={pathId:planned.id,endpoint,mapping:{},goal:null,confirmed:null};
    const candidates=[...(workspace.catalog.actions||[]),...(workspace.catalog.topics||[])],pointerList=document.createElement('datalist');pointerList.id='pointers-'+planned.id.replace(/[^A-Za-z0-9_-]/g,'-');card.append(pointerList);
    function refreshPointers(){pointerList.replaceChildren();for(const pointer of fieldPointers(candidates.find(item=>item.endpoint===endpoint.value)?.typeTree))option(pointerList,pointer,pointer)}
    refreshPointers();endpoint.addEventListener('change',refreshPointers);
    if(specification.adapter==='topic_twist'||specification.adapter==='topic_fields'){
      const subscriber=field(card,'Intended receiving node','','select');option(subscriber,'','Choose the receiver');
      const topic=(workspace.catalog.topics||[]).find(item=>item.endpoint===endpoint.value);
      function receivers(){subscriber.replaceChildren();option(subscriber,'','Choose the receiver');const selected=(workspace.catalog.topics||[]).find(item=>item.endpoint===endpoint.value);for(const node of selected?.subscribers||[])if(node.count===1)option(subscriber,node.namespace+'|'+node.name,node.namespace+'/'+node.name);subscriber.value=specification.mapping.subscriber||''}
      endpoint.onchange=receivers;receivers();controls.mapping.subscriber=subscriber;
    }
    for(const key of [...new Set([...(requiredMappings[specification.adapter]||[]),...Object.keys(specification.mapping)])]){
      if(key==='subscriber')continue;
      const input=key==='rulesJson'?ruleEditor(card,specification.mapping[key]||'',()=>candidates.find(item=>item.endpoint===endpoint.value)?.typeTree,endpoint):field(card,'Field or parameter: '+key+(key==='commandFrame'||key==='frame'||key==='expectedFrame'?' (verify frame)':''),specification.mapping[key]||'',key==='allowedPrograms'?'textarea':'text');
      if(input.tagName==='INPUT'&&key!=='commandFrame'&&key!=='expectedFrame'&&!key.startsWith('max')&&!key.startsWith('default'))input.setAttribute('list',pointerList.id);
      controls.mapping[key]=input;
    }
    controls.goal=field(card,'Real example goal or message (JSON object)','', 'textarea');
    if(specification.adapter==='topic_twist'||specification.adapter==='topic_fields'){
      const sample=document.createElement('button'),sampleStatus=document.createElement('div');sample.type='button';sample.className='secondary';sample.textContent='Read one incoming message (optional)';sampleStatus.className='status';card.append(sample,sampleStatus);
      sample.onclick=async()=>{try{
        if(catalogOrigin!=='live')throw new Error('Discover the current ROS graph before reading a live message. A saved catalog is not live-state proof.');
        if(!endpoint.value)throw new Error('Choose the intended topic first.');
        sampleStatus.textContent='Waiting briefly for one incoming message…';
        const result=await api('sample-topic',{catalog:workspace.catalog,endpoint:endpoint.value});
        controls.goal.value=JSON.stringify(result.payload,null,2);sampleStatus.textContent='One local message received at '+result.observedAt+'. Review its source, units and meaning; this did not confirm them.';updateMissing();
      }catch(error){sampleStatus.textContent=error.message||String(error)}};
    }
    const confirmation=field(card,'I checked this interface meaning, units, frame and limits against the actual system','','checkbox');confirmation.value='yes';controls.confirmed=confirmation;
    formControls.paths.push(controls);
  }
  const filesHeading=document.createElement('h3');filesHeading.textContent='Actual robot and configuration files';root.append(filesHeading);
  const unique=new Set();for(const fact of template.facts){
    if(unique.has(fact.path))continue;unique.add(fact.path);
    const source=field(root,fact.path+' · '+fact.kind+(fact.pointer?' · '+fact.pointer:''),'','file');source.accept=fact.path.endsWith('.urdf')?'.urdf,.xml':'*/*';
    formControls.files.set(fact.path,source);
    let matching=projectFiles.find(file=>file.name===fact.path.split('/').pop());
    if(!matching&&fact.id==='robot-description'){
      const robots=inspections.filter(item=>item.kind==='robot-description'&&!item.needsExpansion);
      if(robots.length===1)matching=projectFiles.find(file=>file.name===robots[0].name);
    }
    if(!matching&&fact.kind==='file_sha256'&&fact.id!=='robot-description'){
      const configs=inspections.filter(item=>item.kind==='configuration');
      if(configs.length===1&&template.facts.filter(item=>item.kind==='file_sha256'&&item.id!=='robot-description').length===1)
        matching=projectFiles.find(file=>file.name===configs[0].name);
    }
    if(matching){const transfer=new DataTransfer();transfer.items.add(matching);source.files=transfer.files}
  }
  updateMissing();
}
function pointer(document,path){if(!path.startsWith('/'))throw new Error('Invalid JSON pointer');return path.slice(1).split('/').reduce((value,token)=>value?.[token.replace(/~1/g,'/').replace(/~0/g,'~')],document)}
async function digest(bytes){const value=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('')}
function base64(bytes){let raw='';for(let index=0;index<bytes.length;index+=8192)raw+=String.fromCharCode(...bytes.subarray(index,index+8192));return btoa(raw)}
async function finish(){
  if(!workspace||!formControls)throw new Error('Generate a setup plan first.');
  const chosen=[];let total=0;
  for(const [path,input] of formControls.files){const selected=input.files?.[0];if(!selected)throw new Error('Choose the actual file for '+path);if(selected.size>8*1024*1024)throw new Error(path+' exceeds 8 MiB');total+=selected.size;if(total>24*1024*1024)throw new Error('Selected files exceed 24 MiB');const bytes=new Uint8Array(await selected.arrayBuffer());if(workspace.template.facts.some(fact=>fact.path===path&&fact.id==='robot-description')){const inspected=await api('inspect-project',{name:'robot.urdf',base64:base64(bytes)});if(inspected.kind!=='robot-description'||inspected.needsExpansion)throw new Error('Choose an expanded, valid URDF for the robot-description fact.')}chosen.push({path,bytes})}
  const facts=[];for(const fact of workspace.template.facts){const source=chosen.find(file=>file.path===fact.path);let expected;
    if(fact.kind==='file_sha256')expected=await digest(source.bytes);
    else {const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(source.bytes)),stamp=parsed.observedAt;if(typeof stamp!=='string'||!Number.isFinite(Date.parse(stamp)))throw new Error(fact.id+' needs a real exporter observedAt timestamp');expected=pointer(parsed,fact.pointer);if(typeof expected!=='string'||!expected||expected.trim()!==expected)throw new Error(fact.id+' must select a nonempty string')}
    facts.push({...fact,expected});
  }
  const decisions=formControls.paths.map(item=>({pathId:item.pathId,endpoint:item.endpoint.value,mapping:Object.fromEntries(Object.entries(item.mapping).map(([key,control])=>[key,control.value])),goal:JSON.parse(item.goal.value),confirmed:item.confirmed.checked}));
  const values=formControls.robot;
  const robot={id:values.id.value.trim(),deviceId:values.deviceId.value.trim(),model:values.model.value.trim(),controller:values.controller.value.trim(),jointOrder:values.jointOrder.value.split(/[\\s,]+/).filter(Boolean),maxObservationAgeMs:Number(values.age.value)};
  const connection=await api('complete',{catalog:workspace.catalog,fragments:workspace.fragments,robot,facts,decisions});
  const response=await fetch('/'+token+'/api/workspace',{method:'POST',headers:{'content-type':'application/json','x-rlsok-session':token},body:JSON.stringify({connection,template:reusableTemplate(),files:chosen.map(file=>({path:file.path,base64:base64(file.bytes)}))})});
  if(!response.ok){const result=await response.json();throw new Error(result.error||'Workspace export failed')}
  const url=URL.createObjectURL(await response.blob()),anchor=document.createElement('a');anchor.href=url;anchor.download='rlsok-local-check-workspace.zip';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
fetch('/'+token+'/api/adapters',{headers:{'x-rlsok-session':token}}).then(r=>r.json()).then(items=>render('adapters',items.map(a=>({title:a.id,detail:a.source+' · '+a.purpose}))));
$('finishFields').addEventListener('input',updateMissing);$('finishFields').addEventListener('change',updateMissing);
async function inspectProjectSelection(selected){
  if(!selected.length)throw new Error('Choose at least one robot description or configuration file.');
  if(selected.length>16)throw new Error('Maximum 16 project files. Select the files used by this robot.');
  if(selected.reduce((total,file)=>total+file.size,0)>24*1024*1024)throw new Error('Project files exceed 24 MiB.');
  if(new Set(selected.map(file=>file.name)).size!==selected.length)throw new Error('Selected project files have duplicate names. Choose one copy of each filename.');
  const next=[];for(const file of selected){if(file.size>8*1024*1024)throw new Error(file.name+' exceeds 8 MiB');next.push(await api('inspect-project',{name:file.name,base64:base64(new Uint8Array(await file.arrayBuffer()))}))}
  projectFiles=selected;inspections=next;showProject();
  if(workspace){workspace=null;renderFinish();$('download').disabled=true;$('templateDownload').disabled=true;show('summary','Project files changed. Next: generate again so the saved template binds the selected files.','bad')}
}
$('projectFiles').onchange=async event=>{try{await inspectProjectSelection([...event.target.files])}catch(error){show('projectStatus',error.message||String(error),'bad')}};
function renderSavedFolderChoices(){
  const root=$('folderSavedChoices');root.replaceChildren();
  for(const [kind,items] of [['catalog',folderCatalogFiles],['template',folderTemplateFiles]])for(const file of items){
    const row=document.createElement('div'),name=document.createElement('span'),button=document.createElement('button');row.className='item';
    name.textContent=(file.webkitRelativePath||file.name)+' · saved '+kind+' ';button.type='button';button.className='secondary';button.textContent=kind==='catalog'?'Use this catalog':'Add this rule template';
    button.onclick=async()=>{try{const candidate=JSON.parse(await file.text());if(kind==='catalog'){if(candidate.kind!=='RlsokInterfaceCatalog')throw new Error('Not an RLSOK interface catalog');useCatalog(await api('source',{plugin:'saved-ros2-catalog/v1',catalog:candidate}),'the selected project file')}else{if(candidate.kind!=='RlsokConnectionTemplate')throw new Error('Not an RLSOK rule template');if(fragments.length>=16)throw new Error('Maximum 16 fragments');const valid=await api('validate-fragment',{fragment:candidate});fragments.push(valid);render('fragmentList',fragments.map(f=>({title:f.metadata.name,detail:f.metadata.id+'@'+f.metadata.version})));invalidatePlan();updateNextStep();show('planStatus','Rule template added from this project folder. Prepare again to match its interfaces.','good')}}catch(error){show(kind==='catalog'?'catalogStatus':'planStatus','Invalid saved '+kind+': '+(error.message||String(error)),'bad')}};
    row.append(name,button);root.append(row);
  }
}
function renderXacroChoices(){
  const controls=$('xacroControls'),select=$('xacroEntry');controls.hidden=!folderXacroFiles.length;select.replaceChildren();
  for(const file of folderXacroFiles)option(select,file.path,file.path);
  $('xacroTrust').checked=false;show('xacroStatus',folderXacroFiles.length?'Choose a source, review its arguments, and explicitly authorize local expansion.':'');
}
function renderProjectDeclarationChoices(total=0){
  const controls=$('projectInterfaceControls'),select=$('projectDeclaration');controls.hidden=!folderInterfaceFiles.length;select.replaceChildren();
  for(const [index,file] of folderInterfaceFiles.entries())option(select,String(index),file.webkitRelativePath||file.name);
  show('projectDeclarationStatus',folderInterfaceFiles.length?total+' interface source files found; '+folderInterfaceFiles.length+' can be inspected here. This does not identify a running endpoint.':'');
}
$('projectFolder').onchange=async event=>{try{
  const entries=[...event.target.files],ignored=/(?:^|\\/)(?:\\.git|\\.github|node_modules|build|install|log|dist)(?:\\/|$)/i;
  projectFiles=[];inspections=[];catalog=null;catalogOrigin='none';workspace=null;folderCandidates=[];folderCatalogFiles=[];folderTemplateFiles=[];folderXacroFiles=[];folderXacroResources=[];folderInterfaceFiles=[];declarationInspection=null;renderFinish();render('projectList',[]);$('folderChoices').replaceChildren();$('folderSavedChoices').replaceChildren();renderXacroChoices();renderProjectDeclarationChoices();show('projectStatus','New folder selected. Inspect the actual files.');renderInterfaceChoices();show('catalogStatus','No catalog loaded for this folder. Discover this ROS graph or import one.');$('download').disabled=true;$('templateDownload').disabled=true;$('preview').textContent='Nothing generated yet.';
  const catalogFiles=entries.filter(file=>!ignored.test(file.webkitRelativePath||file.name)&&/^(?:catalog|interface-catalog|rlsok-interface-catalog)\\.json$/i.test(file.name)&&file.size<=2*1024*1024);
  const templateFiles=entries.filter(file=>!ignored.test(file.webkitRelativePath||file.name)&&/^(?:template|rlsok-connection-template|connection-template|fragment(?:-[A-Za-z0-9._-]+)?)\\.json$/i.test(file.name)&&file.size<=2*1024*1024);
  folderCatalogFiles=catalogFiles;folderTemplateFiles=templateFiles;
  folderXacroResources=entries.map(file=>({file,path:(file.webkitRelativePath||'').split('/').slice(1).join('/')})).filter(item=>!ignored.test(item.file.webkitRelativePath||'')&&item.path&&item.path.split('/').every(part=>/^[A-Za-z0-9_. -]+$/.test(part))&&/\\.(?:xacro|urdf|xml|json|ya?ml)$/i.test(item.path));
  folderXacroFiles=folderXacroResources.filter(item=>/\\.xacro$/i.test(item.path));renderXacroChoices();
  const interfaceFiles=entries.filter(file=>!ignored.test(file.webkitRelativePath||file.name)&&/\\.(?:msg|action|srv|idl)$/i.test(file.name)&&/^[A-Za-z0-9_. -]+$/.test(file.name)&&file.size<=1024*1024);
  folderInterfaceFiles=interfaceFiles.slice(0,4096);renderProjectDeclarationChoices(interfaceFiles.length);
  const allCandidates=entries.filter(file=>!ignored.test(file.webkitRelativePath||file.name)&&!/^\./.test(file.name)&&/\\.(?:urdf|srdf|json|ya?ml)$/i.test(file.name)&&/^[A-Za-z0-9_. -]+$/.test(file.name)&&file.size<=8*1024*1024&&!catalogFiles.includes(file)&&!templateFiles.includes(file));
  const priority=file=>/\\.urdf$/i.test(file.name)?2:/controller/i.test(file.name)?1:0;
  folderCandidates=allCandidates.sort((a,b)=>priority(b)-priority(a)||(a.webkitRelativePath||a.name).localeCompare(b.webkitRelativePath||b.name)).slice(0,256);
  const xacro=folderXacroFiles.length;
  renderSavedFolderChoices();
  let catalogNote='';
  if(catalogFiles.length===1){try{const candidate=JSON.parse(await catalogFiles[0].text());if(candidate.kind==='RlsokInterfaceCatalog'){useCatalog(await api('source',{plugin:'saved-ros2-catalog/v1',catalog:candidate}),'this project folder');catalogNote=' Valid saved interface catalog loaded.'}}catch(error){catalogNote=' Saved catalog could not be validated: '+(error.message||String(error))+'. Choose a valid catalog here or discover the live graph.'}}
  else if(catalogFiles.length>1)catalogNote=' Several saved catalogs found; choose the intended catalog explicitly.';
  let templateNote='';
  if(templateFiles.length===1&&!fragments.length){try{const candidate=JSON.parse(await templateFiles[0].text());if(candidate.kind==='RlsokConnectionTemplate'){const valid=await api('validate-fragment',{fragment:candidate});fragments=[valid];render('fragmentList',[{title:valid.metadata.name,detail:valid.metadata.id+'@'+valid.metadata.version}]);templateNote=' One versioned rule template loaded.'}}catch(error){templateNote=' Saved rule template could not be validated: '+(error.message||String(error))+'. Choose a valid template here.'}}
  else if(templateFiles.length>1)templateNote=' Several saved rule templates found; add the intended fragments explicitly.';
  else if(templateFiles.length&&fragments.length)templateNote=' Existing selected fragments were kept; add any folder template explicitly.';
  const root=$('folderChoices');root.replaceChildren();
  const urdfCandidates=folderCandidates.filter(file=>/\\.urdf$/i.test(file.name));
  const controllerCandidates=folderCandidates.filter(file=>/controller/i.test(file.name)&&/\\.(?:json|ya?ml)$/i.test(file.name));
  for(const [index,file] of folderCandidates.entries()){
    const label=document.createElement('label'),check=document.createElement('input'),text=document.createElement('span');
    label.className='item';check.type='checkbox';check.dataset.index=String(index);
    check.checked=(urdfCandidates.length===1&&urdfCandidates[0]===file)||(urdfCandidates.length===1&&controllerCandidates.length===1&&controllerCandidates[0]===file);
    text.textContent=' '+(file.webkitRelativePath||file.name)+' ('+Math.ceil(file.size/1024)+' KiB)';label.append(check,text);root.append(label);
  }
  $('inspectFolder').hidden=!folderCandidates.length;
  show('folderStatus',allCandidates.length+' robot/config candidates found'+(allCandidates.length>folderCandidates.length?'; showing '+folderCandidates.length+' prioritized files (choose omitted files individually)':'')+(interfaceFiles.length?'; '+interfaceFiles.length+' offline interface declarations':'')+(xacro?'; '+xacro+' Xacro sources available (expand the intended entry only if needed)':'')+'. '+(folderCandidates.length?'Only a unique robot description and unique controller configuration are selected automatically; review the choices before continuing. ':'No robot description or configuration was selected. ')+'Files stay local.'+catalogNote+templateNote,folderCandidates.length||folderXacroFiles.length||folderInterfaceFiles.length?'good':'bad');if(!folderCandidates.length)show('projectStatus','No robot description or configuration inspected in this folder.');updateNextStep();
  const defaults=[...root.querySelectorAll('input:checked')].map(input=>folderCandidates[Number(input.dataset.index)]);
  if(defaults.length&&defaults.length<=16&&new Set(defaults.map(file=>file.name)).size===defaults.length){try{await inspectProjectSelection(defaults)}catch(error){show('projectStatus','Automatic inspection needs review: '+(error.message||String(error)),'bad')}}
}catch(error){folderCandidates=[];folderCatalogFiles=[];folderTemplateFiles=[];folderXacroFiles=[];folderXacroResources=[];folderInterfaceFiles=[];declarationInspection=null;$('folderChoices').replaceChildren();$('folderSavedChoices').replaceChildren();renderXacroChoices();renderProjectDeclarationChoices();$('inspectFolder').hidden=true;show('folderStatus',error.message||String(error),'bad')}};
$('inspectFolder').onclick=async()=>{try{const selected=[...$('folderChoices').querySelectorAll('input:checked')].map(input=>folderCandidates[Number(input.dataset.index)]);await inspectProjectSelection(selected)}catch(error){show('projectStatus',error.message||String(error),'bad')}};
$('inspectDeclaration').onclick=async()=>{try{
  const file=folderInterfaceFiles[Number($('projectDeclaration').value)];
  if(!file)throw new Error('Choose a project interface declaration.');
  const result=await api('inspect-project',{name:file.name,base64:base64(new Uint8Array(await file.arrayBuffer()))});
  if(result.kind!=='interface-declaration')throw new Error('Selected file is not an interface declaration.');
  declarationInspection=result;const fields=result.declaredFields||[],preview=fields.slice(0,24).map(field=>field.section+': '+field.type+' '+field.name).join(', ');
  show('projectDeclarationStatus',(file.webkitRelativePath||file.name)+': '+fields.length+' declared fields'+(preview?' — '+preview:'')+(fields.length>24?' (and '+(fields.length-24)+' more)':'')+'. '+result.warnings.join(' '),'good');renderPipeline();updateNextStep();
}catch(error){show('projectDeclarationStatus',error.message||String(error),'bad')}};
$('expandXacro').onclick=async()=>{try{
  if(!$('xacroTrust').checked)throw new Error('Confirm that you trust this project before executing its Xacro.');
  const entry=$('xacroEntry').value,args=$('xacroArgs').value.split(/\\r?\\n/).map(value=>value.trim()).filter(Boolean);
  if(folderXacroResources.length>128||folderXacroResources.reduce((total,item)=>total+item.file.size,0)>24*1024*1024)throw new Error('Xacro project exceeds 128 source files or 24 MiB. Select or expand it in your own ROS environment.');
  show('xacroStatus','Expanding this trusted project locally…');
  const files=await Promise.all(folderXacroResources.map(async item=>({path:item.path,base64:base64(new Uint8Array(await item.file.arrayBuffer()))})));
  const expanded=await api('expand-xacro',{entry,files,args,trusted:true});
  const bytes=Uint8Array.from(atob(expanded.base64),character=>character.charCodeAt(0)),selected=[...projectFiles.filter(file=>!inspections.some(item=>item.name===file.name&&item.kind==='robot-description')),new File([bytes],expanded.name,{type:'application/xml'})];
  await inspectProjectSelection(selected);show('xacroStatus','Expanded URDF inspected. Confirm the model and joint order, then prepare the workspace. The expanded bytes will be included in the local ZIP.','good');
}catch(error){show('xacroStatus',error.message||String(error),'bad')}};
$('discover').onclick=async()=>{show('catalogStatus','Discovering…');try{useCatalog(await api('source',{plugin:'ros2-live-graph/v1'}),'this ROS graph',true)}catch(e){show('catalogStatus',e.message,'bad')}};
$('catalog').onchange=async e=>{try{useCatalog(await api('source',{plugin:'saved-ros2-catalog/v1',catalog:(await files(e.target))[0]}),'the selected catalog')}catch(e){show('catalogStatus','Invalid catalog: '+e.message,'bad')}};
$('fragments').onchange=async e=>{try{const selected=await files(e.target);if(fragments.length+selected.length>16)throw new Error('Maximum 16 fragments');const added=await Promise.all(selected.map(fragment=>api('validate-fragment',{fragment})));fragments.push(...added);render('fragmentList',fragments.map((f,i)=>({title:f.metadata.name,detail:f.metadata.id+'@'+f.metadata.version})));invalidatePlan();updateNextStep()}catch(e){show('planStatus','Invalid fragment: '+e.message,'bad')}};
$('clear').onclick=()=>{fragments=[];$('fragmentList').replaceChildren();workspace=null;renderFinish();$('download').disabled=true;$('templateDownload').disabled=true;$('preview').textContent='Nothing generated yet.';updateNextStep()};
$('generate').onclick=async()=>{if(!catalog||(!fragments.length&&!$('starterInterface').value)){show('planStatus','Load a catalog and choose an interface or fragments.','bad');return}show('planStatus','Generating…');try{const [kind,endpoint]=$('starterInterface').value.split('|');const result=await api('generate',{catalog,fragments,starter:{kind,endpoint,adapter:$('starterAdapter').value,projectFiles:inspections.map(item=>({name:item.name,kind:item.kind}))}});workspace=result;$('preview').textContent=JSON.stringify(result,null,2);const ready=result.plan.readyForConfiguration;show('planStatus',ready?(catalogOrigin==='saved'?'Saved interface catalog matched structurally. Rediscover the live graph before treating the endpoint as active.':'Current graph interfaces matched. Confirm semantics and finish required inputs.'):'Plan generated with missing or ambiguous interfaces. Review the preview. ',ready?'good':'bad');show('summary',result.plan.paths.filter(path=>path.status==='MATCHED').length+' of '+result.plan.paths.length+' interfaces matched in '+(catalogOrigin==='saved'?'a saved catalog':'the current graph')+'; '+result.plan.paths.filter(path=>path.status!=='MATCHED').length+' need selection or discovery.',ready?'good':'bad');$('download').disabled=false;$('templateDownload').disabled=false;renderFinish();renderPipeline()}catch(e){show('planStatus',e.message,'bad')}};
$('download').onclick=()=>{if(!workspace)return;const blob=new Blob([JSON.stringify(workspace,null,2)+'\\n'],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='rlsok-local-setup-workspace.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
$('templateDownload').onclick=async()=>{try{const template=await api('validate-fragment',{fragment:reusableTemplate()}),blob=new Blob([JSON.stringify(template,null,2)+'\\n'],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='rlsok-connection-template.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);show('planStatus','Versioned private template downloaded. Re-import it and supply machine-specific parameters on the next project.','good')}catch(error){show('planStatus',error.message||String(error),'bad')}};
$('complete').onclick=async()=>{show('completeStatus','Checking selected files and configuration…');try{await finish();show('completeStatus','Workspace ZIP downloaded. Review the generated files before local evaluation.','good')}catch(error){show('completeStatus',error.message||String(error),'bad')}};
</script></body></html>`;
}

export async function runSetupAssistant(args: string[]): Promise<number> {
  let port = 0, openBrowser = true, python = process.platform === 'win32' ? 'python' : 'python3';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--no-browser') openBrowser = false;
    else if (arg === '--port' || arg === '--python') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`missing_${arg.slice(2)}_value`);
      if (arg === '--port') { port = Number(value); if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('port_must_be_0_to_65535'); }
      else python = value;
    } else if (['help', '--help', '-h'].includes(arg)) {
      process.stdout.write('usage: rlsok setup-assistant [--port <0-65535>] [--python <python3>] [--no-browser]\n');
      return 0;
    } else throw new Error(`unknown_setup_assistant_option:${arg}`);
  }
  const token = randomBytes(24).toString('hex');
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const base = `/${token}`;
      if (url.pathname === '/' && request.method === 'GET') { response.writeHead(302, { location: `${base}/`, 'cache-control': 'no-store' }); response.end(); return; }
      if (!url.pathname.startsWith(`${base}/`) || request.headers['x-rlsok-session'] && request.headers['x-rlsok-session'] !== token) { json(response, 404, { error: 'not_found' }); return; }
      if (url.pathname === `${base}/` && request.method === 'GET') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
        response.end(page(token)); return;
      }
      if (request.headers['x-rlsok-session'] !== token) { json(response, 403, { error: 'invalid_session' }); return; }
      if (url.pathname === `${base}/api/adapters` && request.method === 'GET') { json(response, 200, ADAPTERS); return; }
      if (url.pathname === `${base}/api/source` && request.method === 'POST') {
        const input = await body(request) as { plugin?: string; catalog?: unknown };
        json(response, 200, await loadInterfaceSource(input.plugin ?? '', input.catalog, python)); return;
      }
      if (url.pathname === `${base}/api/validate-catalog` && request.method === 'POST') {
        const input = await body(request) as { catalog?: unknown };
        json(response, 200, await readCatalog(input.catalog)); return;
      }
      if (url.pathname === `${base}/api/validate-fragment` && request.method === 'POST') {
        const input = await body(request) as { fragment?: unknown };
        json(response, 200, connectionTemplateSchema.parse(input.fragment)); return;
      }
      if (url.pathname === `${base}/api/inspect-project` && request.method === 'POST') {
        const input = await body(request, 12 * 1024 * 1024) as { name?: string; base64?: string };
        json(response, 200, inspectProjectFile(input.name ?? '', input.base64 ?? '')); return;
      }
      if (url.pathname === `${base}/api/expand-xacro` && request.method === 'POST') {
        const input = await body(request, 36 * 1024 * 1024) as XacroInput;
        json(response, 200, await expandTrustedXacro(input, python)); return;
      }
      if (url.pathname === `${base}/api/sample-topic` && request.method === 'POST') {
        const input = await body(request) as { catalog?: unknown; endpoint?: string };
        json(response, 200, await sampleTopic(python, input.catalog, input.endpoint ?? '')); return;
      }
      if (url.pathname === `${base}/api/discover` && request.method === 'POST') { await body(request); json(response, 200, await discover(python)); return; }
      if (url.pathname === `${base}/api/generate` && request.method === 'POST') {
        const input = await body(request) as { catalog?: unknown; fragments?: unknown[]; starter?: { endpoint?: string; kind?: string; adapter?: string; projectFiles?: Array<{ name: string; kind: string }> } };
        const catalog = await readCatalog(input.catalog);
        const fragments = [...(input.fragments ?? [])];
        if (input.starter?.endpoint) fragments.unshift(starterTemplate(catalog, input.starter));
        if (!fragments.length) throw new Error('choose_interface_or_fragments');
        const template = composeConnectionTemplates(fragments);
        const plan = planConnectionTemplate(template, catalog);
        json(response, 200, { schemaVersion: 1, kind: 'RlsokLocalSetupWorkspace', generatedAt: new Date().toISOString(), localOnly: true, cloudUploaded: false, hardwareSignalSent: false, catalog, fragments, template, plan }); return;
      }
      if (url.pathname === `${base}/api/complete` && request.method === 'POST') {
        const input = await body(request) as AssistedSetupInput;
        json(response, 200, await buildAssistedConnection(input)); return;
      }
      if (url.pathname === `${base}/api/workspace` && request.method === 'POST') {
        const input = await body(request, 36 * 1024 * 1024) as { connection?: unknown; template?: unknown; files?: WorkspaceFile[] };
        const archive = await buildSetupWorkspace(input.connection, input.files ?? [], input.template);
        response.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="rlsok-local-check-workspace.zip"',
          'content-length': archive.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        response.end(archive); return;
      }
      json(response, 404, { error: 'not_found' });
    } catch (error) { json(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('setup_assistant_address_unavailable');
  const url = `http://127.0.0.1:${address.port}/${token}/`;
  process.stdout.write(`RLSOK Local Setup Assistant\n${url}\nBound to 127.0.0.1 only. No cloud upload or hardware dispatch. Press Ctrl+C to stop.\n`);
  if (openBrowser) launchBrowser(url);
  return await new Promise<number>(resolve => {
    const stop = () => server.close(() => resolve(0));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  });
}
