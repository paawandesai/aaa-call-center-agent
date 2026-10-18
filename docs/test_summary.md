# Test summary

`cd web && npm test` (Vitest, in-process Postgres via PGlite) on 2026-10-17, at the fifth-pass follow-ups (after 86efe70).

With the partner's mock scheduling database present (`export MERIDIAN_DATA_DIR=<the unzipped dataset>`):

```
 Test Files  6 passed (6)
      Tests  218 passed (218)
```

Without it (as in CI), the suite that needs it skips; the synthetic fixture suite (`test/scheduling_fixture.test.ts`) still covers DST and double-booking:

```
 Test Files  5 passed | 1 skipped (6)
      Tests  210 passed | 8 skipped (218)
```

Eval and safety results are separate: see `eval/results/` and the README.
