#!/usr/bin/env python3
"""
Copy exp_0_* only from optimization_results/ into a grid scenario folder under
assets/website_plots/grid_plots/, plus grid_setup.json and all_comparison.csv from
optimization_results_grid/<same scenario>/.

Patches all_comparison.csv rows with exp_id==0 using each exp_0_*/summary.json
and z_sum from sum(z_final) in solution.csv. Other columns (eval_cost, z_star_sum,
avg_* bounds, W_used_*) are left unchanged so evaluation-heavy fields stay consistent
with the last full grid export unless you re-run optimization_grid.py.

Then rebuild merged_planning_grid.csv via build_merged_rows (same as sync_grid_plots_from_experiment).
"""
from __future__ import annotations

import csv
import json
import os
import shutil
import sys

# Scenario slug (must match optimization_results_grid folder name)
DEFAULT_SCENARIO = "a0p4__C0p4__B0p5__W0p15__ae0p95__g0p95__d1__d9bf91aa6a"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.normpath(os.path.join(SCRIPT_DIR, ".."))


def patch_all_comparison_exp0(scenario_dir: str) -> None:
    ac_path = os.path.join(scenario_dir, "all_comparison.csv")
    if not os.path.isfile(ac_path):
        raise FileNotFoundError(ac_path)
    with open(ac_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        return
    fieldnames = list(rows[0].keys())

    for row in rows:
        if str(row.get("exp_id", "")).strip() != "0":
            continue
        slug = (row.get("method_slug") or "").strip()
        if not slug:
            continue
        sub = os.path.join(scenario_dir, f"exp_0_{slug}")
        summary_path = os.path.join(sub, "summary.json")
        sol_path = os.path.join(sub, "solution.csv")
        if not os.path.isfile(summary_path):
            print(f"warn: missing {summary_path}", file=sys.stderr)
            continue
        with open(summary_path, encoding="utf-8") as f:
            s = json.load(f)
        for key in ("worst_value", "best_lower", "best_upper", "gap", "timed_out", "elapsed_sec"):
            if key in s and key in row:
                v = s[key]
                row[key] = "" if v is None else v
        if "x_sum" in s and "x_sum" in row:
            row["x_sum"] = s["x_sum"]
        if "y_sum" in s and "y_sum" in row:
            row["y_sum"] = s["y_sum"]
        if os.path.isfile(sol_path) and "z_sum" in row:
            with open(sol_path, newline="", encoding="utf-8") as f:
                sol_rows = list(csv.DictReader(f))
            zsum = sum(int(r["z_final"]) for r in sol_rows)
            row["z_sum"] = zsum

    with open(ac_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in fieldnames})
    print(f"Patched exp_id=0 rows in {ac_path}", file=sys.stderr)


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--opt-results",
        default="/Users/ryanchen/Downloads/real_experiment/outputs/optimization_results",
        help="Flat folder containing only exp_0_* subdirs to copy",
    )
    ap.add_argument(
        "--grid-results",
        default="/Users/ryanchen/Downloads/real_experiment/outputs/optimization_results_grid",
        help="Grid run root (per-scenario folders with grid_setup + all_comparison)",
    )
    ap.add_argument(
        "--scenario",
        default=DEFAULT_SCENARIO,
        help="Scenario folder name (under grid_results and under website grid_plots)",
    )
    ap.add_argument(
        "--dest-grid",
        default=os.path.join(REPO_ROOT, "assets", "website_plots", "grid_plots"),
        help="Website grid_plots directory",
    )
    args = ap.parse_args()

    opt_root = os.path.abspath(args.opt_results)
    grid_root = os.path.abspath(args.grid_results)
    dest_root = os.path.abspath(args.dest_grid)
    scenario = args.scenario

    src_scenario = os.path.join(grid_root, scenario)
    dst_scenario = os.path.join(dest_root, scenario)

    if not os.path.isdir(src_scenario):
        print(f"Missing grid scenario: {src_scenario}", file=sys.stderr)
        sys.exit(1)
    if not os.path.isdir(opt_root):
        print(f"Missing optimization_results: {opt_root}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(dst_scenario, exist_ok=True)

    for fn in ("grid_setup.json", "all_comparison.csv"):
        s, d = os.path.join(src_scenario, fn), os.path.join(dst_scenario, fn)
        if not os.path.isfile(s):
            print(f"Missing {s}", file=sys.stderr)
            sys.exit(1)
        shutil.copy2(s, d)
        print(f"Copied {fn}", file=sys.stderr)

    for name in sorted(os.listdir(opt_root)):
        if not name.startswith("exp_0_"):
            continue
        src_sub = os.path.join(opt_root, name)
        if not os.path.isdir(src_sub):
            continue
        dst_sub = os.path.join(dst_scenario, name)
        if os.path.isdir(dst_sub):
            shutil.rmtree(dst_sub)
        shutil.copytree(src_sub, dst_sub)
        print(f"Copied {name}/", file=sys.stderr)

    patch_all_comparison_exp0(dst_scenario)

    # Rebuild merged_planning_grid.csv
    sys.path.insert(0, SCRIPT_DIR)
    from sync_grid_plots_from_experiment import FIELDNAMES, build_merged_rows

    rows = build_merged_rows(dest_root)
    merged_path = os.path.join(dest_root, "merged_planning_grid.csv")
    with open(merged_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in FIELDNAMES})
    print(f"Wrote {len(rows)} rows -> {merged_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
