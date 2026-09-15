#!/usr/bin/env python3
"""Select saved Pioneer-X files without ROS, SCADA or firmware execution."""
import argparse
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', required=True, help='Reviewed Pioneer-X checkout')
parser.add_argument('--settings', required=True, help='Saved tracker JSON file')
parser.add_argument('--firmware', required=True, help='Selected ESP32 firmware source file')
parser.add_argument('--output', required=True, help='New selection JSON')
args = parser.parse_args()
source = Path(args.source).resolve(strict=True)
output = Path(args.output).resolve()
if output.exists():
    parser.error('Output already exists; select a new filename.')
files = {}
for key in ('settings', 'firmware'):
    selected = Path(getattr(args, key)).resolve(strict=True)
    if not selected.is_file():
        parser.error(f'{key} must be a regular file.')
    files[key] = str(selected)
commit = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
with output.open('x', encoding='utf-8') as f:
    json.dump({'id': 'my-pioneer-x', 'sourceCommit': commit, 'files': files}, f, indent=2)
    f.write('\n')
print(f'Created {output}. Review the selected paths before preparation. No robot code was executed.')
