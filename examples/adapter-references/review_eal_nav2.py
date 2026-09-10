"""Three isolated parser/rule probes, not EAL's suite or a Nav2 run.

Usage: python review_eal_nav2.py /path/to/engineering-assurance-layer
Requires that checkout's PyYAML and Pydantic dependencies. No file is changed there.
"""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import yaml

repo = Path(sys.argv[1]).resolve()
revision = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
expected = "9701f183169ef024d908825d019c439186edc2ac"
if revision != expected:
    raise SystemExit(f"Expected reviewed EAL commit {expected}, got {revision}")
sys.path.insert(0, str(repo / "src"))
from eal.ingestion.nav2_params import parse_nav2_params
from eal.rules.nav2_coherence import check_nav2_coherence

controller = dict(plugin="dwb_core::DWBLocalPlanner", max_vel_x=0.5, min_vel_x=-0.5,
                  max_vel_theta=1.0, acc_lim_x=1.0, decel_lim_x=-1.0, acc_lim_theta=1.0)
baseline = {
    "controller_server": {"ros__parameters": {"controller_plugins": ["Slow"], "Slow": controller}},
    "velocity_smoother": {"ros__parameters": {
        "feedback": "OPEN_LOOP", "smoothing_frequency": 20.0,
        "max_velocity": [0.5, 0.0, 1.0], "min_velocity": [-0.5, 0.0, -1.0],
        "max_accel": [1.0, 0.0, 1.0], "max_decel": [-1.0, 0.0, -1.0]}},
    "local_costmap": {"local_costmap": {"ros__parameters": {"width": 4.0, "height": 4.0}}},
}

with tempfile.TemporaryDirectory(prefix="rlsok-eal-focused-") as temp:
    # Reuse one path so provenance paths cannot create artificial differences.
    source = Path(temp) / "params.yaml"
    def run(doc):
        source.write_text(yaml.safe_dump(doc, sort_keys=False), encoding="utf-8")
        parsed = parse_nav2_params(source)
        findings = check_nav2_coherence(parsed)
        return {
            "selectedPlugin": parsed.controller_plugin_key,
            "unsupported": parsed.unsupported_constructs,
            "absentSections": parsed.absent_sections,
            "uncheckedRoles": parsed.unchecked_roles,
            "findings": [{"category": f.category.value, "severity": f.severity.value,
                          "title": f.title} for f in findings],
        }

    base = run(baseline)
    semantic = copy.deepcopy(baseline)
    semantic["velocity_smoother"]["ros__parameters"].update(feedback="CLOSED_LOOP", smoothing_frequency=50.0)
    semantic_result = run(semantic)
    multiple = copy.deepcopy(baseline)
    params = multiple["controller_server"]["ros__parameters"]
    params["controller_plugins"] = ["Slow", "Fast"]
    params["Fast"] = dict(controller, max_vel_x=2.0, acc_lim_x=3.0)
    first_slow = run(multiple)
    params["controller_plugins"] = ["Fast", "Slow"]
    first_fast = run(multiple)
    nonfinite = copy.deepcopy(baseline)
    nonfinite["controller_server"]["ros__parameters"]["Slow"]["acc_lim_x"] = float("nan")
    nan_result = run(nonfinite)
    print(json.dumps({
        "sourceRepository": "https://github.com/ty-knowgic/engineering-assurance-layer",
        "sourceCommit": revision, "inputSource": "synthetic", "hardwareDispatch": "NO",
        "scope": "Three direct parser/rule probes; no CLI policy filter, full suite or ROS run",
        "baseline": base,
        "sameLimitsFeedbackFrequencyChange": {"unchangedRuleOutput": base == semantic_result, "result": semantic_result},
        "twoControllers": {"slowFirst": first_slow, "fastFirst": first_fast},
        "nonFiniteControllerAcceleration": nan_result,
    }, indent=2, allow_nan=False))
