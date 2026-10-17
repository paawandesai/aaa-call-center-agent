# Meridian call center agent

An AI chat agent for the inbound line of Meridian Home Comfort, a fictional HVAC and plumbing company in Austin, TX. It answers fee, hours, membership and warranty questions from the company knowledge base, books visits against the scheduling database, and hands everything else to a person with a summary. Built for the AEA FDE challenge.

- **Demo:** https://meridian-web-production-c743.up.railway.app (invite code sent with the submission; staff pages need the separate staff code)
- **Results:** 45% of held-out calls contained and correct (95% CI 36–55%), against a ceiling of 48% set by the escalation rules. The first, untuned run scored 37%; the 45% comes after changes made once that result was known, tuned on a separate dev set and checked on the held-out set once. Details below and on the app's `/evaluation` page.

## What is built

| Piece | Where | Notes |
|---|---|---|
| Call-driver discovery | `discovery/`, `docs/discovery.md` | Runs on redacted July–August transcripts only. |
| Retrieval | `web/lib/retrieval.ts`, `docs/retrieval.md` | Curated KB chunks, local `bge-small-en-v1.5` embeddings, pgvector. Stale and internal docs are excluded at ingest. |
| Agent | `web/lib/agent.ts`, `web/lib/policy.ts`, `web/lib/prompt.ts` | Deterministic policy routing first (safety, billing, cancellations, complaints, asks for a person, unclear service-area ZIPs, prompt injection), then Claude (Haiku 5.5 by default, `AGENT_MODEL`) with four narrow tools: `search_kb`, `check_availability`, `propose_booking`, `handoff`. |
| Booking | `web/lib/scheduling.ts`, `web/app/api/bookings/confirm` | The model only proposes. The caller presses Confirm, and the server re-checks the slot and writes the booking in one transaction. A trigger blocks double-booking a technician. |
| Chat UI | `web/app/chat`, `web/components/Chat.tsx` | Streams text, shows slots, a confirm card, source chips and handoff cards. Says "Booked" only after the database write. |
| Staff console | `web/app/staff/*` | Handoff queue (claim, resolve, flag), live dashboard from metadata, review queue, evaluation page. |
| Evaluation | `eval/`, `web/scripts/run_eval.ts` | Held-out September calls, deterministic checks, Wilson intervals. |

Voice is not built.

## Results

Final run `20261017T1639-27cc`, prompt `agent-v3`, model Haiku 5.5, config `c55f6244bb`. The test set is all 100 September 2026 calls, frozen before any analysis (`eval/holdout_manifest.txt`). Each call becomes a paraphrased, redacted opening line plus a simulated caller that answers ZIP and name questions and picks the first slot offered. Every check is code: the expected outcome from the call's driver, required facts from the current KB, forbidden stale values from the archived docs, and a check that the reply never claims a booking the database did not record. No model grades another model.

| Metric | First run (agent-v2, Opus) | Final run (agent-v3, Haiku) | n | 95% CI (final) |
|---|---|---|---|---|
| Containment (no handoff and correct) | 37% | **45%** | 100 | 36–55% |
| Ceiling (calls in drivers the agent may handle) | 48% | 48% | 100 | 38–58% |
| Accuracy on handled drivers | 77% | 94% (45/48) | 48 | 83–98% |
| Escalation recall (handed off when it should) | 100% (52/52) | 96% (50/52) | 52 | 87–99% |
| Escalation precision (handed off only when it should) | 84% | 100% (50/50) | 50 | 93–100% |
| Safety calls with script and handoff | 6 of 6 | 6 of 6 | 6 | 61–100% |
| Adversarial attacks held / KB probes | 18/18, 5/6 | 18/18, 6/6 | 18 / 6 | |
| Model cost of the 100-call run (est.) | about $5.85 | about $0.04 | | |

**Read the 45% with this caveat.** The changes behind it were made after we had seen the first held-out result. To keep the number honest, all tuning happened on a separate dev set (100 July–August discovery calls, stratified by driver, labels in `eval/dev_labels.json`), and the held-out set was run once with the finished config. The 37% is the clean, untuned number.

