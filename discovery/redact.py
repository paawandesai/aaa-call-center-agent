"""Local redaction of call transcripts (regex + spaCy NER). Nothing leaves the machine.

Writes redacted copies to $MERIDIAN_REDACTED_DIR/{discovery,holdout}/ and prints
counts only. Holdout files are redacted for later test-set construction but are
never printed or read by discovery scripts.
"""
import csv
import re
from collections import Counter

import spacy

from common import DATA_DIR, REDACTED_DIR, TRANSCRIPTS, call_hash, holdout_hashes

PATTERNS = [
    ("ACCOUNT_ID", re.compile(r"\bMHC[- ]?\d{4,6}\b", re.I)),
    ("INVOICE_ID", re.compile(r"\bINV[- ]?\d{3,8}\b", re.I)),
    ("EMAIL", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")),
    ("CARD", re.compile(r"\b(?:\d[ -]?){13,19}\b")),
    ("PHONE", re.compile(r"(?:\+?1[ .-]?)?\(?\b\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b")),
    ("ADDRESS", re.compile(
        r"\b\d{1,6}\s+(?:[A-Z][a-z]+\s){1,3}(?:St|Street|Ave|Avenue|Dr|Drive|Ln|Lane|Rd|Road|Blvd|Ct|Court|Way|Cir|Circle|Trl|Trail|Pkwy|Loop|Pl|Cv|Cove)\b\.?")),
    ("ZIP", re.compile(r"\b7\d{4}\b")),
    ("GATE_CODE", re.compile(r"(?i)(gate code|code is)\s*[#:]?\s*\d{3,8}")),
]
NAME_PROMPT = re.compile(r"(?i)\b(name|who am i speaking)\b")
# Company, plan and equipment brand words spaCy sometimes tags as PERSON.
KEEP = {"Meridian", "Home", "Comfort", "Club", "Plus", "Trane", "Carrier", "Lennox", "Goodman",
        "Rheem", "American", "Standard", "Nest", "Ecobee", "Honeywell"}


def agent_names() -> set[str]:
    """Call-center agents plus technicians' first names (employee names are stripped too)."""
    rows = csv.DictReader(open(DATA_DIR / "call_transcripts_index.csv"))
    staff = {r["agent"] for r in rows}
    techs = csv.DictReader(open(DATA_DIR / "scheduling_db" / "technicians.csv"))
    staff |= {t["name"].split()[0] for t in techs if not t["name"].startswith("Comfort Advisor")}
    return staff


def name_lexicon(texts: list[str]) -> set[str]:
    """Capitalized tokens callers give when asked their name, minus any token that also
    appears lowercase at least 3 times in the corpus (ordinary words such as "sure" or "can")."""
    cand, lower = set(), Counter()
    for text in texts:
        lower.update(re.findall(r"\b[a-z]{3,}\b", text))
        prev = ""
        for line in text.splitlines():
            speaker, _, body = line.partition(": ")
            if speaker == "Customer" and NAME_PROMPT.search(prev):
                cand |= set(re.findall(r"\b[A-Z][a-z]{2,}\b", body))
            if speaker == "Agent":
                prev = body
    return {w for w in cand if lower[w.lower()] < 3 and w not in KEEP}


def redact(text: str, nlp, staff: set[str], lexicon: set[str], counts: Counter) -> str:
    for label, pat in PATTERNS:
        text, n = pat.subn(f"[{label}]", text)
        counts[label] += n
    staff_re = re.compile(r"\b(" + "|".join(map(re.escape, sorted(staff))) + r")\b")
    text, n = staff_re.subn("[STAFF]", text)
    counts["STAFF"] += n
    if lexicon:
        lex_re = re.compile(r"\b(" + "|".join(map(re.escape, sorted(lexicon))) + r")\b", re.I)
        text, n = lex_re.subn("[NAME]", text)
        counts["NAME_LEXICON"] += n
    out, prev_agent = [], ""
    for line in text.splitlines():
        speaker, _, body = line.partition(": ")
        if speaker == "Customer" and NAME_PROMPT.search(prev_agent):
            out.append("Customer: [NAME]")
            counts["NAME_REPLY"] += 1
            prev_agent = ""
            continue
        if speaker in ("Agent", "Customer") and body:
            doc = nlp(body)
            for ent in reversed(doc.ents):
                if ent.label_ == "PERSON" and not set(ent.text.split()) <= KEEP and "[" not in ent.text:
                    body = body[: ent.start_char] + "[NAME]" + body[ent.end_char :]
                    counts["NAME_NER"] += 1
            line = f"{speaker}: {body}"
            if speaker == "Agent":
                prev_agent = body
        out.append(line)
    return "\n".join(out) + "\n"


def main() -> None:
    nlp = spacy.load("en_core_web_sm", disable=["parser", "lemmatizer"])
    staff = agent_names()
    held = holdout_hashes()
    counts, files = Counter(), Counter()
    for split in ("discovery", "holdout"):
        (REDACTED_DIR / split).mkdir(parents=True, exist_ok=True)
    paths = sorted(TRANSCRIPTS.glob("*.txt"))
    lexicon = name_lexicon([p.read_text() for p in paths])
    for path in paths:
        split = "holdout" if call_hash(path.stem) in held else "discovery"
        red = redact(path.read_text(), nlp, staff, lexicon, counts)
        (REDACTED_DIR / split / path.name).write_text(red)
        files[split] += 1
    print("files:", dict(files))
    print("redactions:", dict(sorted(counts.items())))


if __name__ == "__main__":
    main()
