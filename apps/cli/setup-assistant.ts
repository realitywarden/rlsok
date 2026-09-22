import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { composeConnectionTemplates, planConnectionTemplate } from '../../packages/composable-shadow/templates';
import { readCatalog } from '../../packages/composable-shadow/onboarding';
import { launchBrowser } from './browser-launch';

const MAX_BODY = 2 * 1024 * 1024;
const ADAPTERS = [
  { id: 'topic_twist', source: 'ROS 2 topic', interfaceTypes: ['geometry_msgs/msg/Twist', 'geometry_msgs/msg/TwistStamped'], purpose: 'Mobile base velocity' },
  { id: 'joint_trajectory', source: 'ROS 2 action', interfaceTypes: ['control_msgs/action/FollowJointTrajectory'], purpose: 'Joint trajectory' },
  { id: 'cartesian_pose', source: 'ROS 2 action', interfaceTypes: ['custom pose action'], purpose: 'Cartesian pose' },
  { id: 'cartesian_delta', source: 'ROS 2 action', interfaceTypes: ['custom delta action'], purpose: 'Cartesian delta' },
  { id: 'cartesian_absolute_wpr', source: 'ROS 2 action', interfaceTypes: ['custom WPR action'], purpose: 'Absolute WPR pose' },
  { id: 'tp_program', source: 'ROS 2 action', interfaceTypes: ['custom program action'], purpose: 'Program selection' },
] as const;

function collectorScript(): string {
  let directory = __dirname;
  for (let index = 0; index < 7; index += 1) {
    const candidate = join(directory, 'experimental', 'composable-shadow', 'collect.py');
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    directory = dirname(directory);
  }
  throw new Error('composable_shadow_collector_missing');
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > MAX_BODY) throw new Error('request_body_exceeds_2MiB');
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
        const catalog = await readCatalog(JSON.parse(readFileSync(output, 'utf8')));
        resolve(catalog);
      } catch (error) { reject(error); }
      finally { rmSync(directory, { recursive: true, force: true }); }
    });
  }));
}

