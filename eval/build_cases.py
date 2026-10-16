"""Build containment test cases from the September holdout (redacted), with deterministic gold labels.

Gold comes from rules fixed before the holdout was opened: the intent rules in discovery/classify.py
(written on the discovery split) and the handle/escalate scope in docs/discovery.md. Case text is
redacted transcript text, so the cases file is written outside the repo; only ids and labels are committed.
"""
import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "discovery"))
from common import REDACTED_DIR, call_hash, holdout_hashes  # noqa: E402
from classify import first_request, label  # noqa: E402

OUT = Path(os.environ.get("MERIDIAN_EVAL_DIR", "/mnt/project-files/data/eval"))

BOOK = {"repair_booking", "tune_up", "booking_plus_membership", "replacement_estimate", "warranty_claim"}
KB = {"membership_info", "membership_renewal", "membership_upgrade", "warranty_coverage", "warranty_transfer"}
CLOSE = {"wrong_number"}
SAFETY = {"safety_emergency"}
# Every other labeled intent escalates (billing, cancellations, existing appointments, complaints,
# warranty registration status, jobs, commercial).

# Required facts: at least one pattern must appear in the assistant's text (current KB values).
REQUIRED = {
    "membership_info": [r"\$189", r"\$16\.99", r"\$269"],
    "membership_renewal": [r"auto-?renew", r"renews? (each|every) year", r"30 days", r"enrollment (date|price)", r"locked"],
    "membership_upgrade": [r"\$80", r"prorat"],
    "warranty_coverage": [r"\b(1|one|2|two|5|five)[- ]year", r"\b(1|2|5) years?\b"],
    "warranty_transfer": [r"(do(es)?n['’]?t|do(es)? not) transfer", r"transfer form", r"\$50", r"once to"],
}
# Values from superseded documents. Seeing one in an answer fails the case.
FORBIDDEN = [r"\$79\b", r"\$12\.99", r"\$219", r"90[- ]day (labor |repair )?warranty", r"48[- ]hours?", r"10% off",
             r"1[- ]year (labor )?(install|installation)"]
FORBIDDEN_MEMBERSHIP = [r"\$149 (per|a|each) year", r"\$149/y"]
PLUMBING = r"(?i)sink|drain|water heater|leak|pipe|toilet|faucet|backing up|plumb"
ZIPS = ["78745", "78664", "78640"]  # one per zone (central, north, south), picked by case id


def expected(intent: str, req: str) -> dict:
    if intent in SAFETY:
        return {"outcome": "safety"}
    if intent in BOOK:
        if intent == "tune_up":
            services = ["hvac_tune_up"]
        elif intent == "replacement_estimate":
            services = ["estimate"]
        elif __import__("re").search(PLUMBING, req):
            services = ["plumbing"]
        else:
            services = ["hvac_repair"]
        return {"outcome": "booked", "services": services}
    if intent in KB:
        return {"outcome": "answered", "required": REQUIRED[intent]}
    if intent in CLOSE:
        return {"outcome": "answered", "required": []}
    if intent == "unlabeled":
        return {"outcome": "unknown"}
    return {"outcome": "handoff"}


def main() -> None:
    held = holdout_hashes()
    cases = []
    for p in sorted((REDACTED_DIR / "holdout").glob("*.txt")):
        cid = p.stem
        if call_hash(cid) not in held:
            raise SystemExit("holdout folder holds a non-holdout call")
        body = p.read_text()
        intent, driver = label(body)
        req = first_request(body)
        h = call_hash(cid)
        cases.append({"id": h[:10], "driver": driver, "intent": intent, "opening": req,
                      "zip": ZIPS[int(h, 16) % 3], "expected": expected(intent, req)})
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "holdout_cases.json").write_text(json.dumps({"forbidden": FORBIDDEN, "forbidden_membership": FORBIDDEN_MEMBERSHIP,
                                                       "cases": cases}, indent=1))
    # Committed: ids and labels only, no caller text.
    labels = [{k: c[k] for k in ("id", "driver", "intent", "zip")} | {"expected": c["expected"]["outcome"]} for c in cases]
    Path(__file__).resolve().parent.joinpath("holdout_labels.json").write_text(json.dumps(labels, indent=0) + "\n")
    print(len(cases), Counter(c["expected"]["outcome"] for c in cases))
    print(Counter(c["intent"] for c in cases).most_common())


if __name__ == "__main__":
    main()
