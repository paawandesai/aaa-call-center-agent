# AI usage

Model-generated artifacts in this repo that were not independently verified by a person. Each entry names the producing model.

| Artifact | Produced by | Verification |
|---|---|---|
| `discovery/*.py`, `scripts/license_audit.py`, `.githooks/pre-commit`, `.gitlab-ci.yml`, `README.md` | Claude (Anthropic), via Claude Code | Scripts were run against the dataset; the redaction leak check passes. Code has not had human review yet. |
