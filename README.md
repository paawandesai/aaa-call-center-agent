# Meridian call center agent

An AI agent for a (fictional) residential HVAC and plumbing company's inbound call line. It answers routine policy questions from the company knowledge base, books appointments against the scheduling database, and hands everything else to a human with context. Built for the AEA FDE challenge.

**Status: early.** So far this repo contains only the data-handling groundwork: local redaction of call transcripts and a frozen held-out test set. Everything below is planned, not built.

## Data handling

The partner dataset (transcripts, knowledge base, scheduling DB) is confidential and never enters this repo. Scripts read it from `MERIDIAN_DATA_DIR` and write redacted copies to `MERIDIAN_REDACTED_DIR`, both outside the repo.

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-discovery.txt
cd discovery
python split_holdout.py      # once: freezes the holdout manifest (already committed)
python redact.py             # regex + spaCy NER redaction, prints counts only
python check_redaction.py    # deterministic leak check, non-zero exit on any leak
```

- **Holdout:** every call dated September 2026 (100 of 420, 23.8%) is held out for evaluation. `eval/holdout_manifest.txt` stores SHA-256 hashes of those call IDs. Discovery code reads transcripts only through `discovery_call_ids()`, which refuses holdout calls.
- **Redaction:** account and invoice IDs, phone numbers, emails, street addresses, ZIP codes and gate codes are removed by regex. Customer names are removed by a name lexicon built from the answers callers give when asked their name, plus spaCy NER. Employee names (agents and technicians) are removed from a staff list. The latest run made 2,235 redactions with 0 leaks in the check.

## Known constraints

These are places where the project's compliance guardrails override the challenge brief.

1. **Invite gate:** the demo will require an invite code, which the reviewer receives with the submission, even though the brief asks for a freely probeable app.
2. **Containment ceiling:** account-specific requests, billing disputes, cancellations (appointments and memberships) and complaints always escalate. Containment may land below the brief's 60–75% target. If it does, the measured number is reported next to the computed ceiling.
3. **Booking writes:** the model never writes to the database. It proposes a slot, the server validates it, and the booking happens after the caller confirms.
4. **Nightly reset:** the demo database resets nightly to the seed, so test bookings do not persist overnight.
5. **Database engine:** the brief ships SQLite; the deployment uses Postgres, because a file database does not persist reliably on a container host.
6. **AI usage doc:** the brief says AI usage documentation is optional; the guardrails require `AI_USAGE.md`, so it is included.
7. **Repo visibility:** the guardrails ask for a private repo. This repo is "internal" on Gauntlet's GitLab by the owner's decision, so it holds no raw data, knowledge base files or database dumps.

## What this does not do (yet)

No agent, retrieval pipeline, web app or evaluation exists yet.
