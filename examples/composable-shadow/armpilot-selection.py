#!/usr/bin/env python3
"""Write a selection for an independent saved ArmPilot review. Never launch it."""
import argparse
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', required=True, help='MeArmPilot checkout')
parser.add_argument('--kind', choices=['remote', '3d'], required=True)
parser.add_argument('--configuration', required=True, help='Selected YAML path relative to checkout')
parser.add_argument('--output', required=True, help='New selection JSON; never overwritten')
args = parser.parse_args()
source = Path(args.source).resolve(strict=True)
output = Path(args.output).resolve()
if output.exists():
    parser.error('Output already exists; choose a new filename.')

def selected(relative):
    candidate = (source / relative).resolve(strict=True)
    if not candidate.is_relative_to(source) or not candidate.is_file():
        parser.error('Each selected file must be a regular file inside the checkout.')
    return str(candidate)

commit = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
files = {'configuration': selected(args.configuration)}
if args.kind == '3d':
    prefix = 'MeArm-3D/'
    package = prefix + 'robot-package/mearm-v1/'
    for key, relative in {
        'robot_selector': prefix + 'config/robots.yaml',
        'robot_manifest': package + 'manifest.yaml',
        'robot_model': package + 'model/robot.yaml',
        'physics': package + 'physics/physics.yaml',
        'model': package + 'urdf/mearm-v1.urdf',
    }.items():
        files[key] = selected(relative)
    choice = output.with_name(output.stem + '-robot.json')
    if choice.exists():
        parser.error('Robot selection output already exists; choose a new filename.')
    files['selection'] = str(choice)
    with choice.open('x', encoding='utf-8') as f:
        json.dump({'robotId': 'mearm-v1'}, f, indent=2)
        f.write('\n')
request = {'id': 'my-armpilot-' + args.kind, 'sourceCommit': commit, 'files': files}
with output.open('x', encoding='utf-8') as f:
    json.dump(request, f, ensure_ascii=False, indent=2)
    f.write('\n')
print(f'Created {output}. Review these paths before preparing a baseline. No ArmPilot code or device was executed.')