function page(token: string): string {
  const safeToken = JSON.stringify(token).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RLSOK Local Setup Assistant</title><style>
:root{color-scheme:light;--ink:#15231f;--muted:#60716a;--line:#dce5e1;--soft:#f3f7f5;--accent:#087a5b;--accent2:#e3f4ee}*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink);background:#f8faf9}header{padding:30px max(24px,calc((100vw - 1120px)/2));background:#10241e;color:white}header p{margin:6px 0 0;color:#bfd0ca}main{max-width:1120px;margin:24px auto;padding:0 24px 60px}.notice{padding:12px 16px;border:1px solid #b9ded1;background:var(--accent2);border-radius:10px;margin-bottom:18px}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.step{padding:13px;border:1px solid var(--line);border-radius:10px;background:white}.step b{display:block;color:var(--accent)}.grid{display:grid;grid-template-columns:1.1fr .9fr;gap:18px}.card{background:white;border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:18px}.card h2{font-size:19px;margin:0 0 6px}.card p{color:var(--muted);margin:0 0 14px}button,.button{display:inline-block;border:0;border-radius:8px;padding:10px 14px;background:var(--accent);color:white;font-weight:650;cursor:pointer;margin:0 7px 7px 0}button.secondary,.button.secondary{background:#e8eeeb;color:var(--ink)}input[type=file]{position:absolute;inline-size:1px;block-size:1px;opacity:0;overflow:hidden}.list{display:grid;gap:8px}.item{padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--soft)}.item small{display:block;color:var(--muted)}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:330px;overflow:auto;background:#10241e;color:#d7eee6;padding:14px;border-radius:9px;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.status{min-height:24px;color:var(--muted)}.good{color:#087a5b}.bad{color:#a33b2f}@media(max-width:760px){.steps,.grid{grid-template-columns:1fr}header{padding:24px}.steps{gap:6px}}
</style></head><body><header><h1>Local Setup Assistant</h1><p>Discover, compose, match, and export locally. No account, cloud upload, AI, or robot command.</p></header><main>
<div class="notice"><strong>Read-only setup:</strong> discovery reads the visible ROS 2 graph and interface definitions. This assistant never publishes a topic, sends an action goal, or grants execution permission.</div>
<div class="steps"><div class="step"><b>1 · Discover</b>Read a live graph or import a catalog.</div><div class="step"><b>2 · Compose</b>Combine reusable template fragments.</div><div class="step"><b>3 · Match</b>Resolve interfaces and show gaps.</div><div class="step"><b>4 · Export</b>Save the local setup workspace.</div></div>
<div class="grid"><section>
<div class="card"><h2>1. Interface discovery</h2><p>Use the ROS environment sourced in the terminal that started this assistant, or import a previously discovered catalog.</p><button id="discover">Discover this ROS graph</button><label class="button secondary" for="catalog">Import catalog JSON</label><input id="catalog" type="file" accept="application/json,.json"><div id="catalogStatus" class="status">No catalog loaded.</div></div>
<div class="card"><h2>2. Reusable fragments</h2><p>Add up to 16 private template fragments. Later fragments override shared defaults; paths and facts are combined.</p><label class="button" for="fragments">Add template fragments</label><input id="fragments" type="file" accept="application/json,.json" multiple><button id="clear" class="secondary">Clear</button><div id="fragmentList" class="list"></div></div>
<div class="card"><h2>3. Generate and match</h2><p>The generated plan chooses a unique or explicitly hinted endpoint. Units, frames, and physical meaning still require your confirmation.</p><button id="generate">Generate setup plan</button><div id="planStatus" class="status">Waiting for a catalog and fragments.</div></div>
</section><aside>
<div class="card"><h2>Adapter registry</h2><p>Data source, parser, and safety checks stay separate so integrations remain reusable.</p><div id="adapters" class="list"></div></div>
<div class="card"><h2>4. Local workspace</h2><p>Export contains the catalog, composed private template, and matching plan. It remains on this computer unless you choose to move it.</p><button id="download" disabled>Download workspace JSON</button><pre id="preview">Nothing generated yet.</pre></div>
</aside></div></main><script>
const token=${safeToken};let catalog=null,fragments=[],workspace=null;
const $=id=>document.getElementById(id);const show=(id,text,kind='')=>{const el=$(id);el.textContent=text;el.className='status '+kind};const render=(target,items)=>{const root=$(target);root.replaceChildren(...items.map(item=>{const row=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('small');row.className='item';title.textContent=item.title;detail.textContent=item.detail;row.append(title,detail);return row}))};
async function api(path,payload){const response=await fetch('/'+token+'/api/'+path,{method:'POST',headers:{'content-type':'application/json','x-rlsok-session':token},body:JSON.stringify(payload||{})});const value=await response.json();if(!response.ok)throw new Error(value.error||'Request failed');return value}
async function files(input){return Promise.all([...input.files].map(file=>file.text().then(JSON.parse)))}
fetch('/'+token+'/api/adapters',{headers:{'x-rlsok-session':token}}).then(r=>r.json()).then(items=>render('adapters',items.map(a=>({title:a.id,detail:a.source+' · '+a.purpose}))));
$('discover').onclick=async()=>{show('catalogStatus','Discovering…');try{catalog=await api('discover',{});show('catalogStatus',(catalog.actions.length+(catalog.topics||[]).length)+' interfaces discovered.','good')}catch(e){show('catalogStatus',e.message,'bad')}};
$('catalog').onchange=async e=>{try{catalog=(await files(e.target))[0];show('catalogStatus',((catalog.actions||[]).length+(catalog.topics||[]).length)+' interfaces imported.','good')}catch(e){show('catalogStatus','Invalid catalog: '+e.message,'bad')}};
$('fragments').onchange=async e=>{try{const added=await files(e.target);if(fragments.length+added.length>16)throw new Error('Maximum 16 fragments');fragments.push(...added);render('fragmentList',fragments.map((f,i)=>({title:f.metadata?.name||'Fragment '+(i+1),detail:(f.metadata?.id||'unknown')+'@'+(f.metadata?.version||'?')})))}catch(e){show('planStatus','Invalid fragment: '+e.message,'bad')}};
$('clear').onclick=()=>{fragments=[];$('fragmentList').replaceChildren();workspace=null;$('download').disabled=true;$('preview').textContent='Nothing generated yet.'};
$('generate').onclick=async()=>{if(!catalog||!fragments.length){show('planStatus','Load one catalog and at least one fragment.','bad');return}show('planStatus','Generating…');try{const result=await api('generate',{catalog,fragments});workspace=result;$('preview').textContent=JSON.stringify(result,null,2);const ready=result.plan.readyForConfiguration;show('planStatus',ready?'All declared interfaces matched. Confirm semantics and finish required inputs.':'Plan generated with missing or ambiguous interfaces. Review the preview. ',ready?'good':'bad');$('download').disabled=false}catch(e){show('planStatus',e.message,'bad')}};
$('download').onclick=()=>{if(!workspace)return;const blob=new Blob([JSON.stringify(workspace,null,2)+'\\n'],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='rlsok-local-setup-workspace.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
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
      if (url.pathname === `${base}/api/discover` && request.method === 'POST') { await body(request); json(response, 200, await discover(python)); return; }
      if (url.pathname === `${base}/api/generate` && request.method === 'POST') {
        const input = await body(request) as { catalog?: unknown; fragments?: unknown[] };
        const catalog = await readCatalog(input.catalog);
        const template = composeConnectionTemplates(input.fragments ?? []);
        const plan = planConnectionTemplate(template, catalog);
        json(response, 200, { schemaVersion: 1, kind: 'RlsokLocalSetupWorkspace', generatedAt: new Date().toISOString(), localOnly: true, cloudUploaded: false, hardwareSignalSent: false, catalog, template, plan }); return;
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
