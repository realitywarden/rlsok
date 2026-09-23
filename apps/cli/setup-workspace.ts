import { createHash } from 'node:crypto';
import { atPointer } from '../../packages/composable-shadow/contracts';
import { readConnection, type Connection } from '../../packages/composable-shadow/onboarding';

export type WorkspaceFile = { path: string; base64: string };

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: Array<{ name: string; bytes: Buffer }>): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  const names = new Set<string>();
  let offset = 0;
  for (const entry of entries) {
    if (names.has(entry.name) || !(/^(?:files\/[^\\:\u0000-\u001f]+|profile\.json|proposals\.json|catalog\.json|connection\.json|template\.json|README\.md)$/.test(entry.name)) ||
      entry.name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('invalid_workspace_entry');
    names.add(entry.name);
    const name = Buffer.from(entry.name, 'utf8'), checksum = crc32(entry.bytes);
    const header = Buffer.alloc(30 + name.length);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(entry.bytes.length, 18); header.writeUInt32LE(entry.bytes.length, 22);
    header.writeUInt16LE(name.length, 26); name.copy(header, 30);
    const directory = Buffer.alloc(46 + name.length);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
    directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(entry.bytes.length, 20); directory.writeUInt32LE(entry.bytes.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42); name.copy(directory, 46);
    local.push(header, entry.bytes); central.push(directory);
    offset += header.length + entry.bytes.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

function decode(file: WorkspaceFile): Buffer {
  if (typeof file.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64))
    throw new Error(`invalid_file_encoding:${file.path}`);
  const bytes = Buffer.from(file.base64, 'base64');
  if (bytes.length > 8 * 1024 * 1024) throw new Error(`file_exceeds_8MiB:${file.path}`);
  return bytes;
}

function expectedJsonValue(bytes: Buffer, pointer: string): string {
  const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const observedAt = atPointer(document, '/observedAt');
  if (typeof observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(observedAt) || !Number.isFinite(Date.parse(observedAt)))
    throw new Error('json_fact_requires_exporter_observedAt');
  const value = atPointer(document, pointer);
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 512 || /[\u0000-\u001f]/.test(value))
    throw new Error('json_fact_requires_nonempty_string');
  return value;
}

export async function buildSetupWorkspace(connectionInput: unknown, fileInputs: WorkspaceFile[], templateInput?: unknown): Promise<Buffer> {
  const connection: Connection = await readConnection(connectionInput);
  const requiredPaths = new Set(connection.profile.facts.map(fact => fact.path));
  if (!Array.isArray(fileInputs) || fileInputs.length !== requiredPaths.size) throw new Error('one_actual_file_per_source_path_required');
  const supplied = new Map<string, Buffer>();
  let total = 0;
  for (const file of fileInputs) {
    if (!requiredPaths.has(file.path) || supplied.has(file.path)) throw new Error(`unexpected_or_duplicate_file:${file.path}`);
    const bytes = decode(file);
    total += bytes.length;
    if (total > 24 * 1024 * 1024) throw new Error('files_exceed_24MiB');
    supplied.set(file.path, bytes);
  }
  for (const fact of connection.profile.facts) {
    const bytes = supplied.get(fact.path);
    if (!bytes) throw new Error(`missing_file:${fact.path}`);
    const expected = fact.kind === 'file_sha256' ? createHash('sha256').update(bytes).digest('hex') : expectedJsonValue(bytes, fact.pointer!);
    if (expected !== fact.expected) throw new Error(`selected_file_differs_from_expected:${fact.id}`);
  }
  const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const entries = [
    { name: 'connection.json', bytes: json(connection) }, { name: 'profile.json', bytes: json(connection.profile) },
    { name: 'proposals.json', bytes: json(connection.proposals) }, { name: 'catalog.json', bytes: json(connection.catalog) },
    { name: 'README.md', bytes: Buffer.from('# RLSOK local check workspace\n\nThese are your private selected inputs. Review profile.json and proposals.json. No approval, observation or robot command was generated.\n\nFrom this extracted directory with the installed CLI and ROS workspace sourced:\n\n1. `rlsok profile inspect-connection --input connection.json` checks the saved interface and example-goal configuration.\n2. Review all mappings, real units, frames, limits, selected files and intended receiver. Follow `docs/interface-onboarding.md` to create a local Shadow approval and capture a fresh read-only observation before evaluation.\n3. Evaluate only after that approval and fresh capture. This ZIP alone is not a compatibility certificate or permission to dispatch motion.\n\nThe included template.json, when present, is a versioned private fragment that can be reimported into the setup assistant. File hashes do not prove these files are active on a physical controller.\n') },
    ...[...supplied].map(([name, bytes]) => ({ name, bytes }))
  ];
  if (templateInput !== undefined) {
    const { connectionTemplateSchema } = await import('../../packages/composable-shadow/templates');
    entries.push({ name: 'template.json', bytes: json(connectionTemplateSchema.parse(templateInput)) });
  }
  return zip(entries);
}
