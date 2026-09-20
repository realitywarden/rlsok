import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from workbench_offline_shadow import PROFILE, ProfileError, approve, evaluate, prepare


class WorkbenchOfflineShadowTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        for relative in (
            "services/agent_runtime/workbench_agent_runtime/execution_controller.py",
            "services/agent_runtime/workbench_agent_runtime/policy_validator.py",
            "tools/scripts/local_runner.py",
            "docs/product/design-partner-handoff.md",
        ):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(relative + "\n", encoding="utf-8")
        readiness = self.root / "bsp/readiness.yaml"
        readiness.parent.mkdir(parents=True)
        readiness.write_text(
            "status: REPOSITORY_BASELINE_READY_PHYSICAL_BRINGUP_BLOCKED\n"
            "physical_release_ready: false\n",
            encoding="utf-8",
        )
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.email", "fixture@example.test"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.name", "Fixture"], cwd=self.root, check=True)
        subprocess.run(["git", "remote", "add", "origin", "https://github.com/example/workbench.git"], cwd=self.root, check=True)
        subprocess.run(["git", "add", "."], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-qm", "fixture"], cwd=self.root, check=True)
        self.commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root, text=True).strip()
        self.demo = self.root / "demo.json"
        self.demo.write_text(json.dumps({
            "offline": True, "provider": "template-v1", "network_access": "disabled", "model_call": None,
            "task_graph": {"task_id": "task-1", "steps": [{"action": {"action_id": "a", "action_type": "observe"}}]},
        }), encoding="utf-8")
        subprocess.run(["git", "add", "demo.json"], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-qm", "demo"], cwd=self.root, check=True)
        self.commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root, text=True).strip()

    def tearDown(self):
        self.temporary.cleanup()

    def test_approved_baseline_then_one_digest_change_blocks_with_zero_dispatch(self):
        draft_path, approval_path, result_path = (self.root / name for name in ("draft.json", "approval.json", "result.json"))
        draft = prepare(self.root, self.commit, self.demo, draft_path)
        approval = approve(draft_path, "independent-reviewer", "2026-09-20T13:00:00Z", approval_path)
        result = evaluate(draft_path, approval_path, result_path)
        self.assertEqual(draft["profile"], PROFILE)
        self.assertEqual(approval["state"], "approved")
        self.assertEqual(result["baseline"]["decision"], "WOULD_ALLOW")
        self.assertEqual(result["changedAfterApproval"]["decision"], "WOULD_BLOCK")
        self.assertEqual(result["changedAfterApproval"]["reason"], "configuration_digest_mismatch")
        self.assertTrue(all(value == 0 for value in result["dispatch"].values()))

    def test_never_approved_and_changed_draft_fail_closed(self):
        draft_path, approval_path = self.root / "draft.json", self.root / "approval.json"
        prepare(self.root, self.commit, self.demo, draft_path)
        with self.assertRaises(ProfileError):
            evaluate(draft_path, draft_path, self.root / "bad.json")
        approve(draft_path, "independent-reviewer", "2026-09-20T13:00:00+00:00", approval_path)
        draft = json.loads(draft_path.read_text(encoding="utf-8"))
        draft["configuration"]["deviceId"] = "changed"
        draft_path.write_text(json.dumps(draft), encoding="utf-8")
        with self.assertRaises(ProfileError):
            evaluate(draft_path, approval_path, self.root / "bad.json")

    def test_dirty_or_wrong_source_is_rejected(self):
        (self.root / "tools/scripts/local_runner.py").write_text("changed\n", encoding="utf-8")
        with self.assertRaisesRegex(ProfileError, "source_checkout_dirty"):
            prepare(self.root, self.commit, self.demo, self.root / "draft.json")


if __name__ == "__main__":
    unittest.main()
