#!/usr/bin/env python3
"""Package the released local checker for Windows with its own Node runtime."""
import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
import shutil
import struct
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASELINE_VERSION = '1.5.12'
BASELINE_SOURCE = '747142754713401c0d3d022a125e3e8a661c2e82'
BASELINE_LINUX_SHA = '813239aa26ee500a2e8606a30852292db739979aec66adaa56c731b352be43bf'
NODE_SHA = 'c97fa376d2becdc8863fcd3ca2dd9a83a9f3468ee7ccf7a6d076ec66a645c77a'
NODE_NAME = 'node-v22.22.0-win-x64.zip'

def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--linux-bundle', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--node-cache', type=Path, required=True)
    parser.add_argument('--version', default=BASELINE_VERSION)
    parser.add_argument('--source-commit', default=BASELINE_SOURCE)
    parser.add_argument('--linux-sha256', default=BASELINE_LINUX_SHA)
    args = parser.parse_args()
    if not re.fullmatch(r'\d+\.\d+\.\d+', args.version):
        raise SystemExit('numbered_local_check_version_required')
    if not re.fullmatch(r'[a-f0-9]{40}', args.source_commit) or not re.fullmatch(r'[a-f0-9]{64}', args.linux_sha256):
        raise SystemExit('invalid_source_commit_or_linux_checksum')
    if args.version != BASELINE_VERSION and (args.source_commit == BASELINE_SOURCE or args.linux_sha256 == BASELINE_LINUX_SHA):
        raise SystemExit('new_version_requires_new_source_and_payload_checksum')
    if sha(args.linux_bundle) != args.linux_sha256:
        raise SystemExit('released_linux_payload_checksum_mismatch')
    if args.output.exists():
        raise SystemExit('choose_a_new_output_directory')
    packaging_source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip():
        raise SystemExit('commit_packaging_source_before_building')
    args.node_cache.mkdir(parents=True, exist_ok=True)
    node_archive = args.node_cache / NODE_NAME
    node_url = f'https://nodejs.org/dist/v22.22.0/{NODE_NAME}'
    if not node_archive.exists():
        with urllib.request.urlopen(node_url, timeout=120) as src, node_archive.open('wb') as dst:
            shutil.copyfileobj(src, dst)
    if sha(node_archive) != NODE_SHA:
        raise SystemExit('windows_node_archive_checksum_mismatch')
    prefix = f'rlsok-local-check-{args.version}'
    with tempfile.TemporaryDirectory(prefix='rlsok-windows-local-check-') as temporary:
        base = Path(temporary)
        with tarfile.open(args.linux_bundle, 'r:gz') as archive:
            for member in archive:
                name = PurePosixPath(member.name)
                if name.is_absolute() or '..' in name.parts or name.parts[0] != prefix or not (member.isdir() or member.isfile()):
                    raise RuntimeError('unexpected_released_payload_member')
                if name.as_posix() in (f'{prefix}/bin/node', f'{prefix}/bin/rlsok'):
                    continue
                target = base.joinpath(*name.parts)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.extractfile(member) as src, target.open('wb') as dst:
                        shutil.copyfileobj(src, dst)
        stage = base / prefix
        if (stage/'VERSION').read_text().strip() != args.version or (stage/'SOURCE_COMMIT').read_text().strip() != args.source_commit:
            raise RuntimeError('released_source_identity_mismatch')
        with zipfile.ZipFile(node_archive) as archive:
            for source, target in [('node.exe', 'bin/node.exe'), ('LICENSE', 'NODE-LICENSE')]:
                (stage/target).write_bytes(archive.read(NODE_NAME.removesuffix('.zip')+'/'+source))
        with (stage/'bin/node.exe').open('rb') as stream:
            if stream.read(2) != b'MZ': raise RuntimeError('windows_executable_missing')
            stream.seek(0x3c)
            stream.seek(struct.unpack('<I', stream.read(4))[0])
            if stream.read(6) != b'PE\0\0\x64\x86': raise RuntimeError('windows_node_architecture_mismatch')
        templates = ROOT/'packaging/windows-local-check'
        for file in templates.iterdir():
            destination = stage/file.name if file.suffix in ('.html',) or file.name in ('Run example.cmd', 'Start setup assistant.cmd') else stage/'bin'/file.name
            shutil.copyfile(file, destination)
        guide = stage/'START-HERE.html'
        guide_text = guide.read_text(encoding='utf-8')
        if guide_text.count('__RLSOK_VERSION__') != 1:
            raise RuntimeError('windows_guide_version_token_invalid')
        guide.write_text(guide_text.replace('__RLSOK_VERSION__', args.version), encoding='utf-8')
        (stage/'START-HERE.md').write_text('# Start here\n\nOpen START-HERE.html, or double-click Start setup assistant.cmd to prepare a local check workspace for your project. No account or installation is needed. The included example remains optional.\n', encoding='utf-8')
        (stage/'PLATFORM').write_text('win32-x64\n')
        manifest = json.loads((stage/'BUILD-MANIFEST.json').read_text())
        manifest.update(platform='win32-x64', packagingSourceCommit=packaging_source,
            node={'version': '22.22.0', 'url': node_url, 'archiveSha256': NODE_SHA},
            payloadSource={'version': args.version, 'commit': args.source_commit, 'linuxArchiveSha256': args.linux_sha256})
        manifest['validation'].update(installedBundle='pending_windows_archive_execution', nativePEArchitecture='verified')
        (stage/'BUILD-MANIFEST.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
        args.output.mkdir(parents=True)
        destination = args.output/f'{prefix}-windows-x64.zip'
        with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for file in sorted(stage.rglob('*')):
                if file.is_symlink(): raise RuntimeError('unexpected_symlink')
                if file.is_file(): archive.write(file, str(PurePosixPath(prefix)/file.relative_to(stage).as_posix()))
        asset = {'name': destination.name, 'sizeBytes': destination.stat().st_size, 'sha256': sha(destination),
                 'version': args.version, 'sourceCommit': args.source_commit, 'packagingSourceCommit': packaging_source, 'published': False}
        (args.output/'windows-local-check-build.json').write_text(json.dumps(asset, indent=2)+'\n', encoding='utf-8')
        (args.output/'SHA256SUMS').write_text(f'{asset["sha256"]}  {asset["name"]}\n')
        print(json.dumps(asset))

if __name__ == '__main__':
    main()
