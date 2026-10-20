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
| `se-024-playback-intel-uhd` | SE-024 | Editor playback from the `ed:play` grid, 64 frames of 256² (8 layers), 100 ms each, 1×, two passes, Chrome on Intel UHD | 0 skipped | 0 of 128 | entries skipped (a count, `unit: count`) | 2026-10-19 |
| `se-024-playback-rtx-4060` | SE-024 | The same on RTX 4060 | 0 skipped | 0 of 129 | as above | 2026-10-19 |
| `se-044-preview`         | SE-044 | Import PNG dialog on a 1024×1024 source at the dialog's defaults (target 32×32 contain, smart alpha and colours): setting change (dither, count, fit, alpha, size, crop, cells) to the result pane drawn with the worker's answer, Chrome | 300 ms | 182.8 ms | largest of 48 changes | 2026-10-19 |
| `se-044-preview-1024-target` | SE-044 | The same source to a 1024×1024 target, contain, Reduce to 256 colours; changes of dither, count, fit and crop | 300 ms | 543.4 ms (over) | largest of 30 changes | 2026-10-19 |
| `se-026-timeline-scroll-intel-uhd` | SE-026 | Mean frame interval of a scripted zigzag scroll of the timeline at 200 frames × 30 layers (cells and frame numbers windowed), Chrome on Intel UHD | 20 ms (50 fps) | 7.50 ms (133 fps) | mean of 600 scroll frames; 125 frames moved the window; idle 144 fps | 2026-10-20 |
| `se-026-timeline-scroll-rtx-4060` | SE-026 | The same on RTX 4060 | 20 ms (50 fps) | 7.52 ms (133 fps) | as above; idle 143 fps | 2026-10-20 |
| `se-042-autosave-long-tasks` | SE-042 | Longest long task overlapping an autosave snapshot window: first full snapshot of a 16-frame 256×256 document, then 24 one-cel edits, Chrome | 50 ms | 0 ms | largest over 25 snapshots (0: none overlapped); 80 ms control task observed | 2026-10-20 |
| `se-062-stroke-latency-symmetric-intel-uhd` | SE-062 | As `se-015-stroke-latency-intel-uhd` (with the echo), with symmetry and tiled mode both on | 33 ms | 18.0 ms | as SE-015; 719 frames submitted in the 6 s stroke | 2026-10-20 |
| `se-062-stroke-latency-symmetric-rtx-4060` | SE-062 | The same on RTX 4060 | 33 ms | 16.8 ms | as above; 671 frames | 2026-10-20 |

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

`se-024-playback-*` count entries of the sequence that the clock jumped over or that no submitted
frame showed while they were active; `resultMs` holds that count (`unit: count`), with a budget
of 0. A frame counts as shown when it was submitted to NGNE (`onDrawn`), not when it was
presented. First frame after an entry: median 13.4 / 12.3 ms, p95 26.3 / 30.9 ms (Intel UHD /
RTX 4060). Unrecorded runs right after: 0 of 128 skipped on both GPUs (REVIEW.md F48).

`se-044-preview` is the acceptance item of SE-044 (a 1024×1024 source). `se-044-preview-1024-target`
answers REVIEW.md D14 (`runImport` to a 1024² target with 256 colours): it misses 300 ms, its
slowest changes being Floyd–Steinberg dither over a million pixels (median of all changes
194 ms). Both run in Chrome without `PERF_GPU`: the preview is CPU work in a worker.
Two unrecorded runs just before the record gave 532.6 and 528.4 ms for the 1024² target and,
in the second, 244.9 ms for the defaults (REVIEW.md F73).

Browser benchmark: `PERF_RECORD=1 PERF_GPU=<intel-uhd|rtx-4060> npx vitest run --config
vitest.perf.config.ts tests/perf/se-015-stroke-latency.perf.ts`; `PERF_ECHO=off` measures
without the stroke echo and writes the `-no-echo` record. The `-no-echo` records above were taken
before the echo existed, and their result missed the budget on RTX 4060, which is why SE-015
built the echo (REVIEW.md E61). The records with the echo met the budget on both GPUs (E69). A
run is valid only with the usual number of frames submitted during the 6 s stroke
(`details.continuousStroke.framesSubmitted`: about 740 on Intel UHD, 650–700 on RTX 4060), and
only when an unrecorded run right after it agrees within a few milliseconds: the machine can
slow down for part of a run, which the frame count of the continuous stroke does not show (E70).
