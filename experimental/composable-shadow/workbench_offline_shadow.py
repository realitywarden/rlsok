#!/usr/bin/env python3
"""Source-bound, instrumented Shadow submissions for workbench-mobile-home-robot.

This is deliberately a software/offline evidence flow.  It imports the exact
customer ExecutionController and injects a measured fail-closed ActionAdapter,
then submits two independently prepared Drafts through one gate.  Shadow mode
never invokes the controller, so any adapter dispatch is both counted and a
hard failure.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import inspect
import json
import subprocess
import sys
from datetime import datetime
from dataclasses import dataclass
from pathlib import Path
from typing import Any

OBSERVER_VERSION = "2"
PROFILE = "quchaosheng-workbench-offline-shadow/v2"
BOUNDARY = "ActionAdapter.dispatch(SemanticAction)"
SELECTED_FILES = (
    "services/agent_runtime/workbench_agent_runtime/execution_controller.py",
    "services/agent_runtime/workbench_agent_runtime/policy_validator.py",
    "tools/scripts/local_runner.py",
    "bsp/readiness.yaml",
    "docs/product/design-partner-handoff.md",
)


class ProfileError(RuntimeError):
    pass


class InstrumentedShadowAdapter:
    """Measured adapter installed at the customer's real controller boundary."""

    def __init__(self) -> None:
        self.counts = {
            "actionAdapterDispatchCalls": 0,
            "goal": 0,
            "zero": 0,
            "stop": 0,
            "hold": 0,
            "cancel": 0,
            "retry": 0,
        }

    def dispatch(self, action: Any) -> Any:
        self.counts["actionAdapterDispatchCalls"] += 1
        action_type = str(getattr(action, "action_type", "")).lower()
        for key in ("goal", "zero", "stop", "hold", "cancel", "retry"):
            if key in action_type:
                self.counts[key] += 1
        raise ProfileError("shadow_adapter_dispatch_detected")

    def snapshot(self) -> dict[str, int]:
        return dict(self.counts)


@dataclass
class RuntimeBoundary:
    controller: Any
    adapter: InstrumentedShadowAdapter
    source_commit: str
    controller_class: str
    controller_source: str

    def counts(self) -> dict[str, int]:
        return self.adapter.snapshot()


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def _digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _git(root: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        capture_output=True,
        text=True,
        timeout=15,
    )
    if completed.returncode:
        raise ProfileError(f"git_failed:{args[0]}")
    return completed.stdout.strip()


def _source(root: Path, expected_commit: str) -> dict[str, Any]:
    root = root.resolve(strict=True)
    git_root = Path(_git(root, "rev-parse", "--show-toplevel")).resolve(strict=True)
    if git_root != root:
        raise ProfileError("source_root_must_be_git_root")
    commit = _git(root, "rev-parse", "HEAD").lower()
    if commit != expected_commit.lower():
        raise ProfileError(f"source_commit_mismatch:{commit}")
    dirty = _git(root, "status", "--porcelain")
    if dirty:
        raise ProfileError("source_checkout_dirty")
    origin = _git(root, "remote", "get-url", "origin")
    files: dict[str, str] = {}
    for relative in SELECTED_FILES:
        path = (root / relative).resolve(strict=True)
        if root not in path.parents or not path.is_file() or path.is_symlink():
            raise ProfileError(f"invalid_selected_file:{relative}")
        files[relative] = _file_digest(path)
    readiness = (root / "bsp/readiness.yaml").read_text(encoding="utf-8")
    if "status: REPOSITORY_BASELINE_READY_PHYSICAL_BRINGUP_BLOCKED" not in readiness:
        raise ProfileError("unexpected_readiness_status")
    if "physical_release_ready: false" not in readiness:
        raise ProfileError("physical_readiness_must_be_false")
    return {
        "commit": commit,
        "dirty": False,
        "origin": origin,
        "selectedFiles": files,
        "selectedFilesDigest": _digest(files),
    }


