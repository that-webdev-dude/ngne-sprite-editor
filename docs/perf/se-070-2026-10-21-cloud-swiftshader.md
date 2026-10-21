# SPEC §6.6 budgets, 2026-10-21, cloud SwiftShader (not reference hardware)

SE-070's performance record of run 4 (docs/tickets/EXECUTION.md, Run 4 in the cloud). Every
number here was measured on a Linux cloud container with Chrome's software WebGPU adapter
(SwiftShader). **None of it is a measurement on the reference hardware of SPEC §3** (Windows 11,
Chrome, Intel UHD and RTX 4060): SE-070's acceptance item "every budget in SPEC §6.6 is recorded
on reference hardware" stays open for the owner (REVIEW.md, Run 4 decisions, H12).

## Environment

| Item     | Value                                                                                        |
| -------- | -------------------------------------------------------------------------------------------- |
| Machine  | Cloud container, Intel Xeon @ 2.80 GHz, 4 cores, 16 GB, Linux 6.18                           |
| GPU      | None: WebGPU adapter `google / swiftshader` (checked by each browser benchmark)              |
| Browser  | Chrome for Testing 156.0.8078.4 (Playwright 1.64's build; Chrome stable could not be fetched) |
| Node     | 24.22.0                                                                                      |
| Commit   | 5c3e5cf (SE-070 with its review fixes)                                                       |
| Method   | `tests/perf/README.md`, "Commands", the cloud block: one benchmark at a time, `PERF_RECORD=1`, `PERF_GPU=swiftshader`, `PERF_ID=se-070-<row>-cloud-swiftshader`; no E2E run, benchmark or agent beside it |
| Time     | 01:37–01:40 UTC                                                                              |

## Results

| SPEC §6.6 row                                         | Budget               | Record                                          | Result                 |
| ----------------------------------------------------- | -------------------- | ----------------------------------------------- | ---------------------- |
| Stroke, pointer event to submitted frame, p95         | ≤ 33 ms              | `se-070-stroke-cloud-swiftshader`               | 28.1 ms (see below)    |
| Dirty-rectangle recomposite, 16 px dab                | ≤ 2 ms               | `se-070-dirty-rectangle-cloud-swiftshader`      | 0.054 ms               |
| Frame switch to a cached frame                        | next animation frame | `se-070-frame-switch-cached-cloud-swiftshader`  | 1 frame (70 of 70)     |
| Frame switch needing an upload, p95                   | ≤ 50 ms              | `se-070-frame-switch-upload-cloud-swiftshader`  | **80.8 ms (over)**     |
| Playback from `ed:play`, 64 frames, 100 ms            | no skipped frames    | `se-070-playback-cloud-swiftshader`             | 0 of 128 skipped       |
| Idle editor, frames submitted per second              | 0                    | `se-070-idle-cloud-swiftshader`                 | 0 (preview 10 fps)     |
| Cold load to interactive, production build, local     | ≤ 2 s                | `se-070-cold-load-cloud-swiftshader`            | 434.3 ms               |

Notes:

- Stroke: the result is the overlay echo's path. During the 6 s stroke SwiftShader submitted
  105 frames, against 650–740 on the reference GPUs, so the validity rule of
  docs/perf/README.md does not hold and the number describes the software adapter only.
  NGNE's own path: p95 127 ms over the continuous stroke.
- Frame switch with upload: medians 61.2 ms in both sweeps; 7 of 189 switches were submitted
  at the first animation frame, most at the fourth. It misses the budget on SwiftShader, where
  every upload and draw is CPU work; whether it misses on the reference GPUs is unknown until
  the owner measures it (REVIEW.md H13).
- Cold load: median 371.9 ms; "Create → first viewport frame" (details, not the result):
  median 243 ms, largest 257.4 ms. Definition of "interactive" in `tests/perf/README.md`.
- Unrecorded runs before the record (the implementing and fixing agents', same container):
  dirty rectangle 0.064 ms; cached switch 1 frame; upload 80.7, 79.5 and 78.4 ms; playback 0 of
  128; idle 0; cold load 399 and 390 ms; stroke 27.0 ms (85 frames).
