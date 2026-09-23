import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inspectProjectFile } from './setup-project';

export type XacroInput = { entry: string; files: Array<{ path: string; base64: string }>; args?: string[]; trusted?: boolean };

function safeRelativePath(path: string): boolean {
  return typeof path === 'string' && path.length > 0 && path.length <= 512 &&
    !/[\\:\u0000-\u001f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..' && /^[A-Za-z0-9_. -]+$/.test(part));
}

export async function expandTrustedXacro(input: XacroInput, python: string): Promise<{ name: string; base64: string; inspection: ReturnType<typeof inspectProjectFile> }> {
  if (input?.trusted !== true) throw new Error('xacro_requires_explicit_trust_confirmation');
  if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > 128 || !safeRelativePath(input.entry) || !/\.xacro$/i.test(input.entry))
    throw new Error('invalid_xacro_project');
  if (!Array.isArray(input.args ?? []) || (input.args ?? []).length > 32 || (input.args ?? []).some(arg => typeof arg !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*:=[^\u0000-\u001f]{0,512}$/.test(arg)))
    throw new Error('invalid_xacro_arguments');
  const paths = new Set<string>(); let total = 0;
  const files = input.files.map(file => {
    if (!safeRelativePath(file.path) || paths.has(file.path) || !/\.(?:xacro|urdf|xml|json|ya?ml)$/i.test(file.path) ||
      typeof file.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) throw new Error('invalid_xacro_project_file');
    paths.add(file.path);
    const bytes = Buffer.from(file.base64, 'base64'); total += bytes.length;
    if (bytes.length > 8 * 1024 * 1024 || total > 24 * 1024 * 1024) throw new Error('xacro_project_exceeds_24MiB');
    return { path: file.path, bytes };
  });
  if (!paths.has(input.entry)) throw new Error('xacro_entry_not_in_project');
  const directory = await mkdtemp(join(tmpdir(), 'rlsok-xacro-'));
  try {
    for (const file of files) {
      const target = join(directory, ...file.path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.bytes, { flag: 'wx' });
    }
    const output = await new Promise<Buffer>((resolve, reject) => {
      // The ROS xacro package exposes main(), but has no __main__.py on its
      // ROS 2 branch; invoke its public CLI entry point through this Python.
      const child = spawn(python, ['-c', 'import xacro; xacro.main()', join(directory, ...input.entry.split('/')), ...(input.args ?? [])],
        { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
      const chunks: Buffer[] = []; let size = 0, stderr = '', settled = false;
      const finish = (error?: Error, bytes?: Buffer) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(bytes!); };
      const timer = setTimeout(() => { child.kill(); finish(new Error('xacro_expansion_timed_out')); }, 30_000);
      child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 8 * 1024 * 1024) { child.kill(); finish(new Error('expanded_urdf_exceeds_8MiB')); } else chunks.push(chunk); });
      child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 16_384) stderr += chunk.toString(); });
      child.once('error', error => finish(error));
      child.once('close', code => {
        const reason = /No module named ['"]?xacro/.test(stderr)
          ? 'xacro_unavailable_in_selected_python: source a ROS environment with xacro, restart this assistant, or provide an expanded URDF'
          : stderr.trim() || `xacro_exited_${code ?? 'unknown'}`;
        finish(code === 0 ? undefined : new Error(reason), Buffer.concat(chunks));
      });
    });
    const name = 'expanded-robot.urdf';
    const base64 = output.toString('base64');
    const inspection = inspectProjectFile(name, base64);
    if (inspection.kind !== 'robot-description' || inspection.needsExpansion) throw new Error('xacro_output_is_not_expanded_urdf');
    return { name, base64, inspection };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