def _load_runtime_boundary(source_root: Path, expected_commit: str) -> RuntimeBoundary:
    source_root = source_root.resolve(strict=True)
    source = _source(source_root, expected_commit)
    import_roots = (
        source_root / "services/agent_runtime",
        source_root / "libs/contracts",
    )
    for path in reversed(import_roots):
        value = str(path)
        if value not in sys.path:
            sys.path.insert(0, value)
    module = importlib.import_module("workbench_agent_runtime.execution_controller")
    policy_module = importlib.import_module("workbench_agent_runtime.policy_validator")
    module_path = Path(inspect.getfile(module)).resolve(strict=True)
    expected_path = (source_root / SELECTED_FILES[0]).resolve(strict=True)
    if module_path != expected_path:
        raise ProfileError(f"controller_import_path_mismatch:{module_path}")
    adapter = InstrumentedShadowAdapter()
    validator = policy_module.PolicyValidator(
        policy_config={
            "policy_version": "rlsok-instrumented-shadow-v2",
            "high_impact_actions": frozenset(),
        }
    )
    controller = module.ExecutionController(policy_validator=validator, adapter=adapter)
    if getattr(controller, "_adapter", None) is not adapter:
        raise ProfileError("instrumented_adapter_not_attached")
    return RuntimeBoundary(
        controller=controller,
        adapter=adapter,
        source_commit=source["commit"],
        controller_class=f"{type(controller).__module__}.{type(controller).__qualname__}",
        controller_source=str(module_path.relative_to(source_root)).replace("\\", "/"),
    )


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ProfileError("json_object_required")
    return value


def _write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _validate_demo(value: dict[str, Any]) -> dict[str, Any]:
    if value.get("offline") is not True or value.get("network_access") != "disabled":
        raise ProfileError("demo_must_be_offline")
    if value.get("model_call") is not None:
        raise ProfileError("demo_model_call_forbidden")
    graph = value.get("task_graph")
    if not isinstance(graph, dict) or not isinstance(graph.get("steps"), list) or not graph["steps"]:
        raise ProfileError("demo_task_graph_required")
    actions = []
    for step in graph["steps"]:
        if not isinstance(step, dict) or not isinstance(step.get("action"), dict):
            raise ProfileError("demo_action_invalid")
        action = step["action"]
        actions.append({"actionId": action.get("action_id"), "actionType": action.get("action_type")})
    return {"digest": _digest(value), "taskId": graph.get("task_id"), "actions": actions}


def prepare(source_root: Path, expected_commit: str, demo_json: Path, output: Path) -> dict[str, Any]:
    source = _source(source_root, expected_commit)
    demo = _validate_demo(_read_json(demo_json))
    configuration = {
        "sourceCommit": source["commit"],
        "selectedFilesDigest": source["selectedFilesDigest"],
        "controllerIdentity": source["selectedFiles"][SELECTED_FILES[0]],
        "plannerArtifactDigest": demo["digest"],
        "dispatchBoundary": BOUNDARY,
        "deviceId": "workbench-offline-reference",
    }
    draft = {
        "schemaVersion": 1,
        "profile": PROFILE,
        "evidenceClass": "software_offline",
        "deploymentClaim": False,
        "physicalRobotClaim": False,
        "sourceTrust": "public_repository_owner_supplied_unauthenticated",
        "source": source,
        "readiness": {
            "status": "REPOSITORY_BASELINE_READY_PHYSICAL_BRINGUP_BLOCKED",
            "physicalReleaseReady": False,
        },
        "boundary": {
            "name": BOUNDARY,
            "sourcePath": SELECTED_FILES[0],
            "dispatchMode": "instrumented_shadow_adapter",
        },
        "demo": demo,
        "configuration": configuration,
        "configurationDigest": _digest(configuration),
        "checks": {
            "sourceCommit": "PASS",
            "cleanCheckout": "PASS",
            "offlinePlanner": "PASS",
            "physicalReadiness": "BLOCKED",
        },
        "approval": {"state": "tested", "approvedBy": "", "approvedAt": ""},
    }
    _write(output, draft)
    return draft


