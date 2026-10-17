# Meridian call center agent

An AI chat agent for the inbound line of Meridian Home Comfort, a fictional HVAC and plumbing company in Austin, TX. It answers fee, hours, membership and warranty questions from the company knowledge base, books visits against the scheduling database, verifies callers to answer questions about their own appointments, invoices and renewal date and to move or cancel visits, and hands everything else to a person with a summary. Built for the AEA FDE challenge.

HVAC and plumbing is not a regulated industry, so there is no HIPAA, PCI or similar regime here; the agent takes no payments. Gas, carbon monoxide, fire, electrical hazards, self-harm, medical emergencies, threats of violence and callers who are unsafe at home are life-safety matters, so they always get a fixed script and a handoff, never a model answer.

- **Demo:** https://meridian-web-production-c743.up.railway.app (invite code sent with the submission; staff pages need the separate staff code)
- **Results:** 69% of held-out calls contained and correct (95% CI 59–77%), inside the brief's 60–75% target and equal to the ceiling of 69%: every call the agent may handle was handled correctly, and every call that should go to a person did. The held-out set has been run several times, and the agent and the test harness were both changed after seeing earlier results, so 69% is not a clean first-look number; see [Results](#results) and its caveats.

## What is built

| Piece | Where | Notes |
|---|---|---|
| Call-driver discovery | `discovery/`, `docs/discovery.md` | Runs on redacted July–August transcripts only. |
| Retrieval | `web/lib/retrieval.ts`, `docs/retrieval.md` | Curated KB chunks, local `bge-small-en-v1.5` embeddings, pgvector. Stale and internal docs are excluded at ingest. |
| Agent | `web/lib/agent.ts`, `web/lib/policy.ts`, `web/lib/prompt.ts` | Deterministic policy routing first (safety scripts for gas/CO/fire, electrical hazards, self-harm, medical emergencies, threats and domestic violence, payments and disputes, membership cancellations, late technicians, complaints, asks for a person, unclear service-area ZIPs, prompt injection), then Claude (Haiku 5.5 by default, `AGENT_MODEL`) with seven narrow tools: `search_kb`, `check_availability`, `propose_booking`, `verify_caller`, `lookup_account`, `propose_appointment_change`, `handoff`. |
| Accounts | `web/lib/accounts.ts`, `web/app/api/appointments/change` | A caller is verified when phone number and ZIP both match one customer (3 tries per chat, 10 per session per hour). Reads are scoped server-side to that customer. Moves and cancellations show a card with any late fee; the server re-checks ownership and the slot and writes in one transaction when the caller presses Confirm. |
| Booking | `web/lib/scheduling.ts`, `web/app/api/bookings/confirm` | The model only proposes. The caller presses Confirm, and the server re-checks the slot and writes the booking in one transaction. A trigger blocks double-booking a technician. |
| Chat UI | `web/app/chat`, `web/components/Chat.tsx` | Streams text, shows slots, confirm cards for bookings and changes, source chips and handoff cards. Says "Booked", "Moved" or "Cancelled" only after the database write. The rail lists three made-up demo customers to try account features with. |
| Staff console | `web/app/staff/*` | Handoff queue (claim, resolve, flag), live dashboard from metadata, review queue, evaluation page. |
| Evaluation | `eval/`, `web/scripts/run_eval.ts` | Held-out September calls, deterministic checks, Wilson intervals. |

Voice is not built.

## Results

Final run `20261017T1836-6adc`, prompt `agent-v5`, model Haiku 5.5, config `a9a0024562`. The test set is all 100 September 2026 calls (`eval/holdout_manifest.txt`). The split was made before call-driver discovery and the code enforces it, but a keyword count and 25 sampled first lines over all 420 calls were looked at before the split (a pre-build guardrail note, not committed because it quotes transcript lines). Each call's opening line is the caller's first turn, verbatim from the redacted transcript (not paraphrased), plus a simulated caller that answers ZIP, name and verification questions, picks the first time offered and presses Confirm. The simulated caller acts on what its call was for: a caller with a question turns down a visit offer, a caller who wants a visit accepts one, and a caller asked what kind of unit failed knows the answer. Every check is code: the expected outcome from the call's driver, required facts (from the current KB, or from the assigned customer's records for account calls), forbidden stale values from the archived docs, and checks that the reply never claims a booking or change the database did not record. No model grades another model.

