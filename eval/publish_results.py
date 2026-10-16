"""Write web/eval-results/latest.json (read by the /evaluation page) from the committed eval summary.

Reads eval/results/containment_holdout.json and eval/holdout_labels.json. No case text is copied."""
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LABEL = {"booked": "Booked", "answered": "Answered", "handoff": "Escalated", "safety": "Safety script + escalated"}


def main() -> None:
    s = json.loads((ROOT / "eval/results/containment_holdout.json").read_text())
    labels = json.loads((ROOT / "eval/holdout_labels.json").read_text())
    expected = defaultdict(set)
    for c in labels:
        expected[c["driver"]].add(c["expected"])
    h = s["holdout"]
    order = ["booked", "answered", "handoff", "safety"]
    out = {
        "run_id": s["run_id"], "created_at": s["created_at"], "config_id": s["config_id"], "prompt_version": s["prompt_version"],
        "split": f"the September 2026 calls ({h['n']} calls)",
        "note": ("Booking cases whose zone had no openings for that service in the mock schedule are scored as correct handoffs. "
                 "Estimated model cost for the run: about $%.2f." % s["tokens"]["est_cost_usd"]),
        "containment": h["containment"], "ceiling": h["ceiling"], "target": [0.6, 0.75], "accuracy": h["accuracy"],
        "escalation": h["escalation"], "safety": h["safety"],
        "adversarial": s["adversarial"]["result"], "probes": s["adversarial"].get("probes"),
        "retrieval": s.get("retrieval"),
        "per_driver": [{**d, "expected": " or ".join(LABEL[e] for e in order if e in expected[d["driver"]])} for d in h["per_driver"]],
        "failures": h["failures"],
    }
    dest = ROOT / "web/eval-results/latest.json"
    dest.parent.mkdir(exist_ok=True)
    dest.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {dest.relative_to(ROOT)}: containment {h['containment']['k']}/{h['n']}")


if __name__ == "__main__":
    main()