The brief's 60–75% target is out of reach by design: billing (21 calls), existing appointments (12), safety (6) and other account work always go to a person, which caps containment at 48%. The final run sits 3 points under that ceiling.

What is still wrong in the final run (5 calls): two warranty questions ended in a booked repair visit instead of just an answer, one repair was booked as the wrong service, and **two calls that should have gone to a person were answered instead** (a replacement estimate and a billing question). Recall dropped from 52/52 to 50/52 with the move to Haiku; on the dev set every model held 52/52 after the policy changes, so this showed up only on the held-out set and was not tuned away.

### What changed between the two runs

All measured on the dev set first (`eval/results/dev_runs/`):

1. **Prompt agent-v3.** Answer how membership and warranty policies work from the documents instead of handing off; offer a person only when the caller's own records matter; book a visit only when the caller asks for one or accepts an offer.
2. **Deterministic routes** for paying an invoice, asking whether a unit was registered, and ZIPs the service-area documents disagree on (Lakeway, Dripping Springs, Manor). These go to a person before any model call.
3. **Cost.** Prompt caching on the whole conversation (not just the system prompt), skipping retrieval on turns that are only a ZIP, a name or a slot pick, and a cheaper model.
4. **Model comparison on dev** (agent-v3 with the policy routes): Opus 5.5 39 contained, $1.36 per 100 calls, 17/18 attacks; Sonnet 5.5 36, $0.76, 18/18; Haiku 5.5 38, $0.04, 17/18, then 38 and 37 with 18/18 on two repeats after the ZIP route. Haiku matched the larger models within noise at about 3% of Opus's cost, so it is the default. `AGENT_MODEL` switches back.
5. **Retrieval.** The holiday-hours image is now one chunk, which fixed the Saturday-hours probe.

Earlier history: run `20261016T2345-b098` (agent-v1) scored 29% because of three harness bugs (the safety metric compared the wrong field, and the simulated caller never picked a new time after a slot was taken). Fixing the harness moved it to 37% (run `20261016T2351-8571`). Agent-v2 turned on adaptive thinking and withdraws text written alongside a tool call, so callers never see the model's notes to itself; it kept 37%. Agent-v3 also drops a short opening line that reads as a note to self. All summaries are kept in `eval/results/` (`containment_holdout_agent-v2.json` is the first run).

### Adversarial set

`eval/adversarial/cases.json` holds 18 synthetic attacks and 6 synthetic KB probes. Final run: **18 of 18 held** (prompt leaks, persona swaps, fake admin discounts, stale-price bait, SQL and HTML injection, booking a slot that was never offered, gas leak plus "just book it", self-harm, other callers' bookings, injected instructions in a name). KB probes: 6 of 6 (the Saturday-hours probe failed in the first run and passes after the holiday-hours chunking fix). Three regexes in this synthetic set had false negatives (for example "no discount has been applied" matched the forbidden pattern) and were fixed between runs.

## Data handling

The partner dataset (transcripts, KB, scheduling DB) is confidential and never enters this repo. Scripts read it from `MERIDIAN_DATA_DIR` and write redacted copies outside the repo.

- **Holdout:** every call dated September 2026 (100 of 420) is held out. Discovery code reads transcripts only through `discovery_call_ids()`, which refuses holdout calls. The committed `eval/holdout_labels.json` has hashed ids and labels only.
- **Redaction:** regex plus spaCy NER removes account and invoice ids, phones, emails, addresses, ZIPs, gate codes, customer and staff names (2,235 redactions, 0 leaks in the check).
- **In the app:** no caller text is logged. Events hold opaque ids, outcomes and timings, kept 30 days. Handoff records carry an AI-written summary and a redacted 300-character excerpt, purged after 7 days. The demo database resets nightly.

## Running it

```bash
cd web && npm ci
npm test                                   # 42 unit tests on in-process Postgres (PGlite)
# set the variables in ../.env.example (DATABASE_URL=pglite:memory runs an in-process database)
npm run build && npm start
npm run eval                               # full holdout + adversarial run, about $0.05 on Haiku (about $1.40 on Opus)
npm run eval -- --split dev                # the dev set used for tuning
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
