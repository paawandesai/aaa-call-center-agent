"""Deterministic leak check for redacted transcripts. Prints counts only.

Fails if any token a caller gave as their name (and that is not an ordinary
lowercase word elsewhere) survives redaction, or if account/invoice IDs,
phone numbers or emails remain.
"""
import re
import sys

from common import REDACTED_DIR, TRANSCRIPTS
from redact import NAME_PROMPT


def main() -> int:
    names = set()
    for p in TRANSCRIPTS.glob("*.txt"):
        prev = ""
        for line in p.read_text().splitlines():
            speaker, _, body = line.partition(": ")
            if speaker == "Customer" and NAME_PROMPT.search(prev):
                names |= set(re.findall(r"\b[A-Z][a-z]{2,}\b", body))
            if speaker == "Agent":
                prev = body
    red = "\n".join(p.read_text() for d in ("discovery", "holdout") for p in (REDACTED_DIR / d).glob("*.txt"))
    lower = set(re.findall(r"\b[a-z]{3,}\b", red))
    leaked = [n for n in names if n.lower() not in lower and re.search(rf"\b{n}\b", red)]
    ids = len(re.findall(r"\bMHC[- ]?\d|\bINV[- ]?\d|[\w.+-]+@[\w-]+\.\w|\b\d{3}[ .-]\d{3}[ .-]\d{4}\b", red))
    print(f"name tokens checked={len(names)} leaked={len(leaked)} residual_ids={ids}")
    return 1 if leaked or ids else 0


if __name__ == "__main__":
    sys.exit(main())
