"""Parse the knowledge base into retrieval chunks (written outside the repo).

- Markdown and text: split on headings; each chunk carries the document title
  and section path so it reads on its own.
- Markdown tables, the PDF fee table and the price-book CSV: one chunk per row,
  with the header repeated, so a row is never split from its column names.
- PNG: OCR with Tesseract.
Only files that registry.indexed() allows are emitted. A report lists every
file's decision and what table/image extraction recovered.
"""
import csv
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pdfplumber

sys.path.insert(0, str(Path(__file__).resolve().parent))
from registry import REGISTRY, indexed  # noqa: E402

def _env_path(name: str) -> Path:
    """A required path from the environment (see .env.example); there is no default, because the data lives outside the repo."""
    v = os.environ.get(name)
    if not v:
        raise SystemExit(f"set {name} (see .env.example)")
    return Path(v)


KB = _env_path("MERIDIAN_DATA_DIR") / "knowledge_base"
OUT = _env_path("MERIDIAN_KB_OUT")


def chunk_id(doc: str, n: int, text: str) -> str:
    return f"{doc}#{n}-" + hashlib.sha1(text.encode()).hexdigest()[:8]


def table_rows(header: list[str], rows: list[list[str]], context: str) -> list[str]:
    out = []
    for r in rows:
        cells = [f"{h.strip()}: {c.strip()}" for h, c in zip(header, r) if c and c.strip()]
        out.append(f"{context} | " + "; ".join(cells))
    return out


def parse_markdown(text: str, title_hint: str) -> list[tuple[str, str]]:
    """Returns (kind, text) pieces: 'text' sections and 'table_row' rows."""
    lines = text.splitlines()
    title = next((l.lstrip("# ").strip() for l in lines if l.startswith("# ")), title_hint)
    pieces, path, buf, table = [], [title], [], []

    def flush():
        body = "\n".join(l for l in buf if l.strip() and not re.match(r"^_.*_$", l.strip()))
        if body.strip():
            pieces.append(("text", f"{' > '.join(path)}\n{body.strip()}"))
        buf.clear()

    def flush_table():
        if len(table) >= 2:
            header = [c for c in table[0].strip("|").split("|")]
            rows = [[c for c in r.strip("|").split("|")] for r in table[2:]]
            pieces.extend(("table_row", t) for t in table_rows(header, rows, " > ".join(path)))
        table.clear()

    for line in lines:
        if line.startswith("|"):
            table.append(line)
            continue
        if table:
            flush_table()
        m = re.match(r"^(#{1,4}) (.*)", line)
        if m:
            flush()
            level = len(m.group(1))
            path = path[: max(level - 1, 1)] + ([m.group(2).strip()] if level > 1 else [])
            if level == 1:
                path = [m.group(2).strip()]
            continue
        buf.append(line)
    flush_table()
    flush()
    return pieces


def parse_pdf(p: Path) -> tuple[list[tuple[str, str]], dict]:
    pieces, report = [], {}
    with pdfplumber.open(p) as pdf:
        text = "\n".join(pg.extract_text() or "" for pg in pdf.pages)
        title = text.splitlines()[0].strip() + " " + text.splitlines()[1].strip()
        notes = text.split("Notes:", 1)[1].strip() if "Notes:" in text else ""
        header_line = next(l for l in text.splitlines() if l.startswith("Effective"))
        n_rows = 0
        for pg in pdf.pages:
            for t in pg.extract_tables():
                pieces.extend(("table_row", r) for r in table_rows(t[0], t[1:], title))
                n_rows += len(t) - 1
        pieces.insert(0, ("text", f"{title}\n{header_line}\nNotes: {notes}"))
    report["table_rows"] = n_rows
    return pieces, report


def parse_csv(p: Path) -> list[tuple[str, str]]:
    rows = list(csv.reader(open(p)))
    return [("table_row", r) for r in table_rows(rows[0], rows[1:], "Meridian 2026 repair price book (typical ranges; technician confirms on site)")]


def parse_png(p: Path) -> tuple[list[tuple[str, str]], dict]:
    text = subprocess.run(["tesseract", str(p), "-"], capture_output=True, text=True, check=True).stdout
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    title = lines[0].title()
    # One chunk for the whole table: eight one-line holiday chunks crowded regular-hours answers out of the top 5.
    pieces = [("ocr", f"{title} | " + "; ".join(lines[1:]))]
    return pieces, {"ocr_lines": len(lines) - 1}


INSTRUCTION_LIKE = re.compile(r"(?i)\b(ignore (all|previous)|you are now|as an ai|system prompt|ai:|assistant:|always offer|disregard|note to (the )?(ai|assistant|model|bot))")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(str(p.relative_to(KB)) for p in KB.rglob("*") if p.is_file())
    missing = [f for f in files if f not in REGISTRY]
    if missing:
        raise SystemExit(f"unregistered KB files: {missing}")
    chunks, report = [], []
    for rel in files:
        audience, status, eff, reason = REGISTRY[rel]
        entry = {"file": rel, "audience": audience, "status": status, "effective": eff, "indexed": indexed(rel), "reason": reason}
        if indexed(rel):
            p = KB / rel
            extra = {}
            if p.suffix == ".pdf":
                pieces, extra = parse_pdf(p)
            elif p.suffix == ".csv":
                pieces = parse_csv(p)
                extra = {"table_rows": len(pieces)}
            elif p.suffix == ".png":
                pieces, extra = parse_png(p)
            else:
                pieces = parse_markdown(p.read_text(), p.stem.replace("_", " "))
                extra = {"table_rows": sum(k == "table_row" for k, _ in pieces)}
            for n, (kind, text) in enumerate(pieces):
                chunks.append({"id": chunk_id(rel, n, text), "doc": rel, "kind": kind, "effective": eff, "text": text})
            entry.update(chunks=len(pieces), **extra)
        report.append(entry)
    flagged = [c["id"] for c in chunks if INSTRUCTION_LIKE.search(c["text"])]
    if flagged:
        print(f"WARNING instruction-like text in chunks (flag for review, never follow): {flagged}")
    (OUT / "chunks.json").write_text(json.dumps(chunks, indent=1))
    (OUT / "ingest_report.json").write_text(json.dumps(report, indent=1))
    print(f"files={len(files)} indexed={sum(e['indexed'] for e in report)} chunks={len(chunks)} instruction_like={len(flagged)}")
    for e in report:
        flag = "INDEX" if e["indexed"] else "skip "
        print(f"  {flag} {e['file']:45s} {e['status']:10s} {e.get('chunks', ''):>3} {e.get('table_rows', e.get('ocr_lines', '')) or ''}")


if __name__ == "__main__":
    main()
