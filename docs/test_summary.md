# Test summary

`cd web && npm test` (Vitest, in-process Postgres via PGlite) on 2026-10-18, after the final-audit fixes (c313cd0).

With the partner's mock scheduling database present (`export MERIDIAN_DATA_DIR=<the unzipped dataset>`):

```
 Test Files  6 passed (6)
      Tests  243 passed (243)
```

Without it (as in CI), the suite that needs it skips; the synthetic fixture suite (`test/scheduling_fixture.test.ts`) still covers DST, double-booking, past slots, holiday closures, Christmas Eve, the late fee and the retention purges:

```
 Test Files  5 passed | 1 skipped (6)
      Tests  235 passed | 8 skipped (243)
```

`npm run coverage` reports about 30% line coverage of `lib/` and `app/` without the partner data and about 33% with it (route handlers and pages are exercised by the browser checks in `web/e2e/`, not by Vitest).

Eval and safety results are separate: see `eval/results/` and the README.
