"""Write web/eval-results/latest.json (read by the /evaluation page) from the committed eval summary.

Reads eval/results/containment_holdout.json and eval/holdout_labels.json. No case text is copied."""
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LABEL = {"booked": "Booked", "answered": "Answered", "changed": "Verified and changed", "handoff": "Escalated", "safety": "Safety script + escalated"}


def note(s: dict) -> str:
    text = ("Booking cases whose zone had no openings for that service in the mock schedule are scored as correct handoffs. "
            "Estimated model cost for the run: about $%.2f." % s["tokens"]["est_cost_usd"])
    history = [(v, ROOT / f"eval/results/containment_holdout_{v}.json") for v in ("agent-v2", "agent-v3", "agent-v4")]
    earlier = [(v, json.loads(f.read_text())["holdout"]["containment"]["k"]) for v, f in history if f.exists() and v != s["prompt_version"]]
    if earlier:
        text += (" Earlier held-out runs: " + ", ".join(f"{k} of 100 ({v})" for v, k in earlier) + ". The first is the clean, untuned number. "
                 "Later runs follow changes made after seeing it, tuned on a separate July–August dev set; agent-v4 also widened scope to "
                 "verified account lookups and appointment changes, which moved those calls from 'escalate' to 'handle'; agent-v5 also changed how the simulated caller behaves (see README).")
    return text


def main() -> None:
    s = json.loads((ROOT / "eval/results/containment_holdout.json").read_text())
    labels = json.loads((ROOT / "eval/holdout_labels.json").read_text())
    expected = defaultdict(set)
    for c in labels:
        expected[c["driver"]].add(c["expected"])
    h = s["holdout"]
    order = ["booked", "answered", "changed", "handoff", "safety"]
    out = {
        "run_id": s["run_id"], "created_at": s["created_at"], "config_id": s["config_id"], "prompt_version": s["prompt_version"],
        "split": f"the September 2026 calls ({h['n']} calls)",
        "note": note(s),
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
