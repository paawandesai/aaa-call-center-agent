# Meridian call center agent

An AI chat agent for the inbound line of Meridian Home Comfort, a fictional HVAC and plumbing company in Austin, TX. It answers fee, hours, membership and warranty questions from the company knowledge base, books visits against the scheduling database, verifies callers to answer questions about their own appointments, invoices and renewal date and to move or cancel visits, and hands everything else to a person with a summary. Built for the AEA FDE challenge.

- **Demo:** https://meridian-web-production-c743.up.railway.app (invite code sent with the submission; staff pages need the separate staff code)
- **Results:** 64% of held-out calls contained and correct (95% CI 54–73%), inside the brief's 60–75% target, against a ceiling of 69%. The first, untuned run scored 37%. The 64% comes after changes made once that result was known (including a scope change to verified account work), tuned on a separate dev set; see [Results](#results) for how it got there.

## What is built

| Piece | Where | Notes |
|---|---|---|
| Call-driver discovery | `discovery/`, `docs/discovery.md` | Runs on redacted July–August transcripts only. |
| Retrieval | `web/lib/retrieval.ts`, `docs/retrieval.md` | Curated KB chunks, local `bge-small-en-v1.5` embeddings, pgvector. Stale and internal docs are excluded at ingest. |
| Agent | `web/lib/agent.ts`, `web/lib/policy.ts`, `web/lib/prompt.ts` | Deterministic policy routing first (safety, payments and disputes, membership cancellations, late technicians, complaints, asks for a person, unclear service-area ZIPs, prompt injection), then Claude (Haiku 5.5 by default, `AGENT_MODEL`) with seven narrow tools: `search_kb`, `check_availability`, `propose_booking`, `verify_caller`, `lookup_account`, `propose_appointment_change`, `handoff`. |
| Accounts | `web/lib/accounts.ts`, `web/app/api/appointments/change` | A caller is verified when phone number and ZIP both match one customer (3 tries per chat, 10 per session per hour). Reads are scoped server-side to that customer. Moves and cancellations show a card with any late fee; the server re-checks ownership and the slot and writes in one transaction when the caller presses Confirm. |
| Booking | `web/lib/scheduling.ts`, `web/app/api/bookings/confirm` | The model only proposes. The caller presses Confirm, and the server re-checks the slot and writes the booking in one transaction. A trigger blocks double-booking a technician. |
| Chat UI | `web/app/chat`, `web/components/Chat.tsx` | Streams text, shows slots, confirm cards for bookings and changes, source chips and handoff cards. Says "Booked", "Moved" or "Cancelled" only after the database write. The rail lists three made-up demo customers to try account features with. |
| Staff console | `web/app/staff/*` | Handoff queue (claim, resolve, flag), live dashboard from metadata, review queue, evaluation page. |
| Evaluation | `eval/`, `web/scripts/run_eval.ts` | Held-out September calls, deterministic checks, Wilson intervals. |

Voice is not built.

## Results

Final run `20261017T1757-98c5`, prompt `agent-v4`, model Haiku 5.5, config `40f30dbec5`. The test set is all 100 September 2026 calls, frozen before any analysis (`eval/holdout_manifest.txt`). Each call becomes a paraphrased, redacted opening line plus a simulated caller that answers ZIP, name and verification questions, picks the first time offered and presses Confirm. Every check is code: the expected outcome from the call's driver, required facts (from the current KB, or from the assigned customer's records for account calls), forbidden stale values from the archived docs, and checks that the reply never claims a booking or change the database did not record. No model grades another model.

| Metric | Run 1 (agent-v2, Opus) | Run 2 (agent-v3, Haiku) | **Run 3 (agent-v4, Haiku)** | n (run 3) | 95% CI (run 3) |
|---|---|---|---|---|---|
| Containment (no handoff and correct) | 37% | 45% | **64%** | 100 | 54–73% |
| Ceiling (calls the agent may handle) | 48% | 48% | 69% | 100 | 59–77% |
| Accuracy on handled calls | 77% | 94% | 93% (64/69) | 69 | 84–97% |
| Escalation recall | 52/52 | 50/52 | 31/31 | 31 | 89–100% |
| Escalation precision | 84% | 50/50 | 31/32 | 32 | 84–99% |
| Safety calls with script and handoff | 6/6 | 6/6 | 6/6 | 6 | 61–100% |
| Adversarial attacks held / KB probes | 18/18, 5/6 | 18/18, 6/6 | 22/22, 6/6 | 22 / 6 | |
| Model cost of the 100-call run (est.) | about $5.85 | about $0.04 | about $0.06 | | |

**Read these numbers with two caveats.**

1. Only run 1 is clean. Runs 2 and 3 come after changes made once we had seen run 1, so the held-out set is no longer untouched. To limit that, all tuning happened on a separate dev set (July–August discovery calls, labels in `eval/dev_labels.json`), and each held-out run was done once with a finished config.
2. Run 3 changes the scope, not just the agent. By the owner's decision (2026-10-17), verified callers' own appointment, invoice and balance questions and appointment moves and cancellations are now handled by the agent instead of a person. That relabels 21 held-out calls from "escalate" to "handle" (`eval/results/holdout_labels_before_account_scope.json` keeps the old labels), which is why the ceiling rose from 48% to 69%. Payments, disputes, refunds, autopay, membership cancellations, late technicians, complaints and safety still go to a person.

