#!/usr/bin/env python3
"""
Remove duplicate grid_plots scenario folders whose names contain __expid0__.
The same hyperparameter tuple already has a canonical folder without that segment.

Also rewrites merged_planning_grid.csv scenario_slug values to match remaining folders.

Usage (from repo root):
  python3 scripts/prune_expid0_grid_plots.py
  python3 scripts/prune_expid0_grid_plots.py --dry-run
"""

from __future__ import annotations

import argparse
import csv
import os
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GRID = REPO_ROOT / "assets/website_plots/grid_plots"


def param_prefix(name: str) -> str:
    """Hyperparameter segment through ...__d<token> (before hash or __expid0__)."""
    if "__expid0__" in name:
        return name.split("__expid0__", 1)[0]
    i = name.rfind("__")
    if i == -1:
        return name
    return name[:i]


def build_expid_to_clean_map(grid_root: Path) -> dict[str, str]:
    dirs = [
        d
        for d in os.listdir(grid_root)
        if os.path.isdir(grid_root / d) and not d.startswith(".")
    ]
    by_prefix: dict[str, list[str]] = {}
    for d in dirs:
        if d == "merged_planning_grid.csv":
            continue
        by_prefix.setdefault(param_prefix(d), []).append(d)

    mapping: dict[str, str] = {}
    for d in dirs:
        if "__expid0__" not in d:
            continue
        p = param_prefix(d)
        siblings = [x for x in by_prefix.get(p, []) if "__expid0__" not in x]
        if len(siblings) != 1:
            raise SystemExit(
                f"Expected exactly one non-expid0 folder for prefix {p!r}; "
                f"got {siblings!r} (expid folder: {d})"
            )
        mapping[d] = siblings[0]
    return mapping


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--grid-root",
        type=Path,
        default=DEFAULT_GRID,
        help="Path to grid_plots directory",
    )
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    grid_root: Path = args.grid_root.resolve()
    merged = grid_root / "merged_planning_grid.csv"
    if not merged.is_file():
        print(f"Missing {merged}", file=sys.stderr)
        return 1

    mapping = build_expid_to_clean_map(grid_root)
    expid_dirs = [d for d in mapping.keys()]
    print(f"Found {len(expid_dirs)} __expid0__ folders to remove.", file=sys.stderr)
    if not expid_dirs and not args.dry_run:
        print("Nothing to prune.", file=sys.stderr)
        return 0

    for old, new in sorted(mapping.items()):
        print(f"  {old} -> {new}", file=sys.stderr)

    if args.dry_run:
        print("Dry run: no files deleted, CSV not modified.", file=sys.stderr)
        return 0

    for old in expid_dirs:
        p = grid_root / old
        if p.is_dir():
            shutil.rmtree(p)
            print(f"Removed {p}", file=sys.stderr)

    with merged.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)
    if not fieldnames or "scenario_slug" not in fieldnames:
        print("merged_planning_grid.csv: invalid header", file=sys.stderr)
        return 1

    n_repl = 0
    for row in rows:
        s = row.get("scenario_slug", "")
        if s in mapping:
            row["scenario_slug"] = mapping[s]
            n_repl += 1

    with merged.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in rows:
            w.writerow(row)

    print(f"Updated scenario_slug on {n_repl} CSV rows -> {merged}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