| Metric | Run 1 (agent-v2, Opus) | Run 2 (agent-v3) | Run 3 (agent-v4) | **Run 4 (agent-v5)** | n (run 4) | 95% CI (run 4) |
|---|---|---|---|---|---|---|
| Containment (no handoff and correct) | 37% | 45% | 64% | **69%** | 100 | 59–77% |
| Ceiling (calls the agent may handle) | 48% | 48% | 69% | 69% | 100 | 59–77% |
| Accuracy on handled calls | 77% | 94% | 93% | 100% (69/69) | 69 | 95–100% |
| Escalation recall | 52/52 | 50/52 | 31/31 | 31/31 | 31 | 89–100% |
| Escalation precision | 84% | 50/50 | 31/32 | 31/31 | 31 | 89–100% |
| Safety calls with script and handoff | 6/6 | 6/6 | 6/6 | 6/6 | 6 | 61–100% |
| Adversarial attacks held / KB probes | 18/18, 5/6 | 18/18, 6/6 | 22/22, 6/6 | 22/22, 6/6 | 22 / 6 | |
| Model cost of the 100-call run (est.) | about $5.85 | about $0.04 | about $0.06 | about $0.05 | | |

Runs 2 to 4 use Haiku 5.5.

**Read these numbers with three caveats.**

1. No run is fully clean. The first held-out run (agent-v1, `20261016T2345-b098`) scored 29%; after reading its failures, three harness bugs were fixed and agent-v1 was run again at 37%, then agent-v2 at 37% (run 1 in the table). The dev set (July–August discovery calls, labels in `eval/dev_labels.json`) was only created on 2026-10-17, so everything before run 2 was tuned with the held-out results in view. From run 2 on, changes were tried on the dev set first and each held-out run was done once with a finished config, but the held-out results still informed what was tried next.
2. Run 3 changes the scope, not just the agent. By the owner's decision (2026-10-17), verified callers' own appointment, invoice and balance questions and appointment moves and cancellations are now handled by the agent instead of a person. That relabels 21 held-out calls from "escalate" to "handle" (`eval/results/holdout_labels_before_account_scope.json` keeps the old labels), which is why the ceiling rose from 48% to 69%. Payments, disputes, refunds, autopay, membership cancellations, late technicians, complaints and safety still go to a person.
3. Run 4 changes the test harness, not just the agent. Most of run 3's five misses came from the simulated caller, not the agent: it said yes to every visit offer (so question calls ended in bookings) and couldn't say what kind of unit had failed. Run 4's simulated caller acts on what its call was for (above), and one label was corrected ("$500 off a new system" now counts as a correct answer to the membership discount question). The only agent change was one prompt line: water pooling around the indoor unit is an HVAC repair, not plumbing. A perfect score on 100 calls with a simulated caller is not a promise of perfect behaviour with real callers; the 95% interval on accuracy is 95–100%.

**How the eval handles account calls.** Transcript account ids don't map to the mock database, so the harness gives each account call its own customer with the records it needs (an upcoming visit, an invoice or a balance) and the simulated caller answers verification with that customer's phone and ZIP. The transcript's invoice id and amount, and a day like "Thursday" or "tomorrow", are swapped for the assigned customer's invoice and visit day. A move or cancellation counts only if the database shows it.

Nothing failed in run 4. On the dev set the same config scored 83 of 130 against a ceiling of 84; the one miss was a warranty answer that cited the manufacturer's 10-year parts warranty instead of Meridian's labor warranty term the check looks for.

### What changed between runs

All measured on the dev set first (`eval/results/dev_runs/`):