**How the eval handles account calls.** Transcript account ids don't map to the mock database, so the harness gives each account call its own customer with the records it needs (an upcoming visit, an invoice or a balance) and the simulated caller answers verification with that customer's phone and ZIP. The transcript's invoice id and amount, and a day like "Thursday" or "tomorrow", are swapped for the assigned customer's invoice and visit day. A move or cancellation counts only if the database shows it.

What is still wrong in run 3 (5 calls): two warranty questions ended in a booked repair visit, one warranty claim was answered instead of booked, one repair was booked as the wrong service, and one existing-appointment call was handed to billing.

### What changed between runs

All measured on the dev set first (`eval/results/dev_runs/`):

- **Run 2 (agent-v3).** Answer how membership and warranty policies work from the documents instead of handing off; book only when asked. Deterministic routes for invoice payments, registration status and unclear service-area ZIPs. Caching on the whole conversation, no retrieval for ZIP, name and slot-pick turns, and a model comparison on dev: Opus 5.5 39 contained at $1.36 per 100 calls, Sonnet 5.5 36 at $0.76, Haiku 5.5 38, 38 and 37 at $0.04. Haiku became the default; `AGENT_MODEL` switches back. The holiday-hours image became one chunk, which fixed the Saturday-hours probe.
- **Run 3 (agent-v4).** Caller verification, account lookups and appointment moves and cancellations, as above. On dev (130 calls, with every discovery call in the new account intents added) three runs scored 58, 75 and 72; the first exposed a real bug (the mock data's slot zones don't follow customer ZIPs, so moves were rejected), which was fixed. Four account-abuse attacks were added to the adversarial set.

Earlier history: run `20261016T2345-b098` (agent-v1) scored 29% because of three harness bugs; fixing the harness moved it to 37% (run `20261016T2351-8571`), and agent-v2 kept 37% while withdrawing the model's notes to itself. All summaries are in `eval/results/` (`containment_holdout_agent-v2.json`, `containment_holdout_agent-v3.json`, and the current `containment_holdout.json`).

### Adversarial set

`eval/adversarial/cases.json` holds 22 synthetic attacks and 6 synthetic KB probes. Final run: **22 of 22 held** (prompt leaks, persona swaps, fake admin discounts, stale-price bait, SQL and HTML injection, booking a slot that was never offered, gas leak plus "just book it", self-harm, other callers' bookings, injected instructions in a name, and four account attacks: asking for a balance with only a phone number, guessing ZIPs until locked out, asking for a neighbour's records after verifying, and demanding a cancellation without the confirm card). KB probes: 6 of 6 (the Saturday-hours probe failed in the first run and passes after the holiday-hours chunking fix). Three regexes in this synthetic set had false negatives (for example "no discount has been applied" matched the forbidden pattern) and were fixed between runs.

## Data handling

The partner dataset (transcripts, KB, scheduling DB) is confidential and never enters this repo. Scripts read it from `MERIDIAN_DATA_DIR` and write redacted copies outside the repo.

- **Holdout:** every call dated September 2026 (100 of 420) is held out. Discovery code reads transcripts only through `discovery_call_ids()`, which refuses holdout calls. The committed `eval/holdout_labels.json` has hashed ids and labels only.
- **Redaction:** regex plus spaCy NER removes account and invoice ids, phones, emails, addresses, ZIPs, gate codes, customer and staff names (2,235 redactions, 0 leaks in the check).
- **In the app:** no caller text is logged. Events hold opaque ids, outcomes and timings, kept 30 days. Handoff records carry an AI-written summary and a redacted 300-character excerpt, purged after 7 days. The demo database resets nightly.

## Running it

```bash
cd web && npm ci
npm test                                   # 51 unit tests on in-process Postgres (PGlite)
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
2. **Containment ceiling:** payments, disputes, refunds, membership cancellations, complaints and safety always escalate, so containment can't pass 69% on this set. The measured number is reported next to the ceiling.
3. **Weak verification:** phone number plus ZIP is enough to read and change a customer's appointments in this demo. That is fine for synthetic data; a real deployment would need a one-time code to the phone on file.
4. **Writes:** the model never writes to the database. Bookings and changes are written by the server after the caller presses Confirm.
5. **Mock schedule ends 2026-11-05.** After that date there are no open slots, so bookings hand off. Setting `DEMO_NOW` pins the app's clock to a date inside the schedule; the demo is pinned to 2026-10-19.
6. **Single instance:** conversations, rate limits and the spend cap live in memory, so the app runs as one replica and a restart ends open chats.
7. **Database engine:** the brief ships SQLite; the deployment uses Postgres.
8. **Repo visibility:** the repo is "internal" on Gauntlet's GitLab by the owner's decision, so it holds no raw data, KB files or database dumps.
9. **Dashboard numbers are live and unverified.** The graded numbers come only from the eval run.

## What this does not do

- No voice channel.
- No payments, refunds, billing changes or contact-detail edits; those go to a person. Account features work only on the mock database's made-up customers.
- No automatic learning. Staff flags and reviews are proposals; nothing is promoted into the KB or prompt without a reviewed change and a new eval run.
- The live app cannot detect a stale fact in a reply; only the eval checks for stale values.
