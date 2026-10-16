"""Call-driver discovery on the redacted discovery split (never the holdout).

1. De-duplicate: exact (normalized text) and near-duplicate (same duration and
   >= 0.97 text similarity) calls are removed before counting.
2. Build intent text from the caller's turns only, dropping greetings, filler
   and line-noise turns, so clusters reflect why people call rather than the
   agent's script.
3. Embed locally (fastembed, BAAI/bge-small-en-v1.5, MIT) and cluster with
   k-means, choosing k by silhouette. Prints cluster sizes and redacted examples.
"""
import json
import re
import sys
from difflib import SequenceMatcher

import numpy as np
from fastembed import TextEmbedding
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

from common import REDACTED_DIR, discovery_call_ids

EMBED_MODEL = "BAAI/bge-small-en-v1.5"
FILLER = re.compile(r"\b(um+|uh+|uh-huh|yeah|hi|hello|hey|so|okay|ok|oh|well|like)\b[,.]?\s*", re.I)
NOISE = re.compile(r"(?i)^(sorry,? you cut out|can you hear me|hello\?|are you there|thanks?( you)?( so much)?[.!]?|that's all.*|nope.*|no,? that('s| is) it.*|great\.?|perfect\.?|bye.*)$")


def load():
    calls = {}
    for cid in discovery_call_ids():
        text = (REDACTED_DIR / "discovery" / f"{cid}.txt").read_text()
        header, _, body = text.partition("\n\n")
        dur = re.search(r"Duration: (.*)", header)
        calls[cid] = {"body": body.strip(), "duration": dur.group(1) if dur else ""}
    return calls


def dedupe(calls):
    seen, keep, exact, near = {}, [], 0, 0
    for cid, c in calls.items():
        norm = re.sub(r"\s+", " ", c["body"].lower())
        if norm in seen:
            exact += 1
            continue
        if any(calls[k]["duration"] == c["duration"] and SequenceMatcher(None, norm, seen_norm).ratio() >= 0.97
               for seen_norm, k in ((n, seen[n]) for n in seen)):
            near += 1
            continue
        seen[norm] = cid
        keep.append(cid)
    return keep, exact, near


def intent_text(body: str, max_turns: int = 3) -> str:
    turns = []
    for line in body.splitlines():
        speaker, _, said = line.partition(": ")
        if speaker != "Customer":
            continue
        said = FILLER.sub("", said).strip(" ,.")
        if not said or NOISE.match(said) or said == "[NAME]" or re.fullmatch(r"(it's )?\[ACCOUNT_ID\]", said, re.I):
            continue
        turns.append(said)
        if len(turns) == max_turns:
            break
    return " ".join(turns)


def main() -> None:
    calls = load()
    keep, exact, near = dedupe(calls)
    print(f"discovery calls={len(calls)} exact_dups={exact} near_dups={near} kept={len(keep)}")
    texts = [intent_text(calls[c]["body"]) for c in keep]
    emb = np.array(list(TextEmbedding(EMBED_MODEL).embed(texts)))
    scores = {}
    for k in range(5, 17):
        labels = KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(emb)
        scores[k] = silhouette_score(emb, labels, metric="cosine")
    best_k = int(sys.argv[1]) if len(sys.argv) > 1 else max(scores, key=scores.get)
    print("silhouette:", {k: round(v, 3) for k, v in scores.items()}, "-> k =", best_k)
    km = KMeans(n_clusters=best_k, n_init=10, random_state=0).fit(emb)
    out = {"embed_model": EMBED_MODEL, "k": best_k, "clusters": []}
    for lab in sorted(set(km.labels_), key=lambda l: -sum(km.labels_ == l)):
        idx = np.where(km.labels_ == lab)[0]
        d = np.linalg.norm(emb[idx] - km.cluster_centers_[lab], axis=1)
        examples = [texts[i][:160] for i in idx[np.argsort(d)][:6]]
        out["clusters"].append({"cluster": int(lab), "size": int(len(idx)), "examples": examples,
                                "call_ids": [keep[i] for i in idx]})
        print(f"\n## cluster {lab}: {len(idx)} calls")
        for e in examples:
            print("  -", e)
    (REDACTED_DIR / "discovery_clusters.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
