# Knowledge base ingest and retrieval evaluation

_Run 2026-10-16. KB text is never committed. `kb/ingest.py` writes chunks to `$MERIDIAN_KB_OUT`, outside the repo._

## What is actually in the KB, and what we index

All 17 files have a reviewed decision in `kb/registry.py`. Ingest refuses to run if a file is unregistered.

| Decision | Files | Why |
|---|---|---|
| Indexed (9) | customer FAQ (2026-03-02), troubleshooting, membership (2026-01-01), warranty policy (2025-06-15), 2026 fee schedule PDF, 2026 price book CSV, service catalog (2026-02-10), service area (2026-04-01), holiday hours PNG | Customer-facing and current |
| Superseded (4) | `faq_old_copy.md`, `archive/comfort_club_overview.md`, `archive/warranty_terms_2023.txt`, `scheduling_guide.md` (2024-11) | Each contradicts a newer dated document: $79 vs $89 diagnostic, $149 vs $189 membership, 90-day vs 1-year repair warranty, 48h vs 24h cancellation |
| Internal (3) | `escalation_and_safety.md`, `agent_discretion_notes.md`, `technician_arrival_and_etas.md` | Agent-facing. The safety and escalation rules and "prices are not firm" are encoded as app policy, not retrieved |
| Stub (1) | `duct_cleaning.md` | Empty TODO. The service catalog's "partner referral" line covers the question |

**Formats.** The table, image and PDF rows are what naive text extraction loses or garbles:
- **PDF fee table:** 12 rows, extracted with pdfplumber.
- **Price-book CSV:** 21 rows.
- **Markdown tables:** 10 catalog rows and 6 warranty rows.
- **Holiday hours PNG:** image-only, OCR'd with Tesseract into 8 lines. It is the only source for the holiday closures and hours; the $199 holiday dispatch fee also appears in the 2026 price book CSV.

**Chunking.**
- Prose is split on headings, and every chunk carries its title and section path ("Warranty Policy > Warranty transfer").
- Tables become one chunk per row, with the column names repeated, so a price is never separated from what it prices.

This gives 86 chunks.

**Planted instructions.** A scan for instruction-like text ("ignore previous", "you are now", "AI:", ...) found none in the KB (the scan covers the indexed chunks; a manual read of the excluded files found none either). Until 2026-10-17 the pattern missed "Note to AI: ..."; it now catches it. Ingest re-runs this scan and flags any hit for review. A flagged hit is never followed.

**Conflicts inside the current documents** (not only old vs new), and how the app handles them:
- The FAQ's service-area list omits Dripping Springs and Manor, which the 2026-04 service-area doc adds; neither has a scheduling zone, so those ZIPs hand off.
- The holiday $199 dispatch fee sits next to "no after-hours fee for members"; nothing in the app resolves this, and no eval case tests it, so a member asking whether the holiday fee applies could get either answer.
- The troubleshooting doc says to reset a tripped breaker, but a burning smell with a tripped breaker is a safety case; the safety route runs before any retrieval, so the reset advice is never given for it.
- The tech doc says "4-hour blocks", but the 4–7pm window is 3 hours; the app shows windows from the scheduling database, not the doc.
- `reserved_members` slots in the scheduling database are never offered.
- The stale values the eval forbids are the diagnostic, membership, warranty and cancellation figures from the superseded files. The old FAQ's hours and "checks accepted", and the archive's "prorated refund" and "transfer to new address", are not yet in the forbidden-value checks.

## Retrieval evaluation (dev set)

There are 24 caller questions from the discovery split (`eval/retrieval_dev.json`), paraphrased, with follow-ups rewritten to stand alone. A hit means a top-k chunk comes from the gold document and contains the gold section marker.

| Retriever | hit@1 | hit@3 | hit@5 | MRR | Stale/internal doc in top 5 |
|---|---|---|---|---|---|
| Naive: all 17 files, 500-char chunks, dense | 0.62 | 0.88 | 0.88 | 0.74 | **75% of questions** |
| BM25 on curated chunks | 0.46 | 0.75 | 0.75 | 0.60 | 0% |
| **Dense (bge-small-en-v1.5) on curated chunks** | **0.75** | **0.92** | **0.96** | **0.83** | 0% |
| Hybrid RRF (BM25 + dense) | 0.75 | 0.92 | 0.92 | 0.82 | 0% |

**Takeaways:**
- The naive pipeline looks acceptable on hit rate. But for 3 in 4 questions it also hands the model a stale or internal passage, which is exactly how a bot ends up quoting $79 or a 90-day warranty.
- Curation, not the retriever, removes that risk.
- Dense retrieval wins on these short conversational questions. BM25 adds nothing, so the app uses dense top-5.
- The one dense miss is the question "Did you register my unit?", where the registration sentence sits inside the installation-warranty section. Those calls escalate anyway, because they need the caller's install record.

**Limits:**
- n=24 is small, and the 95% confidence interval on hit@5 is wide (Wilson: about 0.80–0.99).
- These 24 questions are the only retrieval measurement. `npm run eval` re-runs them against the app's pgvector retriever; there is no separate held-out retrieval set. Retrieval on September calls is measured only indirectly, through the containment eval's required facts.
