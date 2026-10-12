#!/usr/bin/env python3
"""
Rebuild grid_plots/ from real_experiment/outputs/optimization_results_grid:
  - merged_planning_grid.csv (control panel + filters)
  - Per-scenario folders: grid_setup.json, all_comparison.csv, exp_0_*/map.png

Usage:
  python3 scripts/sync_grid_plots_from_experiment.py \\
    --source /path/to/optimization_results_grid \\
    --dest   /path/to/assets/website_plots/grid_plots

  # After editing grid_plots/ in place, refresh Planning Tool sliders only:
  python3 scripts/sync_grid_plots_from_experiment.py --merge-only
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sys

FIELDNAMES = [
    "scenario_slug",
    "exp_id",
    "method",
    "method_slug",
    "mht_method",
    "alpha",
    "B_budget_multiplier",
    "C_budget_multiplier",
    "W_cap_multiplier",
    "effective_alpha",
    "gamma_i_multiplier",
    "delta",
    "opt_cost",
    "true_cost",
    "x_size",
    "y_size",
    "z_star_size",
    "z_size",
    "avg_circuit_bound_width",
    "avg_group_bound_width",
    "worst_value",
    "best_lower",
    "best_upper",
    "gap",
    "timed_out",
    "elapsed_sec",
    "x_sum",
    "y_sum",
    "z_sum",
    "z_star_sum",
    "eval_cost",
    "W_used_fasttrip_opt",
    "W_used_psps_opt",
    "B_budget",
    "C_budget",
    "W_cap",
    "B_budget_fraction",
    "C_budget_fraction",
    "W_cap_fraction",
    "alpha_effective",
    "gamma",
    "K_groups",
    "grouping_method",
    "population_psps_actual",
    "population_fast_trip",
    "population_psps",
]


def _num(x):
    if x is None or x == "":
        return ""
    try:
        if "." in str(x):
            return float(x)
        return int(x)
    except ValueError:
        return x


def build_merged_rows(source_root: str) -> list[dict]:
    rows: list[dict] = []
    for name in sorted(os.listdir(source_root)):
        scenario = os.path.join(source_root, name)
        if not os.path.isdir(scenario) or name.startswith("."):
            continue
        ac_path = os.path.join(scenario, "all_comparison.csv")
        gs_path = os.path.join(scenario, "grid_setup.json")
        if not os.path.isfile(ac_path) or not os.path.isfile(gs_path):
            print(f"skip (missing files): {name}", file=sys.stderr)
            continue
        with open(gs_path, encoding="utf-8") as f:
            setup = json.load(f)
        opt = setup["optimization"]
        pred = setup.get("prediction") or {}
        alpha = opt["alpha"]
        bmul = opt["B_budget"]
        cmul = opt["C_budget"]
        wmul = opt["W_cap_fraction"]
        eff = opt["alpha_effective"]
        gam = opt["gamma"]
        delta = opt["delta"]
        k_groups = pred.get("n_groups", "")

        with open(ac_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for r in reader:
                exp_id = int(float(r["exp_id"]))
                if exp_id != 0:
                    continue
                slug = r["method_slug"].strip()
                rows.append(
                    {
                        "scenario_slug": name,
                        "exp_id": exp_id,
                        "method": r["method"],
                        "method_slug": slug,
                        "mht_method": slug,
                        "alpha": alpha,
                        "B_budget_multiplier": bmul,
                        "C_budget_multiplier": cmul,
                        "W_cap_multiplier": wmul,
                        "effective_alpha": eff,
                        "gamma_i_multiplier": gam,
                        "delta": delta,
                        "opt_cost": _num(r["worst_value"]),
                        "true_cost": _num(r["eval_cost"]),
                        "x_size": _num(r["x_sum"]),
                        "y_size": _num(r["y_sum"]),
                        "z_star_size": _num(r["z_star_sum"]),
                        "z_size": _num(r["z_sum"]),
                        "avg_circuit_bound_width": _num(r.get("avg_circuit_bound_width", "")),
                        "avg_group_bound_width": _num(r.get("avg_group_bound_width", "") or ""),
                        "worst_value": _num(r["worst_value"]),
                        "best_lower": _num(r["best_lower"]),
                        "best_upper": _num(r["best_upper"]),
                        "gap": _num(r["gap"]),
                        "timed_out": r.get("timed_out", ""),
                        "elapsed_sec": _num(r["elapsed_sec"]),
                        "x_sum": _num(r["x_sum"]),
                        "y_sum": _num(r["y_sum"]),
                        "z_sum": _num(r["z_sum"]),
                        "z_star_sum": _num(r["z_star_sum"]),
                        "eval_cost": _num(r["eval_cost"]),
                        "W_used_fasttrip_opt": _num(r.get("W_used_fasttrip_opt", "")),
                        "W_used_psps_opt": _num(r.get("W_used_psps_opt", "")),
                        "B_budget": _num(r["B_budget"]),
                        "C_budget": _num(r["C_budget"]),
                        "W_cap": _num(r["W_cap"]),
                        "B_budget_fraction": _num(r["B_budget_fraction"]),
                        "C_budget_fraction": _num(r["C_budget_fraction"]),
                        "W_cap_fraction": _num(r["W_cap_fraction"]),
                        "alpha_effective": _num(r["alpha_effective"]),
                        "gamma": _num(r["gamma"]),
                        "K_groups": k_groups,
                        "grouping_method": "grid",
                        "population_psps_actual": "",
                        "population_fast_trip": "",
                        "population_psps": "",
                    }
                )
    return rows


def sync_folders(source_root: str, dest_root: str) -> None:
    """Copy each scenario folder: metadata + exp_0_* only (map.png)."""
    wanted = set()
    for name in os.listdir(source_root):
        scenario_src = os.path.join(source_root, name)
        if not os.path.isdir(scenario_src) or name.startswith("."):
            continue
        if not os.path.isfile(os.path.join(scenario_src, "all_comparison.csv")):
            continue
        wanted.add(name)
        scenario_dst = os.path.join(dest_root, name)
        os.makedirs(scenario_dst, exist_ok=True)
        for fn in ("grid_setup.json", "all_comparison.csv"):
            s, d = os.path.join(scenario_src, fn), os.path.join(scenario_dst, fn)
            if os.path.isfile(s):
                shutil.copy2(s, d)
        for entry in os.listdir(scenario_src):
            if not entry.startswith("exp_0_"):
                continue
            sub_src = os.path.join(scenario_src, entry)
            sub_dst = os.path.join(scenario_dst, entry)
            if not os.path.isdir(sub_src):
                continue
            os.makedirs(sub_dst, exist_ok=True)
            m = os.path.join(sub_src, "map.png")
            if os.path.isfile(m):
                shutil.copy2(m, os.path.join(sub_dst, "map.png"))
            for extra in ("summary.json", "solution.csv"):
                p = os.path.join(sub_src, extra)
                if os.path.isfile(p):
                    shutil.copy2(p, os.path.join(sub_dst, extra))

    # Remove scenario dirs in dest that are no longer in source
    if os.path.isdir(dest_root):
        for name in os.listdir(dest_root):
            if name in ("merged_planning_grid.csv", ".DS_Store") or name.startswith("."):
                continue
            p = os.path.join(dest_root, name)
            if os.path.isdir(p) and name not in wanted:
                shutil.rmtree(p)
                print(f"removed stale: {name}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--source",
        default="/Users/ryanchen/Downloads/real_experiment/outputs/optimization_results_grid",
    )
    ap.add_argument(
        "--dest",
        default=os.path.join(
            os.path.dirname(__file__),
            "..",
            "assets",
            "website_plots",
            "grid_plots",
        ),
    )
    ap.add_argument(
        "--merge-only",
        action="store_true",
        help=(
            "Only rebuild merged_planning_grid.csv from scenario folders already under --dest "
            "(each subfolder with grid_setup.json + all_comparison.csv). Skips copy from --source."
        ),
    )
    args = ap.parse_args()
    dest_root = os.path.abspath(args.dest)
    os.makedirs(dest_root, exist_ok=True)

    if args.merge_only:
        rows = build_merged_rows(dest_root)
        merged_path = os.path.join(dest_root, "merged_planning_grid.csv")
        with open(merged_path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
            w.writeheader()
            for row in rows:
                w.writerow({k: row.get(k, "") for k in FIELDNAMES})
        print(f"Wrote {len(rows)} rows -> {merged_path}", file=sys.stderr)
        return

    source_root = os.path.abspath(args.source)
    if not os.path.isdir(source_root):
        print(f"Missing source: {source_root}", file=sys.stderr)
        sys.exit(1)

    rows = build_merged_rows(source_root)
    merged_path = os.path.join(dest_root, "merged_planning_grid.csv")
    with open(merged_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in FIELDNAMES})

    print(f"Wrote {len(rows)} rows -> {merged_path}", file=sys.stderr)
    sync_folders(source_root, dest_root)
    print(f"Synced scenario folders -> {dest_root}", file=sys.stderr)


if __name__ == "__main__":
    main()
