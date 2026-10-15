# Performance records

Measured on the reference hardware (SPEC §3) by the orchestrator, alone, after the ticket's
wave was merged (docs/tickets/EXECUTION.md, Measurements). Recorded, not asserted in CI
(SPEC §11). Each row is one JSON file in this directory with the samples and the environment.

Node benchmarks: `PERF_RECORD=1 npx vitest run --config vitest.perf.config.ts tests/perf/<file>`.

| Record                   | Ticket | Measurement                                              | Budget | Result   | Statistic                         | Date       |
| ------------------------ | ------ | -------------------------------------------------------- | ------ | -------- | --------------------------------- | ---------- |
| `se-010-dirty-rectangle` | SE-010 | 16×16 dirty rectangle over 8 layers at 256×256, Node     | 2 ms   | 0.030 ms | 95th percentile of 5000 calls     | 2026-10-12 |
| `se-043-import`          | SE-043 | 2048×2048 source to 16 colours at 64×64 (`runImport`), Node | 500 ms | 62.4 ms  | slowest of 20 runs, cold run included | 2026-10-13 |
| `se-015-stroke-latency-intel-uhd-no-echo` | SE-015 | Pointer event to the submit of the frame showing it, 256×256 with 8 layers, pixel grid at 8×, Chrome on Intel UHD, without the stroke echo (fc3eb7f) | 33 ms | 26.2 ms | largest of four p95s (every sample of a 6 s stroke; first, second and later samples of 40 short strokes) | 2026-10-15 |
| `se-015-stroke-latency-rtx-4060-no-echo`  | SE-015 | The same on RTX 4060                                     | 33 ms | 34.1 ms (over) | as above                    | 2026-10-15 |

`se-043-import` was measured again on 2026-10-13 after the colour key moved before the resample
(first record, 2026-10-12: 56.9 ms).

Browser benchmark: `PERF_RECORD=1 PERF_GPU=<intel-uhd|rtx-4060> npx vitest run --config
vitest.perf.config.ts tests/perf/se-015-stroke-latency.perf.ts`; `PERF_ECHO=off` measures
without the stroke echo and writes the `-no-echo` record. The `-no-echo` records above were taken
before the echo existed, and their result missed the budget on RTX 4060, which is why SE-015
built the echo (REVIEW.md E61). The records with the echo are not taken yet (E66). A run is
valid only with about 740 frames submitted during the 6 s stroke (`details.continuousStroke.
framesSubmitted`).
