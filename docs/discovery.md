# Call-driver discovery

_Scope update 2026-10-17: see [Scope change](#scope-change-2026-10-17) at the end; the handle/escalate table and ceiling below are the original 2026-10-16 analysis._

_Run 2026-10-16 on the discovery split only: the 320 July–August calls. The 100 September calls are held out (`eval/holdout_manifest.txt`) and were not used for discovery; before the split, only a keyword count and 25 sampled first lines over all 420 calls were looked at. All counts come from redacted transcripts. Caller requests below are paraphrased, not quoted._

## Method

1. **Redact locally** (`discovery/redact.py`, regex plus name lexicon plus spaCy NER). Then `discovery/check_redaction.py` confirms no caller name or ID survives.
2. **De-duplicate before counting** (`discovery/drivers.py`). This removed 1 exact duplicate and 1 near-duplicate (same duration and ≥ 0.97 text similarity), leaving **318 calls**.
3. **Strip the script.** Only caller turns are used. Greetings, filler words and line-noise turns ("you cut out", "I'm driving") are dropped, and so are bare name and account-number replies.
4. **Cluster without labels.** The intent text is embedded locally with `BAAI/bge-small-en-v1.5` (MIT, via fastembed) and grouped with k-means. k=15 was chosen by cosine silhouette (0.35).
5. **Label deterministically** (`discovery/classify.py`). Regex rules written from the cluster exemplars assign each call the intent of the caller's first substantive request. Safety words anywhere in the caller's turns override everything else. All 318 calls are labeled. Cluster purity against the rule labels is 78%. The disagreements come from clusters that merge calls with the same sentence pattern but different intents, such as "can you move my appointment" and "can you book me".

The corpus is clearly templated: about 30 request templates with surface variation. This makes the rule labels reliable on these calls. It also means **real-world intent variety is understated**, and the September holdout is the check on that.

## Drivers by volume (n = 318)

| Rank | Driver | Calls | Share | What callers want |
|---|---|---|---|---|
| 1 | Repair / service booking | 85 | 26.7% | Book a visit for a symptom (no cooling, blank thermostat, furnace won't start, clogged sink, water at the indoor unit, pilot light), a tune-up, or a booking plus a membership question |
| 2 | Billing and payments | 69 | 21.7% | Pay an invoice, check a balance, set up autopay, explain an invoice, dispute a charge, duplicate charge, refund |
| 3 | Membership (Comfort Club) | 45 | 14.2% | What it includes and costs, renewal timing, cancel, upgrade to Plus, member discount on a new system |
| 4 | Warranty | 39 | 12.3% | File a claim, is a failed part covered, does the warranty transfer to a new owner, was my unit registered |
| 5 | Existing appointment | 26 | 8.2% | Reschedule, cancel, confirm, technician is late |
| 6 | Safety emergency | 18 | 5.7% | Burning smell, gas smell, CO alarm, sparks |
| 7 | Complaint / escalation request | 15 | 4.7% | Manager request, technician conduct, no callback, upsell complaint |
| 8 | Other (redirect) | 11 | 3.5% | Job inquiries, commercial quotes, wrong numbers |
| 9 | System replacement estimate | 10 | 3.1% | Ballpark cost for replacing an old system |

## Scope: handle vs escalate

Scope is chosen by volume × whether the current KB answers it × risk. The guardrails escalate anything that needs identity verification or account access, moves money, involves disputes, cancellations or complaints, or is a safety emergency, regardless of volume.

| Intent | Calls | Decision | Why |
|---|---|---|---|
| New repair booking | 73 | **Handle** (scheduling) | Availability check and booking against the DB, with no account changes |
| Tune-up booking | 9 | **Handle** (scheduling) | Same as above |
| Booking plus membership question | 3 | **Handle** | Booking plus KB answer |
| Replacement estimate | 10 | **Handle** | KB price range, then book a Comfort Advisor estimate (no estimate slots exist in the central zone, so those escalate) |
| Membership info and price | 19 | **Handle** (KB) | Current 2026 membership doc and fee schedule |
| Membership renewal timing | 11 | **Handle** (KB, policy only) | General renewal and auto-renew-cancel policy. The caller's own renewal date needs their account, so that part escalates |
| Membership upgrade question | 5 | **Handle** (KB, policy only) | Prorated $80 upgrade policy. Making the change is an account action and escalates |
| Warranty coverage question | 11 | **Handle** (KB) | Current warranty policy, plus booking a warranty diagnostic |
| Warranty claim | 11 | **Handle** (KB + scheduling) | KB says to book a warranty diagnostic |
| Warranty transfer | 8 | **Handle** (KB) | Transfer rules |
| Wrong number | 2 | **Handle** | Polite close, no human needed |
| Warranty registration status | 9 | Escalate | Needs the caller's install record |
| All billing intents | 69 | Escalate | Account access and money movement; disputes and refunds always escalate |
| Membership cancellation | 10 | Escalate | Cancellation |
| Existing appointment | 26 | Escalate | Reschedule and cancel escalate (owner decision 2026-10-16); confirm and late-tech need the caller's booking |
| Safety emergency | 18 | Escalate (scripted) | Scripted evacuate-and-call-911 message plus a human, never a booking |
| Complaints | 15 | Escalate | Always |
| Job inquiry, commercial | 9 | Escalate | Department redirects. A website deflection does not count as contained |

**The top 3 drivers the agent answers from the KB** are Repair/service booking (with scheduling), Membership and Warranty. Billing is the #2 driver by volume, but it is deliberately escalated, because every billing intent needs account access or touches money.

## Containment ceiling

In-scope intents cover **162 of 318 calls, so the ceiling is 50.9%**, if every in-scope call were resolved perfectly. That is below the brief's 60–75% target. The real number will be lower because of the following:

- There are no plumbing slots in the north zone and no estimate slots in the central zone.
- Dripping Springs and Manor have no zone in the scheduling DB.
- Lakeway is ambiguous in the service-area doc.
- Some account-specific follow-ups inside otherwise in-scope calls will need a human.

Reaching 60% would mean handling account-dependent work (billing lookups, appointment changes) without identity verification, which the guardrails rule out. We report the measured number next to this ceiling and do not widen scope.

## Transcripts vs current KB (human agents are not ground truth)

- **Safety:** in 11 of the 18 safety calls, the human agent booked a regular appointment. Only 7 got evacuate or 911 instructions. The current safety protocol says these calls are never booked.
- **Warranty claims:** agents justify coverage with "under a year", but the current policy gives installs a 2-year labor warranty (5 years for members at install). The outcome (no-charge diagnostic) matches, but the reasoning is outdated.
- **Window labels:** agents sometimes call a 12–4 or 1–5 slot a "morning window". This is noise to ignore, not a policy.
- **Matches the current KB:** quoted prices in discovery calls match the current KB ($89 diagnostic, $189/$16.99 Standard, $269 Plus, 15% member discount). No stale archive values ($79, $149/yr, 10%, 90-day) were quoted, and agents correctly refuse card numbers by phone.

## Limitations

- Labels are rule-based and validated only against the clusters, not against a second human labeler.
- The corpus is templated, so real calls would be messier. The September holdout tests this.
- Multi-intent calls are labeled by their first request. Only 3 calls explicitly bundled two requests.

## Scope change (2026-10-17)

The owner chose to let the agent do verified account work: after a phone number and ZIP match one customer, it answers that customer's appointment, invoice, balance and renewal-date questions, and moves or cancels their appointments through a confirm card. This reverses the 2026-10-16 decision above that reschedules and cancellations escalate, and the "do not widen scope" line. Phone plus ZIP is weak verification; the README lists it as a known constraint.

Still escalated: payments, disputes, refunds, autopay, membership cancellations, contact-detail edits, late technicians, complaints and safety.

The ceiling was recomputed on the labelled eval sets rather than this table: 69 of the 100 held-out September calls may be handled (was 48 under the old scope), and 84 of the 130 dev calls. The README's Results section has the run-by-run numbers.

The k-means clusters (k = 15, over the 318 de-duplicated calls) had 63, 47, 35, 25, 22, 21, 18, 14, 13, 11, 11, 11, 10, 9 and 8 calls. They were only used to write the labelling rules; the driver counts above are rule labels.