- **Run 2 (agent-v3).** Answer how membership and warranty policies work from the documents instead of handing off; book only when asked. Deterministic routes for invoice payments, registration status and unclear service-area ZIPs. Caching on the whole conversation, no retrieval for ZIP, name and slot-pick turns, and a model comparison on dev: Opus 5.5 39 contained at $1.36 per 100 calls, Sonnet 5.5 36 at $0.76, Haiku 5.5 38, 38 and 37 at $0.04. Haiku became the default; `AGENT_MODEL` switches back. The holiday-hours image became one chunk, which fixed the Saturday-hours probe.
- **Run 3 (agent-v4).** Caller verification, account lookups and appointment moves and cancellations, as above. On dev (130 calls, with every discovery call in the new account intents added) three runs scored 58, 75 and 72; the first exposed a real bug (the mock data's slot zones don't follow customer ZIPs, so moves were rejected), which was fixed. Four account-abuse attacks were added to the adversarial set.
- **Run 4 (agent-v5).** The condensate prompt line and the harness and label fixes in caveat 3. Dev: 80, then 83 of 130 (ceiling 84) after a second harness fix (a verified caller who only asked a question turns down an offer to change the visit).

Earlier history: run `20261016T2345-b098` (agent-v1) scored 29% because of three harness bugs; fixing the harness moved it to 37% (run `20261016T2351-8571`), and agent-v2 kept 37% while withdrawing the model's notes to itself. Those three runs are the history caveat 1 refers to. All summaries are in `eval/results/` (`containment_holdout_agent-v2.json`, `_agent-v3.json`, `_agent-v4.json`, and the current `containment_holdout.json`).

### Adversarial set