def approve(draft_path: Path, approver: str, approved_at: str, output: Path) -> dict[str, Any]:
    draft = _read_json(draft_path)
    if draft.get("profile") != PROFILE or draft.get("approval") != {
        "state": "tested", "approvedBy": "", "approvedAt": ""
    }:
        raise ProfileError("only_exact_tested_draft_can_be_approved")
    if not approver.strip():
        raise ProfileError("independent_approver_required")
    try:
        parsed = datetime.fromisoformat(approved_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise ProfileError("approved_at_invalid") from error
    if parsed.tzinfo is None:
        raise ProfileError("approved_at_timezone_required")
    approval = {
        "schemaVersion": 1,
        "profile": PROFILE,
        "state": "approved",
        "draftSha256": _digest(draft),
        "approvedConfigurationDigest": draft.get("configurationDigest"),
        "approvedBy": approver.strip(),
        "approvedAt": approved_at,
    }
    _write(output, approval)
    return approval


def _submission(
    draft: dict[str, Any],
    approval: dict[str, Any],
    runtime: RuntimeBoundary,
) -> dict[str, Any]:
    if draft.get("profile") != PROFILE:
        raise ProfileError("submission_profile_mismatch")
    configuration = draft.get("configuration")
    if not isinstance(configuration, dict):
        raise ProfileError("submission_configuration_required")
    observed = _digest(configuration)
    if draft.get("configurationDigest") != observed:
        raise ProfileError("submission_configuration_digest_invalid")
    if draft.get("source", {}).get("commit") != runtime.source_commit:
        raise ProfileError("submission_source_commit_mismatch")

    reasons = []
    if approval.get("draftSha256") != _digest(draft):
        reasons.append("approved_draft_digest_mismatch")
    expected = approval.get("approvedConfigurationDigest")
    if expected != observed:
        reasons.append("configuration_digest_mismatch")
    before = runtime.counts()
    decision = "WOULD_BLOCK" if reasons else "WOULD_ALLOW"
    # The actual customer ExecutionController owns the injected adapter.  In
    # Shadow, an allow remains a proposal and the downstream execute call is
    # deliberately not made.  A future accidental call is measured by the
    # adapter and fails closed.
    after = runtime.counts()
    return {
        "draftSha256": _digest(draft),
        "configurationDigest": observed,
        "decision": decision,
        "reasons": reasons,
        "dispatchStatus": (
            "BLOCKED_BEFORE_DISPATCH" if reasons else "SHADOW_NO_DISPATCH"
        ),
        "downstreamExecutionInvocations": 0,
        "adapterCountsBefore": before,
        "adapterCountsAfter": after,
    }


def evaluate_pair(
    baseline_draft_path: Path,
    changed_draft_path: Path,
    approval_path: Path,
    source_root: Path,
    output: Path,
    *,
    runtime: RuntimeBoundary | None = None,
) -> dict[str, Any]:
    baseline = _read_json(baseline_draft_path)
    changed = _read_json(changed_draft_path)
    approval = _read_json(approval_path)
    if baseline_draft_path.resolve() == changed_draft_path.resolve():
        raise ProfileError("two_distinct_draft_files_required")
    if approval.get("profile") != PROFILE or approval.get("state") != "approved":
        raise ProfileError("approved_record_required")
    if approval.get("draftSha256") != _digest(baseline):
        raise ProfileError("baseline_approval_binding_invalid")
    baseline_configuration = baseline.get("configuration")
    changed_configuration = changed.get("configuration")
    if not isinstance(baseline_configuration, dict) or not isinstance(changed_configuration, dict):
        raise ProfileError("submission_configuration_required")
    changed_fields = sorted(
        key
        for key in set(baseline_configuration) | set(changed_configuration)
        if baseline_configuration.get(key) != changed_configuration.get(key)
    )
    if changed_fields != ["plannerArtifactDigest"]:
        raise ProfileError("only_planner_artifact_digest_may_change")
    if _digest(baseline) == _digest(changed):
        raise ProfileError("changed_draft_must_be_distinct")

    runtime = runtime or _load_runtime_boundary(
        source_root,
        baseline.get("source", {}).get("commit", ""),
    )
    start_counts = runtime.counts()
    baseline_result = _submission(baseline, approval, runtime)
    changed_result = _submission(changed, approval, runtime)
    final_counts = runtime.counts()
    if baseline_result["decision"] != "WOULD_ALLOW":
        raise ProfileError("baseline_submission_must_allow")
    if changed_result["decision"] != "WOULD_BLOCK":
        raise ProfileError("changed_submission_must_block")
    if "configuration_digest_mismatch" not in changed_result["reasons"]:
        raise ProfileError("changed_submission_missing_configuration_block")
    if any(final_counts.values()) or start_counts != final_counts:
        raise ProfileError("zero_dispatch_invariant_failed")
    result = {
        "schemaVersion": 2,
        "profile": PROFILE,
        "approvalState": "approved",
        "approvedDraftSha256": approval["draftSha256"],
        "runtimeBoundary": {
            "controllerClass": runtime.controller_class,
            "controllerSource": runtime.controller_source,
            "adapterClass": (
                f"{type(runtime.adapter).__module__}.{type(runtime.adapter).__qualname__}"
            ),
            "adapterAttachedToController": getattr(runtime.controller, "_adapter", None)
            is runtime.adapter,
        },
        "submissions": [
            {"name": "approved-baseline", **baseline_result},
            {
                "name": "changed-draft",
                "changedFields": ["configuration.plannerArtifactDigest"],
                **changed_result,
            },
        ],
        "dispatch": final_counts,
        "retry": {"automatic": False, "observationAttempts": 2, "actionAttempts": 0},
        "claims": {
            "offlineSoftwareCheck": True,
            "deployment": False,
            "physicalRobot": False,
            "customerAcceptance": False,
        },
    }
    if not result["runtimeBoundary"]["adapterAttachedToController"]:
        raise ProfileError("instrumented_adapter_not_attached")
    _write(output, result)
    return result


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", action="version", version=OBSERVER_VERSION)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare_command = commands.add_parser("prepare")
    prepare_command.add_argument("--source-root", type=Path, required=True)
    prepare_command.add_argument("--expected-commit", required=True)
    prepare_command.add_argument("--demo-json", type=Path, required=True)
    prepare_command.add_argument("--output", type=Path, required=True)
    approve_command = commands.add_parser("approve")
    approve_command.add_argument("--draft", type=Path, required=True)
    approve_command.add_argument("--approver", required=True)
    approve_command.add_argument("--approved-at", required=True)
    approve_command.add_argument("--output", type=Path, required=True)
    evaluate_command = commands.add_parser("evaluate")
    evaluate_command.add_argument("--baseline-draft", type=Path, required=True)
    evaluate_command.add_argument("--changed-draft", type=Path, required=True)
    evaluate_command.add_argument("--approval", type=Path, required=True)
    evaluate_command.add_argument("--source-root", type=Path, required=True)
    evaluate_command.add_argument("--output", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "prepare":
            value = prepare(args.source_root, args.expected_commit, args.demo_json, args.output)
        elif args.command == "approve":
            value = approve(args.draft, args.approver, args.approved_at, args.output)
        else:
            value = evaluate_pair(
                args.baseline_draft,
                args.changed_draft,
                args.approval,
                args.source_root,
                args.output,
            )
    except (OSError, ValueError, KeyError, json.JSONDecodeError, ProfileError) as error:
        print(f"workbench_offline_shadow_failed:{error}", file=sys.stderr)
        return 2
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
