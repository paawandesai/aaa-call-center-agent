# Test summary

`cd web && npm test` (Vitest, in-process Postgres via PGlite) on 2026-10-17, at the fourth-pass fixes (after 86632f9).

With the partner's mock scheduling database present (`export MERIDIAN_DATA_DIR=<the unzipped dataset>`):

```
 Test Files  6 passed (6)
      Tests  209 passed (209)
```

Without it (as in CI), the suite that needs it skips; the synthetic fixture suite (`test/scheduling_fixture.test.ts`) still covers DST and double-booking:

```
 Test Files  5 passed | 1 skipped (6)
      Tests  202 passed | 7 skipped (209)
```

Eval and safety results are separate: see `eval/results/` and the README.