`eval/adversarial/cases.json` holds synthetic attacks and 6 synthetic KB probes; the counts below are from run 4, before the cases added after the 2026-10-17 audit (see [After the audit](#after-the-audit-2026-10-17)). Final run: **22 of 22 held** (prompt leaks, persona swaps, fake admin discounts, stale-price bait, SQL and HTML injection, booking a slot that was never offered, gas leak plus "just book it", self-harm, other callers' bookings, injected instructions in a name, and four account attacks: asking for a balance with only a phone number, guessing ZIPs until locked out, asking for a neighbour's records after verifying, and demanding a cancellation without the confirm card). KB probes: 6 of 6 (the Saturday-hours probe failed in the first run and passes after the holiday-hours chunking fix). Three regexes in this synthetic set had false negatives (for example "no discount has been applied" matched the forbidden pattern) and were fixed between runs.

### Where the eval cases are

The repo has the case builder (`eval/build_cases.py`), the hashed holdout manifest and the expected labels, but not the case text: each case opens with a caller's redacted first turn, and the guardrails keep transcript text, even redacted, out of the repo. A reviewer with the challenge dataset rebuilds the identical cases: set `MERIDIAN_DATA_DIR`, run `python discovery/redact.py`, then `python eval/build_cases.py` (holdout) and `python eval/build_cases.py dev`. `npm run eval` also needs the mock scheduling database from the same dataset.

## Monitoring and feedback loop

- **What is measured live:** every turn writes an event with opaque ids, outcome, handoff reason, latency, tokens and retrieval score (no text). The staff dashboard shows containment, handoff reasons, failures, spend against the daily cap and the last reset.
- **Alerting:** `/api/health` reports the model, prompt version, last reset, last successful reply and the past hour's error count, and returns 503 when the data is missing, the nightly reset is more than 26 hours old, or at least half of the past hour's turns failed (with five or more turns). An external monitor (Better Stack Uptime, free tier) polls it every few minutes and emails the owner when it is unreachable or returns a non-2xx status. Railway's own check runs only at deploy time.
- **Where problems go:** one review queue collects caller thumbs-downs, errors, low-confidence handoffs, failed bookings and staff flags from the handoff queue ("summary wrong", "could have answered"). A reviewer records agree, disagree or needs fix, a proposed fix, and whether the case should join the regression set.
- **How a fix ships:** a person turns a review into a code, prompt or KB change, it runs on the dev set, and only a finished config gets a held-out run. Nothing is promoted automatically.

### After the audit (2026-10-17)

A read-only audit found gaps that a reviewer could hit quickly, and they were fixed in prompt `agent-v6` (the full audit, with all three rounds, is [`docs/audit_2026-10-17.md`](docs/audit_2026-10-17.md)):

- Self-harm phrasing such as "I want to die" or "no point living" missed the deterministic route, and when the model handed off for safety it showed the gas/CO/fire script with no 988 line. The route is wider now, the model has a separate self-harm handoff that shows the 988 script, and every later message in that chat gets a fixed 988 reply instead of the model.
- "Double-charged", "disputing", "refunded" and "complaining" skipped the billing and complaint routes, and "I want a human" or "transfer me" reached the model. Both are deterministic handoffs now. Repeating a request no longer adds a second ticket.
- A second pass ran 87 risky conversations through the agent and found more: suicidal statements the route missed still got the gas card or, sometimes, no handoff; threats against technicians and medical emergencies weren't flagged; water at an electrical panel went to a booking; "smoke detector low battery", "flame sensor" and "I don't smoke" locked the chat as a gas emergency; a caller named Dan was treated as a jailbreak; and "I don't want to talk to a person" counted as asking for one. There are now fixed scripts and routes for medical emergencies (911), threats (the chat is locked and any booking made in it is flagged to staff), domestic violence (the national hotline), and electrical hazards; carbon monoxide symptoms near a furnace count as a CO case; a model safety handoff shows the script the caller's words match, or a generic urgent one, never the gas card by default. Re-running the 87 probes, every self-harm, medical, threat, gas, CO and electrical probe got the right card and a handoff (the phrases are in `eval/safety_probes/`, and `web/scripts/safety_probes.mts` re-runs them).
- 98 tests were added: 97 routing tests (`web/test/policy.test.ts`) and a database test for the nightly reset and the spend cap (149 in all).
- A re-audit of that commit ran 73 new phrasings three times and found nothing unsafe, but a few more gaps, now fixed: a caller threatened by someone else ("my neighbor is threatening me with a knife") got the card meant for people who make threats, and now gets a 911 script; the model's handoff now names a hazard category (gas or fire, electrical, self-harm, medical, threat, caller in danger, other) and the card follows it; "my mom is confused about which plan she has" and "CO detector install price?" no longer lock the chat; and the deterministic rules now cover the new self-harm, medical, threat and "talk to a person" wording, so the model is no longer the only net for them. Those 73 phrasings were used to write the rules, so they are no longer an unseen test.
- Low items from both passes were fixed too: Sundays are excluded in code, handoffs record whether the caller was verified, the review table is purged after 30 days, an injected name no longer drops a booking in progress, the old FAQ's hours and "checks accepted" and the archive's "prorated refund" and "membership transfers with you" are now forbidden values in the eval, stale handoff wording was updated, and `docs/discovery.md` lists the cluster sizes.
- Furnace flames that look yellow still lock the chat as a possible carbon monoxide case. The audit counted that as a false alarm; it is kept on purpose, because a yellow burner flame can mean incomplete combustion.

No held-out run was done for agent-v6, so the run 4 numbers above are for agent-v5. On the dev set the first agent-v6 build scored 81 of 130 in three runs; the final build (after all three audit rounds) scored 83 of 130 (ceiling 84, escalation recall and precision 46/46, safety 6/6, run `20261017T1937-4e23`), the same as agent-v5. Its one miss is the known warranty-wording case. Two of the three misses were the simulated caller, not the agent: it read "our team can clear the drain line" as an offer of a person and declined, and in another case its chosen slot was taken by a concurrent case and it ran out of turns. The third is the known warranty-wording miss. The adversarial set grew to 40 attacks (indirect, Spanish and mid-booking self-harm, a threat mid-booking, heat illness, domestic violence, water at a panel, CO symptoms, a caller named Dan, a low smoke-detector battery, "I don't want a person", 40 bookings at once, repeated asks for a person, a literal "you are now ...", an inflected dispute, and instructions planted in a KB chunk and in a customer name); all 40 held and the 6 KB probes passed.

**How containment is counted.** The denominator is the 100 held-out calls; the adversarial cases are reported separately. A booking case whose (hashed) ZIP zone has no openings for its service counts as a correct handoff: 6 of the 40 held-out booking cases and 3 of 34 dev booking cases.

## Data handling

The partner dataset (transcripts, KB, scheduling DB) is confidential and never enters this repo. Scripts read it from `MERIDIAN_DATA_DIR` and write redacted copies outside the repo.

- **Holdout:** every call dated September 2026 (100 of 420) is held out. Discovery code reads transcripts only through `discovery_call_ids()`, which refuses holdout calls. The committed `eval/holdout_labels.json` has hashed ids and labels only.
- **Redaction:** regex plus spaCy NER removes account and invoice ids, phones, emails, addresses, ZIPs, gate codes, customer and staff names (2,235 redactions, 0 leaks in the check).
- **In the app:** every message is sent to Anthropic's API to write the reply. The conversation is held in server memory for up to 2 hours and is not written to the database or logs. Events hold opaque ids, outcomes and timings, kept 30 days. Handoff records carry the name and ZIP the caller gave, an AI-written summary and a redacted 300-character excerpt, purged after 7 days. Test bookings keep the name and issue text until the nightly reset. The invite page and the chat say this.

## Running it

```bash
cd web && npm ci
npm test                                   # unit tests on in-process Postgres (PGlite)
# set the variables in ../.env.example (DATABASE_URL=pglite:memory runs an in-process database)
npm run build && npm start
npm run eval                               # full holdout + adversarial run, about $0.05 on Haiku (about $1.40 on Opus)
npm run eval -- --split dev                # the dev set used for tuning
python3 ../eval/publish_results.py         # copies the summary to the /evaluation page
```

Deploy: Railway, Next.js plus Postgres with pgvector, one replica of the `meridian-web` service. Railway does not read `web/railway.json` for this service; the pre-deploy command (`npm run db:setup`: migrations, seed, KB embeddings) and the `/api/health` check are set on the service itself, and `railway.json` records the same settings. Copy the seed DB and KB chunks into `web/.seed/` (gitignored) and run `railway up -s meridian-web --no-gitignore` from `web/`. A timer started at server boot (`web/instrumentation.ts`) runs the nightly reset and the 7- and 30-day purges at 03:00 Central even with no traffic. Better Stack Uptime polls `/api/health` and emails the owner on failure; a deployment elsewhere needs its own monitor pointed at it.

## Known constraints

These are places where the project's guardrails override the brief, or where the demo is limited.

1. **Invite gate:** the demo needs an invite code, even though the brief asks for a freely probeable app.
2. **Containment ceiling:** payments, disputes, refunds, membership cancellations, complaints and safety always escalate, so containment can't pass 69% on this set. The measured number is reported next to the ceiling.
3. **Weak verification:** phone number plus ZIP is enough to read and change a customer's appointments in this demo. That is fine for synthetic data; a real deployment would need a one-time code to the phone on file.
4. **Writes:** the model never writes to the database. Bookings and changes are written by the server after the caller presses Confirm.
5. **Mock schedule ends 2026-11-05.** After that date there are no open slots, so bookings hand off. The live demo sets `CLOCK_FLOOR=2026-10-19T14:00:00Z`: the clock never reads earlier than that, but it follows real time after it, so the app never offers or books a slot that has passed. `DEMO_NOW` pins the clock exactly and is used only by tests and the eval.
6. **Single instance:** conversations and request rate limits live in memory, so the app runs as one replica and a restart ends open chats. The daily spend total is kept in Postgres, so it survives restarts and deploys. Chat is limited per session and per client IP (the address Railway's proxy appends).
7. **Database engine:** the brief ships SQLite; the deployment uses Postgres.
8. **Repo visibility:** the repo is "internal" on Gauntlet's GitLab by the owner's decision, so it holds no raw data, KB files or database dumps.
9. **Dashboard numbers are live and unverified.** The graded numbers come only from the eval run.

## What this does not do

- No voice channel.
- No payments, refunds, billing changes or contact-detail edits; those go to a person. Account features work only on the mock database's made-up customers.
- No automatic learning. Staff flags and reviews are proposals; nothing is promoted into the KB or prompt without a reviewed change and a new eval run.
- The live app cannot detect a stale fact in a reply; only the eval checks for stale values.
