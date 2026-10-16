"""Freeze the held-out test set before any discovery work.

Holdout = every call dated September 2026 (a temporal split, so the test set
looks like calls the agent has not seen yet). Only SHA-256 hashes of call IDs
are written, so the manifest carries no partner data.
"""
import csv
import sys

from common import DATA_DIR, MANIFEST, call_hash

HOLDOUT_MONTH = "2026-09"


def main() -> None:
    if MANIFEST.exists() and "--force" not in sys.argv:
        raise SystemExit("manifest already frozen; refusing to overwrite")
    rows = list(csv.DictReader(open(DATA_DIR / "call_transcripts_index.csv")))
    held = sorted(call_hash(r["call_id"]) for r in rows if r["timestamp"].startswith(HOLDOUT_MONTH))
    MANIFEST.write_text(
        f"# Holdout manifest: SHA-256 of call_id for calls dated {HOLDOUT_MONTH}.\n"
        f"# {len(held)} of {len(rows)} calls. Frozen before discovery; do not edit.\n"
        + "\n".join(held) + "\n"
    )
    print(f"holdout={len(held)} discovery={len(rows) - len(held)} total={len(rows)} ({len(held) / len(rows):.1%} held out)")


if __name__ == "__main__":
    main()
