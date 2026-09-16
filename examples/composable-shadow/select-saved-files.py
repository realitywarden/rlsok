#!/usr/bin/env python3
"""Write a local file selection; never import robot code or connect to devices."""
import argparse
import json
from pathlib import Path
import subprocess

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--source', required=True)
p.add_argument('--id', required=True)
p.add_argument('--file', action='append', required=True, metavar='KEY=PATH')
p.add_argument('--output', required=True)
a = p.parse_args()
source = Path(a.source).resolve(strict=True)
files = {}
for item in a.file:
    key, separator, value = item.partition('=')
    if not separator or not key or key in files:
        p.error('Each file needs a unique KEY=PATH.')
    path = Path(value)
    if path.is_symlink() or not path.is_file():
        p.error(f'{key}: select a regular, non-symlink file.')
    files[key] = str(path.resolve(strict=True))
commit = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
with Path(a.output).open('x', encoding='utf-8') as f:
    json.dump({'id': a.id, 'sourceCommit': commit, 'files': files}, f, indent=2)
    f.write('\n')
print('Selection saved. Review it before preparation. No robot code was executed.')
