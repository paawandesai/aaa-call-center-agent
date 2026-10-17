# AI usage

Model-generated artifacts in this repo that were not independently verified by a person. Each entry names the producing model.

| Artifact | Produced by | Verification |
|---|---|---|
| `discovery/*.py`, `kb/*.py`, `scripts/license_audit.py`, `.githooks/pre-commit`, `.gitlab-ci.yml` | Claude Opus 5.5, via Claude Code | Scripts were run against the dataset; the redaction leak check passes. No human code review yet. |
| `README.md`, `AI_USAGE.md`, `docs/discovery.md`, `docs/retrieval.md` | Claude Opus 5.5, via Claude Code | Numbers are copied from result files produced by code. An audit on 2026-10-17 corrected several overstatements. Not reviewed line by line by a person. |
| The 24 retrieval questions in `eval/retrieval_dev.json` | Claude Opus 5.5, via Claude Code | Paraphrased from redacted discovery calls, not quoted; gold passages checked by code against the KB. |
| `web/` (agent, API routes, chat UI, staff console, migrations, tests), `eval/build_cases.py`, `eval/publish_results.py`, `eval/adversarial/cases.json`, `web/scripts/run_eval.ts` | Claude Opus 5.5, via Claude Code | Unit tests pass (`npm test`); browser smoke runs with axe on every page; demo activity (`web/lib/demoseed.ts`) is synthetic and labelled in the UI; eval results are produced by code checks, not reviewed by hand. No human code review yet. |
| Agent replies at runtime | Claude Haiku 5.5 (`claude-haiku-5-5`, set in `web/lib/config.ts`), via the Anthropic API | Disclosed to callers as AI. Bookings and appointment changes are confirmed only by the server's database write. |
