"""Offline retrieval evaluation: compare retrievers before trusting answers.

Runs each question in an eval file against:
  - naive:  every KB file (stale and internal included), fixed 500-char chunks, dense
  - bm25:   curated chunks (kb/ingest.py), keyword BM25
  - dense:  curated chunks, bge-small-en-v1.5 embeddings
  - hybrid: curated chunks, reciprocal-rank fusion of bm25 + dense
Reports hit@1/3/5, MRR, and how often a stale or internal document appears in
the top 5. A hit is a retrieved chunk from a gold doc containing the gold marker.
"""
import json
import math
import os
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pdfplumber
from fastembed import TextEmbedding

sys.path.insert(0, str(Path(__file__).resolve().parent))
from registry import REGISTRY  # noqa: E402

def _env_path(name: str) -> Path:
    """A required path from the environment (see .env.example); there is no default, because the data lives outside the repo."""
    v = os.environ.get(name)
    if not v:
        raise SystemExit(f"set {name} (see .env.example)")
    return Path(v)


KB = _env_path("MERIDIAN_DATA_DIR") / "knowledge_base"
OUT = _env_path("MERIDIAN_KB_OUT")
EMBED_MODEL = "BAAI/bge-small-en-v1.5"  # fastembed fetches its default revision (not pinned); offline comparison only. The app pins its weights in web/lib/config.ts.
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
TOKEN = re.compile(r"[a-z0-9$%]+")
STOP = set("a an the is are am i my me you your we our to of for on in and or it its do does did can how what when much that this be with at there have has".split())


def tokens(text: str) -> list[str]:
    return [t for t in TOKEN.findall(text.lower()) if t not in STOP]


class BM25:
    def __init__(self, docs: list[str], k1: float = 1.4, b: float = 0.75):
        self.docs = [tokens(d) for d in docs]
        self.avg = sum(map(len, self.docs)) / len(self.docs)
        self.df = Counter(t for d in self.docs for t in set(d))
        self.n, self.k1, self.b = len(docs), k1, b

    def scores(self, q: str) -> np.ndarray:
        out = np.zeros(self.n)
        for t in tokens(q):
            if t not in self.df:
                continue
            idf = math.log(1 + (self.n - self.df[t] + 0.5) / (self.df[t] + 0.5))
            for i, d in enumerate(self.docs):
                f = d.count(t)
                if f:
                    out[i] += idf * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * len(d) / self.avg))
        return out


def naive_chunks() -> list[dict]:
    chunks = []
    for p in sorted(KB.rglob("*")):
        rel = str(p.relative_to(KB))
        if p.is_dir() or p.suffix == ".png":
            continue  # naive text extraction cannot read the image
        text = "\n".join(pg.extract_text() or "" for pg in pdfplumber.open(p).pages) if p.suffix == ".pdf" else p.read_text()
        for i in range(0, len(text), 500):
            chunks.append({"doc": rel, "text": text[i:i + 500]})
    return chunks


def is_hit(chunk: dict, gold: list[list[str]]) -> bool:
    return any(chunk["doc"] == doc and marker.lower() in chunk["text"].lower() for doc, marker in gold)


def evaluate(name, chunks, rank_fn, items):
    hits, rr, stale = Counter(), [], 0
    misses = []
    for it in items:
        order = rank_fn(it["q"])
        first = next((r for r, i in enumerate(order[:5]) if is_hit(chunks[i], it["gold"])), None)
        for k in (1, 3, 5):
            hits[k] += first is not None and first < k
        rr.append(0 if first is None else 1 / (first + 1))
        stale += any(REGISTRY[chunks[i]["doc"]][1] != "current" or REGISTRY[chunks[i]["doc"]][0] != "customer" for i in order[:5])
        if first is None:
            misses.append(it["id"])
    n = len(items)
    return {"retriever": name, "n": n, "hit@1": hits[1] / n, "hit@3": hits[3] / n, "hit@5": hits[5] / n,
            "mrr": sum(rr) / n, "stale_or_internal_in_top5": stale / n, "misses@5": misses}


def main() -> None:
    eval_file = Path(sys.argv[1] if len(sys.argv) > 1 else "eval/retrieval_dev.json")
    items = json.loads(eval_file.read_text())["items"]
    model = TextEmbedding(EMBED_MODEL)
    embed = lambda texts: np.array(list(model.embed(texts)))
    qv = embed([QUERY_PREFIX + it["q"] for it in items])
    qidx = {it["q"]: i for i, it in enumerate(items)}

    curated = json.loads((OUT / "chunks.json").read_text())
    cv = embed([c["text"] for c in curated])
    bm = BM25([c["text"] for c in curated])
    naive = naive_chunks()
    nv = embed([c["text"] for c in naive])

    dense_rank = lambda vecs: (lambda q: list(np.argsort(-(vecs @ qv[qidx[q]]))))
    bm25_rank = lambda q: list(np.argsort(-bm.scores(q)))

    def hybrid_rank(q, k=60):
        fused = Counter()
        for order in (bm25_rank(q), dense_rank(cv)(q)):
            for r, i in enumerate(order[:20]):
                fused[i] += 1 / (k + r + 1)
        return [i for i, _ in fused.most_common()]

    results = [
        evaluate("naive (all files, 500-char, dense)", naive, dense_rank(nv), items),
        evaluate("bm25 (curated)", curated, bm25_rank, items),
        evaluate("dense (curated)", curated, dense_rank(cv), items),
        evaluate("hybrid rrf (curated)", curated, hybrid_rank, items),
    ]
    for r in results:
        print(f"{r['retriever']:38s} n={r['n']} hit@1={r['hit@1']:.2f} hit@3={r['hit@3']:.2f} hit@5={r['hit@5']:.2f} "
              f"mrr={r['mrr']:.2f} stale/internal@5={r['stale_or_internal_in_top5']:.2f} misses={r['misses@5']}")
    out = Path("eval/results") / f"retrieval_{eval_file.stem}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"embed_model": EMBED_MODEL, "results": results}, indent=1) + "\n")


if __name__ == "__main__":
    main()
