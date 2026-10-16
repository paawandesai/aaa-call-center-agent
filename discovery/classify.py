"""Deterministic intent labels for discovery calls, cross-checked against the clusters.

Rules were written from the cluster exemplars printed by drivers.py. Each call gets
the intent of the caller's first substantive request. Safety terms override
everything, because a safety call is never booked.
"""
import json
import re
from collections import Counter, defaultdict

from common import REDACTED_DIR, discovery_call_ids
from drivers import dedupe, load

NOISE = re.compile(r"(?i)^(sorry,? you cut out|sorry,? i'm driving|can you hear me|hello\??$)")

# (intent, driver, pattern) checked in order; first match wins.
RULES = [
    ("safety_emergency", "Safety emergency", r"smell (gas|something burning)|carbon monoxide|sparks|smoke|flames"),
    ("complaint_manager", "Complaint / escalation request", r"talk to a manager|speak to someone|nobody has called me back|was rude"),
    ("refund_request", "Billing and payments", r"refund"),
    ("billing_dispute", "Billing and payments", r"quoted me .* invoice says|not what i agreed"),
    ("duplicate_charge", "Billing and payments", r"charged twice|two .*charges"),
    ("invoice_question", "Billing and payments", r"got an invoice.*not sure"),
    ("pay_invoice", "Billing and payments", r"pay invoice|pay my (bill|invoice)"),
    ("balance_inquiry", "Billing and payments", r"current balance"),
    ("autopay_setup", "Billing and payments", r"autopay"),
    ("membership_cancel", "Membership (Comfort Club)", r"cancel my comfort club|cancel my membership"),
    ("membership_renewal", "Membership (Comfort Club)", r"membership is renewing|renew"),
    ("membership_upgrade", "Membership (Comfort Club)", r"upgrade from the"),
    ("membership_info", "Membership (Comfort Club)", r"comfort club membership actually include|how much is the maintenance plan|discount on a new system"),
    ("booking_plus_membership", "Repair / service booking", r"two things.*maintenance plan"),
    ("warranty_claim", "Warranty", r"warranty claim"),
    ("warranty_coverage", "Warranty", r"under warranty|labor warranty cover"),
    ("warranty_transfer", "Warranty", r"warranty transfer"),
    ("warranty_registration", "Warranty", r"register my new unit"),
    ("appt_reschedule", "Existing appointment", r"can i move it|reschedule"),
    ("appt_cancel", "Existing appointment", r"cancel my appointment"),
    ("appt_confirm", "Existing appointment", r"confirm i still have"),
    ("tech_late", "Existing appointment", r"my window was .* nobody"),
    ("replacement_estimate", "System replacement estimate", r"thinking about replacing"),
    ("tune_up", "Repair / service booking", r"tune-?up"),
    ("repair_booking", "Repair / service booking",
     r"book a repair|schedule a service call|get someone out|soonest you can get a tech|ac isn't cooling|thermostat is blank|furnace won't|sink is backing|water pooling|pilot light|grinding|air is warm"),
    ("commercial", "Other (redirect)", r"strip center|rooftop units|commercial"),
    ("job_inquiry", "Other (redirect)", r"hiring"),
    ("wrong_number", "Other (redirect)", r"meridian dental|wrong number"),
]
RULES = [(i, d, re.compile(p, re.I)) for i, d, p in RULES]


def first_request(body: str) -> str:
    for line in body.splitlines():
        speaker, _, said = line.partition(": ")
        if speaker == "Customer" and said.strip() and not NOISE.match(said.strip()):
            return said
    return ""


def label(body: str) -> tuple[str, str]:
    req = first_request(body)
    caller_text = " ".join(l.partition(": ")[2] for l in body.splitlines() if l.startswith("Customer: "))
    if RULES[0][2].search(caller_text):  # safety anywhere in the caller's words overrides
        return RULES[0][0], RULES[0][1]
    for intent, driver, pat in RULES[1:]:
        if pat.search(req):
            return intent, driver
    return "unlabeled", "Unlabeled"


def main() -> None:
    calls = load()
    keep, exact, near = dedupe(calls)
    labels = {cid: label(calls[cid]["body"]) for cid in keep}
    by_driver, by_intent = Counter(d for _, d in labels.values()), Counter(i for i, _ in labels.values())
    n = len(keep)
    print(f"calls after de-dup: {n} (removed exact={exact}, near={near})\n")
    print("Drivers by volume:")
    for d, c in by_driver.most_common():
        print(f"  {c:4d}  {c / n:5.1%}  {d}")
    print("\nIntents:")
    for i, c in by_intent.most_common():
        print(f"  {c:4d}  {i}")
    clusters = json.loads((REDACTED_DIR / "discovery_clusters.json").read_text())
    agree = 0
    for cl in clusters["clusters"]:
        drivers = Counter(labels[c][1] for c in cl["call_ids"] if c in labels)
        top, cnt = drivers.most_common(1)[0]
        agree += cnt
        print(f"cluster {cl['cluster']:2d} size {cl['size']:3d}: {cnt / sum(drivers.values()):.0%} {top}")
    print(f"\ncluster purity vs rule labels: {agree / n:.1%}")
    (REDACTED_DIR / "discovery_labels.json").write_text(json.dumps(labels, indent=0))


if __name__ == "__main__":
    main()
