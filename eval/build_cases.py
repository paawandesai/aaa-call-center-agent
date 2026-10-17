"""Build containment test cases with deterministic gold labels.

`python build_cases.py` builds the September holdout. `python build_cases.py dev` builds a 100-call
tuning set from the July-August discovery calls, sampled per driver in proportion (by call hash, so
it is stable). Tune on dev; run the holdout once per reported result.

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
from common import REDACTED_DIR, assert_not_holdout, call_hash, holdout_hashes  # noqa: E402
from classify import first_request, label  # noqa: E402

OUT = Path(os.environ.get("MERIDIAN_EVAL_DIR", "/mnt/project-files/data/eval"))

BOOK = {"repair_booking", "tune_up", "booking_plus_membership", "replacement_estimate", "warranty_claim"}
KB = {"membership_info", "membership_renewal", "membership_upgrade", "warranty_coverage", "warranty_transfer"}
CLOSE = {"wrong_number"}
# Scope change (2026-10-17): a verified caller's own records and appointment changes are handled by the agent.
# The eval assigns each of these cases a customer from the mock DB at run time (transcripts don't map to DB records).
ACCOUNT = {"balance_inquiry": "balance", "invoice_question": "invoice", "appt_confirm": "appointment"}
CHANGE = {"appt_reschedule": "reschedule", "appt_cancel": "cancel"}
SAFETY = {"safety_emergency"}
# Every other labeled intent escalates (payments, disputes, refunds, autopay, membership cancellations, late
# technicians, complaints, warranty registration status, jobs, commercial).

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
    if intent in ACCOUNT:
        return {"outcome": "answered", "account": ACCOUNT[intent]}
    if intent in CHANGE:
        return {"outcome": "changed", "action": CHANGE[intent]}
    if intent in CLOSE:
        return {"outcome": "answered", "required": []}
    if intent == "unlabeled":
        return {"outcome": "unknown"}
    return {"outcome": "handoff"}


def build(path: Path) -> dict:
    body = path.read_text()
    intent, driver = label(body)
    req = first_request(body)
    h = call_hash(path.stem)
    return {"id": h[:10], "driver": driver, "intent": intent, "opening": req,
            "zip": ZIPS[int(h, 16) % 3], "expected": expected(intent, req)}


def sample_dev(cases: list[dict], n: int = 100) -> list[dict]:
    by = {}
    for c in sorted(cases, key=lambda c: c["id"]):
        by.setdefault(c["driver"], []).append(c)
    quota = {d: max(1, round(n * len(cs) / len(cases))) for d, cs in by.items()}
    while sum(quota.values()) > n:
        quota[max(quota, key=quota.get)] -= 1
    while sum(quota.values()) < n:
        quota[max(quota, key=lambda d: len(by[d]) - quota[d])] += 1
    return [c for d, cs in by.items() for c in cs[:quota[d]]]


def main() -> None:
    split = sys.argv[1] if len(sys.argv) > 1 else "holdout"
    held = holdout_hashes()
    cases = []
    for p in sorted((REDACTED_DIR / ("holdout" if split == "holdout" else "discovery")).glob("*.txt")):
        if split == "holdout" and call_hash(p.stem) not in held:
            raise SystemExit("holdout folder holds a non-holdout call")
        if split == "dev":
            assert_not_holdout(p.stem)
        cases.append(build(p))
    if split == "dev":
        known = [c for c in cases if c["expected"]["outcome"] != "unknown"]
        cases = sample_dev(known)
        # The stratified sample has almost no account cases, so every discovery call in those intents is added.
        have = {c["id"] for c in cases}
        cases += [c for c in known if (c["intent"] in ACCOUNT or c["intent"] in CHANGE) and c["id"] not in have]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{split}_cases.json").write_text(json.dumps({"forbidden": FORBIDDEN, "forbidden_membership": FORBIDDEN_MEMBERSHIP,
                                                         "cases": cases}, indent=1))
    # Committed: ids and labels only, no caller text.
    labels = [{k: c[k] for k in ("id", "driver", "intent", "zip")} | {"expected": c["expected"]["outcome"]} for c in cases]
    Path(__file__).resolve().parent.joinpath(f"{split}_labels.json").write_text(json.dumps(labels, indent=0) + "\n")
    print(split, len(cases), Counter(c["expected"]["outcome"] for c in cases))
    print(Counter(c["driver"] for c in cases).most_common())


if __name__ == "__main__":
    main()
