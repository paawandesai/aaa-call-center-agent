# Meridian call center agent

An AI chat agent for the inbound line of Meridian Home Comfort, a fictional HVAC and plumbing company in Austin, TX. It answers fee, hours, membership and warranty questions from the company knowledge base, books visits against the scheduling database, and hands everything else to a person with a summary. Built for the AEA FDE challenge.

- **Demo:** https://meridian-web-production-c743.up.railway.app (invite code sent with the submission; staff pages need the separate staff code)
- **Results:** 37% of held-out calls contained and correct (95% CI 28–47%), against a ceiling of 48% set by the escalation rules. Details below and on the app's `/evaluation` page.

## What is built

| Piece | Where | Notes |
|---|---|---|
| Call-driver discovery | `discovery/`, `docs/discovery.md` | Runs on redacted July–August transcripts only. |
| Retrieval | `web/lib/retrieval.ts`, `docs/retrieval.md` | Curated KB chunks, local `bge-small-en-v1.5` embeddings, pgvector. Stale and internal docs are excluded at ingest. |
| Agent | `web/lib/agent.ts`, `web/lib/policy.ts`, `web/lib/prompt.ts` | Deterministic policy routing first (safety, billing, cancellations, complaints, asks for a person, prompt injection), then Claude with four narrow tools: `search_kb`, `check_availability`, `propose_booking`, `handoff`. |
| Booking | `web/lib/scheduling.ts`, `web/app/api/bookings/confirm` | The model only proposes. The caller presses Confirm, and the server re-checks the slot and writes the booking in one transaction. A trigger blocks double-booking a technician. |
| Chat UI | `web/app/chat`, `web/components/Chat.tsx` | Streams text, shows slots, a confirm card, source chips and handoff cards. Says "Booked" only after the database write. |
| Staff console | `web/app/staff/*` | Handoff queue (claim, resolve, flag), live dashboard from metadata, review queue, evaluation page. |
| Evaluation | `eval/`, `web/scripts/run_eval.ts` | Held-out September calls, deterministic checks, Wilson intervals. |

Voice is not built.

## Results

Run `20261016T2359-6132`, prompt `agent-v2`, config `33a1a46fcd`. The test set is all 100 September 2026 calls, frozen before any analysis (`eval/holdout_manifest.txt`). Each call becomes a paraphrased, redacted opening line plus a simulated caller that answers ZIP and name questions and picks the first slot offered. Every check is code: the expected outcome from the call's driver, required facts from the current KB, forbidden stale values from the archived docs, and a check that the reply never claims a booking the database did not record. No model grades another model.

| Metric | Result | n | 95% CI |
|---|---|---|---|
| Containment (no handoff and correct) | 37% | 100 | 28–47% |
| Ceiling (calls in drivers the agent may handle) | 48% | 100 | 38–58% |
| Accuracy on handled drivers | 77% | 48 | 63–87% |
| Escalation recall (handed off when it should) | 100% | 52 | 93–100% |
| Escalation precision (handed off only when it should) | 84% | 62 | 73–91% |
| Safety calls with script and handoff | 6 of 6 | 6 | 61–100% |
| Retrieval recall@5 (dev questions, app query) | 96% | 24 | 80–99% |

The brief's 60–75% target is out of reach by design: billing (21 calls), existing appointments (12), safety (6) and other account work always go to a person, which caps containment at 48%. Booking works well (34 of 35 repair and service calls correct). Most of the remaining gap is over-escalation on membership and warranty questions: in 8 calls the agent answered the policy correctly and then handed off because the answer depended on the caller's own records, as the prompt tells it to. That rule was not changed after seeing these results, so the number above is not tuned to the holdout.

How the number moved, so nothing is hidden:

1. Run `20261016T2345-b098` (agent-v1) scored 29%. Three harness bugs caused part of that: the safety metric compared the wrong field, and the simulated caller never picked a new time after a slot was taken (concurrent cases share the mock schedule). Fixing the harness alone moved it to 37% (run `20261016T2351-8571`). Both summaries are kept in `eval/results/`.
2. Reading that run's replies showed the model sometimes wrote notes to itself before a tool call ("Need ZIP."), which callers would see. Agent-v2 turns on adaptive thinking and withdraws any text written alongside a tool call. The final run has 0 such notes in 238 replies and the same 37% containment.

### Adversarial set

`eval/adversarial/cases.json` holds 18 synthetic attacks and 6 synthetic KB probes. Final run: **18 of 18 held** (prompt leaks, persona swaps, fake admin discounts, stale-price bait, SQL and HTML injection, booking a slot that was never offered, gas leak plus "just book it", self-harm, other callers' bookings, injected instructions in a name). KB probes: 5 of 6; the agent does not find regular Saturday phone hours and hands off instead of guessing. Three regexes in this synthetic set had false negatives (for example "no discount has been applied" matched the forbidden pattern) and were fixed between runs.

## Data handling

The partner dataset (transcripts, KB, scheduling DB) is confidential and never enters this repo. Scripts read it from `MERIDIAN_DATA_DIR` and write redacted copies outside the repo.

- **Holdout:** every call dated September 2026 (100 of 420) is held out. Discovery code reads transcripts only through `discovery_call_ids()`, which refuses holdout calls. The committed `eval/holdout_labels.json` has hashed ids and labels only.
- **Redaction:** regex plus spaCy NER removes account and invoice ids, phones, emails, addresses, ZIPs, gate codes, customer and staff names (2,235 redactions, 0 leaks in the check).
- **In the app:** no caller text is logged. Events hold opaque ids, outcomes and timings, kept 30 days. Handoff records carry an AI-written summary and a redacted 300-character excerpt, purged after 7 days. The demo database resets nightly.

## Running it

```bash
cd web && npm ci
npm test                                   # 31 unit tests on in-process Postgres (PGlite)
# set the variables in ../.env.example (DATABASE_URL=pglite:memory runs an in-process database)
npm run build && npm start
npm run eval                               # full holdout + adversarial run, about $6 of model usage
python3 ../eval/publish_results.py         # copies the summary to the /evaluation page
```

Deploy: Railway, Next.js plus Postgres with pgvector. `web/railway.json` runs `npm run db:setup` before each deploy (migrations, seed, KB embeddings). Copy the seed DB and KB chunks into `web/.seed/` (gitignored) and run `railway up --no-gitignore` from `web/`.

## Known constraints

These are places where the project's guardrails override the brief, or where the demo is limited.

1. **Invite gate:** the demo needs an invite code, even though the brief asks for a freely probeable app.
2. **Containment ceiling:** account-specific requests, billing, cancellations, reschedules and complaints always escalate, so containment sits below the brief's target. The measured number is reported next to the ceiling.
3. **Booking writes:** the model never writes to the database.
4. **Mock schedule ends 2026-11-05.** After that date there are no open slots, so bookings hand off. Setting `DEMO_NOW` pins the app's clock to a date inside the schedule.
5. **Single instance:** conversations, rate limits and the spend cap live in memory, so the app runs as one replica and a restart ends open chats.
6. **Database engine:** the brief ships SQLite; the deployment uses Postgres.
7. **Repo visibility:** the repo is "internal" on Gauntlet's GitLab by the owner's decision, so it holds no raw data, KB files or database dumps.
8. **Dashboard numbers are live and unverified.** The graded numbers come only from the eval run.

## What this does not do

- No voice channel.
- No access to real accounts, invoices or existing appointments; those always go to a person.
- No automatic learning. Staff flags and reviews are proposals; nothing is promoted into the KB or prompt without a reviewed change and a new eval run.
- The live app cannot detect a stale fact in a reply; only the eval checks for stale values.
