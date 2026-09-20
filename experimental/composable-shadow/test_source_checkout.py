"""Focused tests for actual-checkout binding used by observer packages."""

import subprocess
import tempfile
import unittest
from pathlib import Path

from collect import CollectionError
from source_checkout import inspect_checkout


class SourceCheckoutTests(unittest.TestCase):
    def checkout(self, directory: Path) -> Path:
        root = directory / 'selected-robot-source'
        root.mkdir()
        subprocess.run(['git', 'init', '-q', str(root)], check=True)
        subprocess.run(['git', '-C', str(root), 'config', 'user.email', 'test@example.invalid'], check=True)
        subprocess.run(['git', '-C', str(root), 'config', 'user.name', 'RLSOK Test'], check=True)
        (root / 'selected.txt').write_text('selected\n', encoding='utf-8')
        subprocess.run(['git', '-C', str(root), 'add', 'selected.txt'], check=True)
        subprocess.run(['git', '-C', str(root), 'commit', '-qm', 'selected'], check=True)
        subprocess.run(
            ['git', '-C', str(root), 'remote', 'add', 'origin', 'https://example.invalid/robot.git'],
            check=True,
        )
        return root

    def test_records_actual_commit_origin_and_dirty_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.checkout(Path(directory))
            clean = inspect_checkout(root)
            self.assertRegex(clean['commit'], r'^[0-9a-f]{40}$')
            self.assertFalse(clean['dirty'])
            self.assertEqual(clean['originRemotes'], ['https://example.invalid/robot.git'])
            (root / 'untracked.txt').write_text('changed\n', encoding='utf-8')
            self.assertTrue(inspect_checkout(root)['dirty'])

    def test_rejects_subdirectory_and_missing_origin(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.checkout(Path(directory))
            child = root / 'child'
            child.mkdir()
            with self.assertRaisesRegex(CollectionError, 'checkout_root'):
                inspect_checkout(child)
            subprocess.run(['git', '-C', str(root), 'remote', 'remove', 'origin'], check=True)
            with self.assertRaisesRegex(CollectionError, 'git_read_failed'):
                inspect_checkout(root)


if __name__ == '__main__':
    unittest.main()
