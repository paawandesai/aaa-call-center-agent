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
    log = ROOT / "eval/results/holdout_invocations.jsonl"
    runs = [json.loads(line) for line in log.read_text().splitlines() if line.strip()] if log.exists() else []
    earlier = [r for r in runs if r["run_id"] != s["run_id"]]
    if earlier:
        full = [f"{r['contained']} of {r['n']} ({r['prompt_version']})" for r in earlier if r["only"] == "both" and r["limit"] is None]
        other = [r for r in earlier if not (r["only"] == "both" and r["limit"] is None)]
        text += (f" This is held-out invocation {len(earlier) + 1}. Earlier full runs: " + ", ".join(full) + "; plus "
                 f"{len(other)} partial or adversarial-only invocations (eval/results/holdout_invocations.jsonl). No run is clean: "
                 "early prompts were tuned with held-out results in view, later ones on a separate July–August dev set but still "
                 "informed by earlier held-out results; agent-v4 widened scope to verified account lookups and appointment changes, "
                 "and agent-v5 changed how the simulated caller behaves (see README).")
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
        "kept_accuracy": h.get("kept_accuracy"), "retrieval_holdout": s.get("retrieval_holdout"),
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
