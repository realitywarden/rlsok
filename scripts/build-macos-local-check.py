#!/usr/bin/env python3
"""Build native-CPU Mac payloads from an exact hashed Local Check payload.

This is packaging only. macOS execution and Apple signing are separate steps.
No Linux executable, installer, or GNU-only launcher is presented as a Mac build.
"""
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

ROOT = Path(__file__).resolve().parents[1]
BASELINE_VERSION = '1.5.12'
BASELINE_SOURCE = '747142754713401c0d3d022a125e3e8a661c2e82'
BASELINE_LINUX_SHA = '813239aa26ee500a2e8606a30852292db739979aec66adaa56c731b352be43bf'
NODE = {
    'x64': ('5ea50c9d6dea3dfa3abb66b2656f7a4e1c8cef23432b558d45fb538c7b5dedce', 0x01000007),
    'arm64': ('5ed4db0fcf1eaf84d91ad12462631d73bf4576c1377e192d222e48026a902640', 0x0100000c),
}

def sha(p):
    with Path(p).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def write_json(p, value):
    p.write_text(json.dumps(value, indent=2)+'\n', encoding='utf-8')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--linux-bundle', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--node-cache', required=True, type=Path)
    parser.add_argument('--arch', choices=tuple(NODE), help='Build one native CPU payload; omit to build both')
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
    args.output.mkdir(parents=True)
    args.node_cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='rlsok-macos-package-') as temporary:
        temporary = Path(temporary)
        base = temporary/'base'
        base.mkdir()
        prefix = f'rlsok-local-check-{args.version}'
        with tarfile.open(args.linux_bundle, 'r:gz') as archive:
            for member in archive:
                name = PurePosixPath(member.name)
                if name.is_absolute() or '..' in name.parts or name.parts[0] != prefix or not (member.isdir() or member.isfile()):
                    raise RuntimeError('unexpected_released_payload_member')
                target = base.joinpath(*name.parts)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.extractfile(member) as src, target.open('wb') as dst:
                        shutil.copyfileobj(src, dst)
        original = base/prefix
        if (original/'VERSION').read_text().strip()!=args.version or (original/'SOURCE_COMMIT').read_text().strip()!=args.source_commit:
            raise RuntimeError('released_source_identity_mismatch')
        assets=[]
        selected = NODE.items() if args.arch is None else [(args.arch, NODE[args.arch])]
        for arch, (digest, cpu) in selected:
            stage=temporary/f'darwin-{arch}'/prefix
            shutil.copytree(original, stage)
            node_name=f'node-v22.22.0-darwin-{arch}.tar.gz'
            node_archive=args.node_cache/node_name
            node_url=f'https://nodejs.org/dist/v22.22.0/{node_name}'
            if not node_archive.exists():
                with urllib.request.urlopen(node_url, timeout=120) as src, node_archive.open('wb') as dst:
                    shutil.copyfileobj(src,dst)
            if sha(node_archive)!=digest:
                raise RuntimeError('darwin_node_archive_checksum_mismatch')
            with tarfile.open(node_archive,'r:gz') as archive:
                for source,target in [('bin/node','bin/node'),('LICENSE','NODE-LICENSE')]:
                    member=archive.getmember(node_name.removesuffix('.tar.gz')+'/'+source)
                    if not member.isfile():raise RuntimeError('node_member_not_regular')
                    with archive.extractfile(member) as src, (stage/target).open('wb') as dst:
                        shutil.copyfileobj(src,dst)
            with (stage/'bin/node').open('rb') as f: header=f.read(8)
            if struct.unpack('<II',header)!=(0xfeedfacf,cpu):
                raise RuntimeError('darwin_node_architecture_mismatch')
            shutil.copyfile(ROOT/'packaging/macos/rlsok',stage/'bin/rlsok')
            shutil.copyfile(ROOT/'packaging/macos/build-pkg.sh',stage/'build-pkg.sh')
            shutil.copyfile(ROOT/'packaging/macos/RLSOKLocalCheck.swift',stage/'RLSOKLocalCheck.swift')
            guide = (ROOT/'packaging/macos/README.md').read_text(encoding='utf-8')
            if guide.count('__RLSOK_VERSION__') != 4:
                raise RuntimeError('macos_guide_version_tokens_invalid')
            (stage/'START-HERE.md').write_text(guide.replace('__RLSOK_VERSION__', args.version), encoding='utf-8')
            (stage/'PLATFORM').write_text(f'darwin-{arch}\n')
            manifest=json.loads((stage/'BUILD-MANIFEST.json').read_text())
            manifest.update(platform=f'darwin-{arch}',packagingSourceCommit=packaging_source,
                node={'version':'22.22.0','url':node_url,'archiveSha256':digest},
                payloadSource={'version':args.version,'commit':args.source_commit,'linuxArchiveSha256':args.linux_sha256})
            manifest['validation'].update(installedBundle='not_run_on_macos',nativeMachOArchitecture='verified',
                appleDeveloperIdSigning='not_performed',appleNotarization='not_performed')
            write_json(stage/'BUILD-MANIFEST.json',manifest)
            # The original README correctly describes the shared local-only scope.
            name=f'{prefix}-macos-{arch}.tar.gz'
            output=args.output/name
            with tarfile.open(output,'w:gz',format=tarfile.PAX_FORMAT) as archive:
                for p in [stage,*sorted(stage.rglob('*'))]:
                    if p.is_symlink():raise RuntimeError('unexpected_symlink')
                    info=archive.gettarinfo(str(p),str(PurePosixPath(prefix)/p.relative_to(stage).as_posix()))
                    info.uid=info.gid=0;info.uname=info.gname='root'
                    info.mode=0o755 if p.is_dir() or p.parent==stage/'bin' or p.name=='build-pkg.sh' else 0o644
                    if p.is_file():
                        with p.open('rb') as content:archive.addfile(info,content)
                    else:archive.addfile(info)
            assets.append({'name':name,'sizeBytes':output.stat().st_size,'sha256':sha(output),'platform':f'darwin-{arch}'})
        write_json(args.output/'macos-build.json',{'version':args.version,'sourceCommit':args.source_commit,'packagingSourceCommit':packaging_source,
            'assets':assets,'nativeInstaller':'build-pkg.sh must execute on macOS','published':False})
        (args.output/'SHA256SUMS').write_text(''.join(f'{a["sha256"]}  {a["name"]}\n' for a in assets))
        print(json.dumps(assets))

if __name__=='__main__':main()
