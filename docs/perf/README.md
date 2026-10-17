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
| `se-015-stroke-latency-intel-uhd` | SE-015 | Pointer event to the first frame showing it, NGNE's submit or the overlay echo's redraw, whichever is earlier; otherwise as above, with the stroke echo (72ca19b) | 33 ms | 17.6 ms | as above; longest pointer-to-submitted gap 8.6 ms | 2026-10-15 |
| `se-015-stroke-latency-rtx-4060`  | SE-015 | The same on RTX 4060                                     | 33 ms | 20.2 ms  | as above; longest gap 8.6 ms      | 2026-10-15 |
| `se-017-flood-fill`      | SE-017 | `floodMask` (contiguous, tolerance 0) of a 1024×1024 image from one pixel, then `paintMask` over the mask; transparent and opaque flat images, Node | 100 ms | 20.4 ms | larger of the two images' slowest of 20 fills, cold run included | 2026-10-15 |
| `se-031-magic-wand`      | SE-031 | Magic wand click (press and release) through the tool pipeline on an opaque flat 1024×1024 document, tolerance 0: flood mask, pending area and the selection command at the release; Contiguous on and off, Node, no viewport | 100 ms | 20.6 ms | larger of the two modes' slowest of 10 clicks, each on a fresh document, cold click included | 2026-10-17 |
| `se-031-wand-pan-intel-uhd` | SE-031 | JavaScript time of the overlay redraw at each 3 px pan step over a non-contiguous wand pick of a checkerboard on a 1024² document at 1× (256² at 4× in `details`), Chrome on Intel UHD | none | 3.9 ms | p95 of 120 pan steps, JavaScript of the draws only | 2026-10-17 |
| `se-031-wand-pan-rtx-4060`  | SE-031 | The same on RTX 4060 | none | 3.9 ms | as above | 2026-10-17 |

`se-043-import` was measured again on 2026-10-13 after the colour key moved before the resample
(first record, 2026-10-12: 56.9 ms).

`se-017-flood-fill` also gives, in `details`, the whole paint bucket press through the tool
pipeline in Node (fill, live composite, commit comparison and undo patches; no viewport):
68.8 ms, slowest of 10. An unrecorded run right after the record gave 27.3 ms for the fill and
72.1 ms for the press (REVIEW.md E90).

`se-031-wand-pan-*` have no budget: neither SE-031 nor SPEC §6.6 states one, and the record is
informational (no `pass`). Before SE-031's review fix the same pan cost about 95 ms median and
192 ms p95 per step at 1024², the ants ring being painted again at every view change (REVIEW.md
F3). Unrecorded runs right after the records gave 21.4 ms for the wand and 4.4 and 4.1 ms for the
pan.

Browser benchmark: `PERF_RECORD=1 PERF_GPU=<intel-uhd|rtx-4060> npx vitest run --config
vitest.perf.config.ts tests/perf/se-015-stroke-latency.perf.ts`; `PERF_ECHO=off` measures
without the stroke echo and writes the `-no-echo` record. The `-no-echo` records above were taken
before the echo existed, and their result missed the budget on RTX 4060, which is why SE-015
built the echo (REVIEW.md E61). The records with the echo met the budget on both GPUs (E69). A
run is valid only with the usual number of frames submitted during the 6 s stroke
(`details.continuousStroke.framesSubmitted`: about 740 on Intel UHD, 650–700 on RTX 4060), and
only when an unrecorded run right after it agrees within a few milliseconds: the machine can
slow down for part of a run, which the frame count of the continuous stroke does not show (E70).
