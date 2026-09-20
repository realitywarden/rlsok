"""Read reproducible Git checkout identity without persisting local paths."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from collect import CollectionError


def _run(root: Path, *arguments: str) -> str:
    try:
        return subprocess.run(
            ['git', '-C', str(root), *arguments],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError) as error:
        raise CollectionError('source_checkout_git_read_failed') from error


def inspect_checkout(source_root: Path) -> dict:
    root = source_root.resolve()
    top_level_text = _run(root, 'rev-parse', '--show-toplevel')
    top_level = Path(top_level_text).resolve()
    if top_level != root:
        raise CollectionError('source_root_must_be_checkout_root')
    commit = _run(root, 'rev-parse', 'HEAD')
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise CollectionError('source_checkout_commit_invalid')
    origins = [line for line in _run(root, 'remote', 'get-url', '--all', 'origin').splitlines() if line]
    if not origins:
        raise CollectionError('source_checkout_origin_missing')
    dirty = bool(_run(root, 'status', '--porcelain', '--untracked-files=normal'))
    return {
        'commit': commit,
        'dirty': dirty,
        'checkoutName': root.name,
        'originRemotes': origins,
    }
