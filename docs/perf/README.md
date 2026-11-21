# Performance records

The reference records of the benchmarks in `tests/perf`, measured on the reference hardware
(SPEC §3) by the owner, one benchmark at a time on an idle machine. Recorded, not asserted in
CI (SPEC §11). Each row is one JSON file in this directory with the samples, the details and
the environment. How to run them: [benchmark instructions](../../tests/perf/README.md).

## Baseline: release 1.1.1, 2026-11-21

Every record below comes from one run on `@ngne/core` 0.4.0 with issues #13 and #17. The
[results page](2026-11-21.md) gives the environment, the method, the earlier figures and the
stroke confirmation runs. Earlier records (checkpoint E, the cloud SwiftShader run, the stroke
records without the echo, the 0.4.0 run of 2026-11-20) are in the repository's history: all of
them at `126de90`, all but the run of 2026-11-20 also in tag `v1.1.0`.

| Record | Measurement | Budget | Intel UHD | RTX 4060 |
| ------ | ----------- | ------ | --------- | -------- |
| `se-015-stroke-latency-<gpu>` | Stroke: pointer event to the first frame showing it, NGNE's submit or the stroke echo's redraw; largest of four p95s | 33 ms | 14.5 ms (738 frames) | 13.5 ms (688 frames) |
| `se-062-stroke-latency-symmetric-<gpu>` | The same with symmetry and tiled mode on | 33 ms | 15.0 ms (740 frames) | 13.8 ms (703 frames) |
| `se-010-dirty-rectangle` | 16×16 dirty rectangle over 8 layers at 256², p95 of 5000 calls, Node | 2 ms | 0.019 ms | n/a |
| `se-070-frame-switch-cached-<gpu>` | Frame switch to a cached frame, animation frames to the submit | 1 frame | 1 | 1 |
| `se-070-frame-switch-upload-<gpu>` | Frame switch needing an upload, p95 | 50 ms | 12.5 ms | 22.7 ms |
| `se-024-playback-<gpu>` | Playback from `ed:play`, 64 frames of 256², entries skipped of 128 (`unit: count`) | 0 | 0 | 0 |
| `se-070-idle-<gpu>` | Idle editor, viewport frames per second (`unit: count`) | 0 | 0 | 0 |
| `se-070-cold-load-<gpu>` | Cold load to interactive, production build, largest of 10 after a GPU warm-up | 2 s | 383 ms | 928 ms |
| `se-026-timeline-scroll-<gpu>` | Timeline scroll at 200 frames × 30 layers, mean frame interval | 20 ms | 7.29 ms (137 fps) | 7.36 ms (136 fps) |
| `se-031-wand-pan-<gpu>` | Overlay redraw per pan step over a wand selection at 1024², p95 | none | 3.7 ms | 3.6 ms |
| `se-017-flood-fill` | Flood mask and paint of a 1024² image, slowest of 20, Node | 100 ms | 19.5 ms | n/a |
| `se-031-magic-wand` | Magic wand click on a 1024² document, slowest of 10, Node | 100 ms | 16.4 ms | n/a |
| `se-043-import` | 2048² source to 16 colours at 64², slowest of 20, Node | 500 ms | 43.7 ms | n/a |
| `se-042-autosave-long-tasks` | Longest long task overlapping an autosave snapshot, 25 snapshots, Chrome | 50 ms | 0 ms | n/a |
| `se-044-preview` | Import PNG preview of a 1024² source at the dialog's defaults, largest change, Chrome | 300 ms | 171.5 ms | n/a |
| `se-044-preview-1024-target` | The same to a 1024² target with 256 colours | 300 ms | **434.5 ms** (over) | n/a |

Chrome benchmarks without a GPU column (`se-042`, `se-044`) run without `PERF_GPU`: their work
is on the CPU.

## Reading the records

- **Stroke validity.** A stroke record (`se-015`, `se-062`) is valid only with the usual number
  of frames submitted during the 6 s stroke (`details.continuousStroke.framesSubmitted`: about
  740 on Intel UHD, 650–700 on RTX 4060), and only when an unrecorded run right after it agrees
  within a few milliseconds: the machine can slow down for part of a run, which the frame count
  does not show. `PERF_ECHO=off` measures without the stroke echo and writes a `-no-echo`
  record; the baseline has none.
- **Counts.** `se-024-playback-*`, `se-070-idle-*` and `se-070-frame-switch-cached-*` hold a
  count in `resultMs` (`unit: count`). A frame counts as shown when it was submitted to NGNE
  (`onDrawn`), not when it was presented.
- **No budget.** `se-031-wand-pan-*` is informational: neither SE-031 nor SPEC §6.6 states a
  budget, and the record has no `pass`.
- **Known miss.** `se-044-preview-1024-target` misses 300 ms, as it has since it was first
  recorded; its slowest changes are Floyd–Steinberg dither over a million pixels. It is not
  SE-044's acceptance item, which `se-044-preview` (a 1024² source at the defaults) meets.
- **Other hardware.** A run elsewhere (a cloud container, SwiftShader) is recorded under a
  `PERF_ID` of its own and is no reference (`tests/perf/README.md`).
