# Performance records

Measured on the reference hardware (SPEC §3) by the orchestrator, alone, after the ticket's
wave was merged (docs/tickets/EXECUTION.md, Measurements). Recorded, not asserted in CI
(SPEC §11). Each row is one JSON file in this directory with the samples and the environment.

Node benchmarks: `PERF_RECORD=1 npx vitest run --config vitest.perf.config.ts tests/perf/<file>`.

| Record                   | Ticket | Measurement                                              | Budget | Result   | Statistic                         | Date       |
| ------------------------ | ------ | -------------------------------------------------------- | ------ | -------- | --------------------------------- | ---------- |
| `se-010-dirty-rectangle` | SE-010 | 16×16 dirty rectangle over 8 layers at 256×256, Node     | 2 ms   | 0.030 ms | 95th percentile of 5000 calls     | 2026-10-12 |
| `se-043-import`          | SE-043 | 2048×2048 source to 16 colours at 64×64 (`runImport`), Node | 500 ms | 56.9 ms  | slowest of 20 runs, cold run included | 2026-10-12 |
