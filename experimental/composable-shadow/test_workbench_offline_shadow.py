import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from workbench_offline_shadow import (
    PROFILE,
    InstrumentedShadowAdapter,
    ProfileError,
    RuntimeBoundary,
    _digest,
    approve,
    evaluate_pair,
    prepare,
)


class WorkbenchOfflineShadowTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.artifact_temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.artifacts = Path(self.artifact_temporary.name)
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
        self.changed_demo = self.root / "demo-changed.json"
        changed_payload = json.loads(self.demo.read_text(encoding="utf-8"))
        changed_payload["artifact_revision"] = "changed-after-approval"
        self.changed_demo.write_text(json.dumps(changed_payload), encoding="utf-8")
        subprocess.run(["git", "add", "demo.json", "demo-changed.json"], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-qm", "demo"], cwd=self.root, check=True)
        self.commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root, text=True).strip()

    def tearDown(self):
        self.artifact_temporary.cleanup()
        self.temporary.cleanup()

    def runtime(self):
        adapter = InstrumentedShadowAdapter()
        controller = SimpleNamespace(_adapter=adapter)
        return RuntimeBoundary(
            controller=controller,
            adapter=adapter,
            source_commit=self.commit,
            controller_class="fixture.ExecutionController",
            controller_source="services/agent_runtime/workbench_agent_runtime/execution_controller.py",
        )

    def test_approved_baseline_then_one_digest_change_blocks_with_zero_dispatch(self):
        draft_path, changed_path, approval_path, result_path = (
            self.artifacts / name
            for name in ("draft.json", "changed.json", "approval.json", "result.json")
        )
        draft = prepare(self.root, self.commit, self.demo, draft_path)
        prepare(self.root, self.commit, self.changed_demo, changed_path)
        approval = approve(draft_path, "independent-reviewer", "2026-09-20T13:00:00Z", approval_path)
        result = evaluate_pair(
            draft_path, changed_path, approval_path, self.root, result_path,
            runtime=self.runtime(),
        )
        self.assertEqual(draft["profile"], PROFILE)
        self.assertEqual(approval["state"], "approved")
        self.assertEqual(result["submissions"][0]["decision"], "WOULD_ALLOW")
        self.assertEqual(result["submissions"][1]["decision"], "WOULD_BLOCK")
        self.assertIn("configuration_digest_mismatch", result["submissions"][1]["reasons"])
        self.assertTrue(all(value == 0 for value in result["dispatch"].values()))
        self.assertTrue(result["runtimeBoundary"]["adapterAttachedToController"])

    def test_never_approved_and_changed_draft_fail_closed(self):
        draft_path = self.artifacts / "draft.json"
        changed_path = self.artifacts / "changed.json"
        approval_path = self.artifacts / "approval.json"
        prepare(self.root, self.commit, self.demo, draft_path)
        prepare(self.root, self.commit, self.changed_demo, changed_path)
        with self.assertRaises(ProfileError):
            evaluate_pair(
                draft_path, changed_path, draft_path, self.root,
                self.artifacts / "bad.json", runtime=self.runtime(),
            )
        approve(draft_path, "independent-reviewer", "2026-09-20T13:00:00+00:00", approval_path)
        changed = json.loads(changed_path.read_text(encoding="utf-8"))
        changed["configuration"]["deviceId"] = "changed"
        changed["configurationDigest"] = _digest(changed["configuration"])
        changed_path.write_text(json.dumps(changed), encoding="utf-8")
        with self.assertRaisesRegex(ProfileError, "only_planner_artifact"):
            evaluate_pair(
                draft_path, changed_path, approval_path, self.root,
                self.artifacts / "bad.json", runtime=self.runtime(),
            )

    def test_instrumented_adapter_detects_a_boundary_call(self):
        runtime = self.runtime()
        with self.assertRaisesRegex(ProfileError, "dispatch_detected"):
            runtime.controller._adapter.dispatch(object())
        self.assertEqual(runtime.counts()["actionAdapterDispatchCalls"], 1)

    def test_dirty_or_wrong_source_is_rejected(self):
        (self.root / "tools/scripts/local_runner.py").write_text("changed\n", encoding="utf-8")
        with self.assertRaisesRegex(ProfileError, "source_checkout_dirty"):
            prepare(self.root, self.commit, self.demo, self.artifacts / "draft.json")


if __name__ == "__main__":
    unittest.main()
