# Test summary

`cd web && npm test` (Vitest, in-process Postgres via PGlite) on 2026-10-17, commit after 3d62cc9.

With the partner's mock scheduling database present:

```
 Test Files  5 passed (5)
      Tests  199 passed (199)
```

Without it (as in CI), the suite that needs it skips; the synthetic fixture suite (`test/scheduling_fixture.test.ts`) still covers DST and double-booking:

```
 Test Files  4 passed | 1 skipped (5)
      Tests  192 passed | 7 skipped (199)
```

Eval and safety results are separate: see `eval/results/` and the README.
