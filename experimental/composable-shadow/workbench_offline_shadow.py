#!/usr/bin/env python3
"""Source-bound, zero-dispatch Shadow profile for workbench-mobile-home-robot.

This is deliberately a software/offline evidence flow.  It never imports the
customer runtime, instantiates ExecutionController, or calls
ActionAdapter.dispatch.  The tested Draft and approval are separate immutable
records so an approval for one exact digest cannot be reused after drift.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

OBSERVER_VERSION = "1"
PROFILE = "quchaosheng-workbench-offline-shadow/v1"
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
            "dispatchMode": "absent",
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
        "dispatch": {
            "actionAdapterDispatchCalls": 0,
            "goal": 0,
            "zero": 0,
            "stop": 0,
            "hold": 0,
            "cancel": 0,
            "retry": 0,
        },
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


def evaluate(draft_path: Path, approval_path: Path, output: Path) -> dict[str, Any]:
    draft = _read_json(draft_path)
    approval = _read_json(approval_path)
    if approval.get("profile") != PROFILE or approval.get("state") != "approved":
        raise ProfileError("approved_record_required")
    if approval.get("draftSha256") != _digest(draft):
        raise ProfileError("approved_draft_digest_mismatch")
    expected = draft.get("configurationDigest")
    if approval.get("approvedConfigurationDigest") != expected:
        raise ProfileError("approved_configuration_digest_mismatch")
    changed_configuration = dict(draft["configuration"])
    changed_configuration["plannerArtifactDigest"] = hashlib.sha256(
        (changed_configuration["plannerArtifactDigest"] + ":changed-after-approval").encode()
    ).hexdigest()
    observed = _digest(changed_configuration)
    if observed == expected:
        raise ProfileError("mutation_did_not_change_digest")
    result = {
        "schemaVersion": 1,
        "profile": PROFILE,
        "approvalState": "approved",
        "approvedDraftSha256": approval["draftSha256"],
        "baseline": {
            "decision": "WOULD_ALLOW",
            "expectedConfigurationDigest": expected,
            "observedConfigurationDigest": expected,
            "dispatchStatus": "SHADOW_NO_DISPATCH",
        },
        "changedAfterApproval": {
            "changedField": "configuration.plannerArtifactDigest",
            "decision": "WOULD_BLOCK",
            "reason": "configuration_digest_mismatch",
            "expectedConfigurationDigest": expected,
            "observedConfigurationDigest": observed,
            "dispatchStatus": "BLOCKED_BEFORE_DISPATCH",
        },
        "dispatch": draft["dispatch"],
        "retry": {"automatic": False, "observationAttempts": 1, "actionAttempts": 0},
        "claims": {
            "offlineSoftwareCheck": True,
            "deployment": False,
            "physicalRobot": False,
            "customerAcceptance": False,
        },
    }
    if any(result["dispatch"].values()):
        raise ProfileError("zero_dispatch_invariant_failed")
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
    evaluate_command.add_argument("--draft", type=Path, required=True)
    evaluate_command.add_argument("--approval", type=Path, required=True)
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
            value = evaluate(args.draft, args.approval, args.output)
    except (OSError, ValueError, KeyError, json.JSONDecodeError, ProfileError) as error:
        print(f"workbench_offline_shadow_failed:{error}", file=sys.stderr)
        return 2
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
