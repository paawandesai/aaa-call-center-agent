"""Shared paths and the holdout guard for discovery scripts."""
import hashlib
import os
from pathlib import Path

def _env_path(name: str) -> Path:
    """A required path from the environment (see .env.example); there is no default, because the data lives outside the repo."""
    v = os.environ.get(name)
    if not v:
        raise SystemExit(f"set {name} (see .env.example)")
    return Path(v)


DATA_DIR = _env_path("MERIDIAN_DATA_DIR")
REDACTED_DIR = _env_path("MERIDIAN_REDACTED_DIR")
TRANSCRIPTS = DATA_DIR / "call_transcripts"
MANIFEST = Path(__file__).resolve().parent.parent / "eval" / "holdout_manifest.txt"


def call_hash(call_id: str) -> str:
    return hashlib.sha256(call_id.encode()).hexdigest()


def holdout_hashes() -> set[str]:
    if not MANIFEST.exists():
        raise SystemExit("eval/holdout_manifest.txt missing: run discovery/split_holdout.py first")
    return {line.strip() for line in MANIFEST.read_text().splitlines() if line.strip() and not line.startswith("#")}


def discovery_call_ids() -> list[str]:
    """Call IDs that discovery may read. Holdout calls are refused."""
    held = holdout_hashes()
    ids = sorted(p.stem for p in TRANSCRIPTS.glob("*.txt"))
    allowed = [i for i in ids if call_hash(i) not in held]
    assert len(allowed) + len(held) == len(ids), "manifest does not match the transcript set"
    return allowed


def assert_not_holdout(call_id: str) -> None:
    if call_hash(call_id) in holdout_hashes():
        raise PermissionError(f"{call_hash(call_id)[:12]} is in the holdout set")
