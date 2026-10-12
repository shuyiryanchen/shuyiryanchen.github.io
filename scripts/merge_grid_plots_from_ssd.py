#!/usr/bin/env python3
"""
One-off helper: copy new optimization_results_grid scenario folders from an external
drive and append rows to assets/website_plots/grid_plots/merged_planning_grid.csv.

Only scenarios with hyperparameter tuples not already in merged_planning_grid.csv
are copied (avoids duplicate slider resolutions).

Usage:
  python3 scripts/merge_grid_plots_from_ssd.py /Volumes/RyanSSD2/optimization_results_grid
"""

from __future__ import annotations

import csv
import json
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GRID_DEST = REPO_ROOT / "assets/website_plots/grid_plots"
MERGED_PATH = GRID_DEST / "merged_planning_grid.csv"


def canonical_grid_folder_name(name: str) -> str:
    """
    Destination folder name under grid_plots/. Legacy copies used an extra __expid0__
    segment; canonical names omit it (same maps live under ...__<hash> only).
    """
    if "__expid0__" in name:
        return name.replace("__expid0__", "")
    return name


def load_existing_tuples(path: Path) -> set[tuple[float, ...]]:
    out: set[tuple[float, ...]] = set()
    with path.open(newline="") as f:
        for row in csv.DictReader(f):
            out.add(
                (
                    float(row["alpha"]),
                    float(row["B_budget_multiplier"]),
                    float(row["C_budget_multiplier"]),
                    float(row["W_cap_multiplier"]),
                    float(row["effective_alpha"]),
                    float(row["gamma_i_multiplier"]),
                    float(row["delta"]),
                )
            )
    return out


def scenario_tuple_from_folder(folder: Path) -> tuple[float, ...] | None:
    ac = folder / "all_comparison.csv"
    gs = folder / "grid_setup.json"
    if not ac.exists() or not gs.exists():
        return None
    with ac.open(newline="") as f:
        rows = list(csv.DictReader(f))
    r0 = [x for x in rows if int(float(x["exp_id"])) == 0]
    if not r0:
        return None
    x = r0[0]
    with gs.open() as f:
        g = json.load(f)
    o = g.get("optimization", {})
    return (
        float(o.get("alpha", 0.4)),
        float(x["B_budget_fraction"]),
        float(x["C_budget_fraction"]),
        float(x["W_cap_fraction"]),
        float(x["alpha_effective"]),
        float(x["gamma"]),
        float(x["delta"]),
    )


def ac_row_to_merged(
    scenario_slug: str, ac: dict[str, str], alpha: float
) -> dict[str, str]:
    slug = ac["method_slug"]
    return {
        "scenario_slug": scenario_slug,
        "exp_id": ac["exp_id"],
        "method": ac["method"],
        "method_slug": ac["method_slug"],
        "mht_method": slug,
        "alpha": str(alpha),
        "B_budget_multiplier": ac["B_budget_fraction"],
        "C_budget_multiplier": ac["C_budget_fraction"],
        "W_cap_multiplier": ac["W_cap_fraction"],
        "effective_alpha": ac["alpha_effective"],
        "gamma_i_multiplier": ac["gamma"],
        "delta": ac["delta"],
        "opt_cost": ac["worst_value"],
        "true_cost": ac["eval_cost"],
        "x_size": ac["x_sum"],
        "y_size": ac["y_sum"],
        "z_star_size": ac["z_star_sum"],
        "z_size": ac["z_sum"],
        "avg_circuit_bound_width": ac["avg_circuit_bound_width"],
        "avg_group_bound_width": ac["avg_group_bound_width"],
        "worst_value": ac["worst_value"],
        "best_lower": ac["best_lower"],
        "best_upper": ac["best_upper"],
        "gap": ac["gap"],
        "timed_out": ac["timed_out"],
        "elapsed_sec": ac["elapsed_sec"],
        "x_sum": ac["x_sum"],
        "y_sum": ac["y_sum"],
        "z_sum": ac["z_sum"],
        "z_star_sum": ac["z_star_sum"],
        "eval_cost": ac["eval_cost"],
        "W_used_fasttrip_opt": ac["W_used_fasttrip_opt"],
        "W_used_psps_opt": ac["W_used_psps_opt"],
        "B_budget": ac["B_budget"],
        "C_budget": ac["C_budget"],
        "W_cap": ac["W_cap"],
        "B_budget_fraction": ac["B_budget_fraction"],
        "C_budget_fraction": ac["C_budget_fraction"],
        "W_cap_fraction": ac["W_cap_fraction"],
        "alpha_effective": ac["alpha_effective"],
        "gamma": ac["gamma"],
        "K_groups": "5",
        "grouping_method": "grid",
        "population_psps_actual": "",
        "population_fast_trip": "",
        "population_psps": "",
    }


def main() -> int:
    ssd_root = Path(sys.argv[1] if len(sys.argv) > 1 else "/Volumes/RyanSSD2/optimization_results_grid")
    if not ssd_root.is_dir():
        print(f"Missing SSD folder: {ssd_root}", file=sys.stderr)
        return 1

    existing = load_existing_tuples(MERGED_PATH)
    new_rows: list[dict[str, str]] = []
    copied = 0

    for folder in sorted(p for p in ssd_root.iterdir() if p.is_dir() and not p.name.startswith(".")):
        tup = scenario_tuple_from_folder(folder)
        if tup is None or tup in existing:
            continue

        repo_slug = canonical_grid_folder_name(folder.name)
        dest = GRID_DEST / repo_slug
        if dest.exists():
            print(f"Skip copy (already on disk): {repo_slug}")
        else:
            shutil.copytree(folder, dest, dirs_exist_ok=False)
            copied += 1
            print(f"Copied -> {repo_slug}")

        gs = json.loads((folder / "grid_setup.json").read_text())
        alpha = float(gs.get("optimization", {}).get("alpha", 0.4))

        with (folder / "all_comparison.csv").open(newline="") as f:
            rows0 = [r for r in csv.DictReader(f) if int(float(r["exp_id"])) == 0]
        for ac in rows0:
            new_rows.append(ac_row_to_merged(repo_slug, ac, alpha))

        existing.add(tup)

    if not new_rows:
        print("No new scenarios to append.")
        return 0

    with MERGED_PATH.open(newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        old = list(reader)

    if not fieldnames:
        raise SystemExit("merged_planning_grid.csv has no header")

    with MERGED_PATH.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in old:
            w.writerow(row)
        for row in new_rows:
            w.writerow(row)

    print(f"Appended {len(new_rows)} rows to merged_planning_grid.csv ({copied} folders copied).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
