# AI usage

Model-generated artifacts in this repo that were not independently verified by a person. Each entry names the producing model.

| Artifact | Produced by | Verification |
|---|---|---|
| `discovery/*.py`, `scripts/license_audit.py`, `.githooks/pre-commit`, `.gitlab-ci.yml`, `README.md` | Claude (Anthropic), via Claude Code | Scripts were run against the dataset; the redaction leak check passes. Code has not had human review yet. |
| `web/` (agent, API routes, chat UI, staff console, migrations, tests), `eval/build_cases.py`, `eval/publish_results.py`, `eval/adversarial/cases.json`, `web/scripts/run_eval.ts` | Claude (Anthropic), via Claude Code | 31 unit tests pass; browser smoke runs with axe on every page; eval results are produced by code checks, not reviewed by hand. No human code review yet. |
| Agent replies at runtime | Claude, via the Anthropic API | Disclosed to callers as AI. Bookings are confirmed only by the server's database write. |
