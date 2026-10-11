# SE-002 — NGNE integration feasibility (gate G0)

Deliverable of ticket SE-002 ([M0-foundation.md](../tickets/M0-foundation.md)). Spike pages and
runner: `spikes/ngne/`. Engine under test: `@ngne/core` 0.2.1.

Status

<!-- generated:status:begin -->
- Intel UHD: recorded 2026-10-11T22:45:00.469Z at commit 3e81fad.
- RTX 4060: recorded 2026-10-11T22:48:45.903Z at commit 3e81fad+changes.
- SwiftShader: recorded 2026-10-11T22:34:47.460Z at commit 4611d3e+changes.
- Questions: no-go for 8.
<!-- generated:status:end -->

- The SwiftShader run is made by the implementing agent. The Intel UHD and RTX 4060 runs are
  made by the orchestrator, alone on the reference machine
  ([EXECUTION.md](../tickets/EXECUTION.md), Measurements), with the commands of section 2.
- While a deciding result is missing, gate G0 stays Pending and SPEC §6.4 is not amended.

Text between `<!-- generated:… -->` markers is written by `spikes/ngne/runner/tables.ts` from
the raw data. Do not edit it by hand.

## 1. Summary

A row per question. "(S)" marks the questions whose SwiftShader result is part of the
threshold. How the "Go / no-go" column is decided:

- Questions 2–11: both reference GPUs must pass, plus SwiftShader where marked S.
- Question 1: the ticket defines the threshold on Intel UHD. RTX 4060 and SwiftShader are
  recorded and do not decide.
- Question 4 compares two strategies. A GPU is "go" when at least one of (a) and (b) meets its
  threshold; the cell shows both. Which strategy is adopted is a decision (section 4.4).
- A SwiftShader result on a question not marked S is shown as "(recorded)".

<!-- generated:summary:begin -->
| # | Question | Method | Go threshold | Intel UHD | RTX 4060 | SwiftShader | Go / no-go | Consequence for the spec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Upload latency and sustained rate | From a CPU `Uint8ClampedArray`: build bitmap, `texture("ed:f:0")`, `render()`; time to `texture()` resolution and to the next `render()` submitted. 64², 256², 512², 1024²; 200 samples each; then 5 s of replacements requested every animation frame | 256²: p95 ≤ 25 ms to submitted on Intel UHD and ≥ 30 completed replacements/s sustained. Other sizes recorded | go: 256²: p95 to submitted 3.1 ms, 144.17 replacements/s | go (recorded): 256²: p95 to submitted 4.3 ms, 144.02 replacements/s | go (recorded): 256²: p95 to submitted 7.5 ms, 144.16 replacements/s | **go** | None. SPEC §6.6 keeps the echo as a fallback that SE-015 decides with its own measurement. |
| 2 | Single-flight queue | Overlapping `texture()` calls; latest-wins queue during a 5 s continuous stream | Earlier call rejects "superseded"; final content always shown; no starvation (≥ 1 publish per 100 ms) | go: superseded 110/110; largest publish gap 99.4 ms; stale renders 0 | go: superseded 110/110; largest publish gap 57.8 ms; stale renders 0 | go (recorded): superseded 110/110; largest publish gap 47.2 ms; stale renders 0 | **go** | None. SPEC §6.2 #3 and the §6.4 upload queue stand. |
| 3 | Pixel-exact placement, viewport path (S) | `pixelSnap = false`, integer top-left and size; DPR 1, 1.25, 1.5, 2; odd and even document sizes; scales 1, 3, 8 | In-page readback: zero device pixels differ from the expected pattern | go: exact cases at DPR 1, 1.25, 1.5, 2: 84 / 84, 84 / 84, 84 / 84, 84 / 84 | go: exact cases at DPR 1, 1.25, 1.5, 2: 84 / 84, 84 / 84, 84 / 84, 84 / 84 | go: exact cases at DPR 1, 1.25, 1.5, 2: 84 / 84, 84 / 84, 84 / 84, 84 / 84 | **go** | None. SPEC §6.2 #7 and the §6.4 view rules stand. |
| 4 | Renderer replacement vs fixed oversized canvas | (a) Dispose and create on a new canvas 50 times, including overlapping requests serialized by the caller. (b) One canvas with backing = logical = screen size in device pixels, CSS-clipped, window resized 50 times | (a) No errors, one live device after each swap completes, never a blank viewport, median ≤ 250 ms. (b) Correct image, no recreation. Record which is adopted for SPEC §6.4 | go: (a) go: detached go, median 37 ms; detached-redraw go, median 34.5 ms; stacked go, median 34.3 ms. (b) go: 50/50 resizes exact, 1 device | go: (a) go: detached go, median 50.5 ms; detached-redraw go, median 46.7 ms; stacked go, median 47 ms. (b) go: 50/50 resizes exact, 1 device | go (recorded): (a) go: detached go, median 89.8 ms; detached-redraw go, median 90 ms; stacked go, median 88.9 ms. (b) go: 50/50 resizes exact, 1 device | **go** | The adopted strategy is written into SPEC §6.4 (texts for both outcomes are in section 4.4). |
| 5 | Two renderers | Bare `WebGPURenderer` and a `BrowserGame` on two canvases for 60 s; `stop()`/`start()` the game 20 times through a serialized queue; host calls `app.renderer.texture()` after `start()` resolves; dispose and recreate the game on a new canvas 20 times | No diagnostics other than dropped-tick notices; both keep rendering correctly | go: diagnostics (dropped ticks / other) 0 (0) / 0; viewport wrong draws 0; preview wrong frames 0 | go: diagnostics (dropped ticks / other) 0 (0) / 0; viewport wrong draws 0; preview wrong frames 0 | go (recorded): diagnostics (dropped ticks / other) 0 (0) / 0; viewport wrong draws 0; preview wrong frames 0 | **go** | None. SPEC §6.2 #12, #14 and §6.5 stand. |
| 6 | Not-ready textures | Reference an unuploaded slot, then gate on first-upload resolution | Ungated frame is skipped with one diagnostic; gated path produces none | go: ungated: 1 diagnostic, 0, 0 sprites/draw calls; gated: 0 diagnostics | go: ungated: 1 diagnostic, 0, 0 sprites/draw calls; gated: 0 diagnostics | go (recorded): ungated: 1 diagnostic, 0, 0 sprites/draw calls; gated: 0 diagnostics | **go** | None. SPEC §6.2 #5 stands. |
| 7 | Readback and screenshots (S) | `readCanvas` after `render()` and inside `afterFrame`; Playwright screenshot of the same canvas; DPR 1.5 emulation; `devicePixelContentBoxSize` under emulation | Readback exact for opaque texels in all modes; screenshot exact at DPR 1 | go: DPR 1: readback 0 px differ, afterFrame wrong 0, screenshots exact/exact; DPR 1.5 emulated: readback 0 px differ, afterFrame wrong 0, screenshots exact/exact; DPR 1.5: readback 0 px differ, afterFrame wrong 0, screenshots exact/exact | go: DPR 1: readback 0 px differ, afterFrame wrong 0, screenshots exact/exact; DPR 1.5 emulated: readback 0 px differ, afterFrame wrong 0, screenshots exact/exact; DPR 1.5: readback 0 px differ, afterFrame wrong 0, screenshots exact/exact | go: DPR 1: readback 0 px differ, afterFrame wrong 0, screenshots exact/exact; DPR 1.5 emulated: readback 0 px differ, afterFrame wrong 0, screenshots exact/exact; DPR 1.5: readback 0 px differ, afterFrame wrong 0, screenshots exact/exact | **go** | SPEC §6.7 stands. For tests at a DPR other than 1 see finding 7.1 (section 4.7). |
| 8 | Device loss | Wrap `GPUAdapter.prototype.requestDevice` before creating the renderer, keep the device, call `destroy()` | NGNE returns to `ready` and manual slots show their content again within 2 s; polling per SPEC §6.4 redraws without user input | no-go: ready after 45.9, 26.1, 27.1 ms; idle viewport redrawn 0/5 losses | no-go: ready after 45.2, 39.7, 43.7 ms; idle viewport redrawn 1/5 losses | no-go (recorded): ready after 56.6, 54, 56.2 ms; idle viewport redrawn 1/5 losses | **no-go** (Intel UHD, RTX 4060) | No fallback is defined by the ticket or the SPEC: owner decision. Candidate measured in section 4.8: also treat `renderer.sprites === 0` after a draw as a loss. |
| 9 | Odd sizes through `BrowserGame` (S) | 33×33 and 32×32 sprites drawn by a scene with default `pixelSnap` and with snapping off; even-padded rect per SPEC §9.2 | With snap off and with even rects under default snap: readback exact. Odd rect under default snap: result recorded (expected misaligned) | go: snap off 6/6; default snap, even rects 4/4; odd rect differs by 0, 0 px | go: snap off 6/6; default snap, even rects 4/4; odd rect differs by 1089, 1089 px | go: snap off 6/6; default snap, even rects 4/4; odd rect differs by 1089, 1089 px | **go** | None. SPEC §9.2 (even rectangles) and §6.5 (snap off) stand. |
| 10 | `ngne-preview` acceptance | Hand-written config per SPEC §9.5 with an odd-source, even-rect frame; run `node node_modules/@ngne/core/dist/preview/cli.js`; open the printed URL | Page status starts with `Ready`, no error text | go: status "Ready · renderer ready", error text (empty) | go: status "Ready · renderer ready", error text (empty) | go (recorded): status "Ready · renderer ready", error text (empty) | **go** | None. SPEC §9.5 and §9.7 item 2 stand. |
| 11 | Slot memory | `renderer.inspect()` after filling all slots at 1024² and after replacing them with 1×1 images | Estimated texture bytes fall back to within 1 MB of baseline | go: 56 bytes above baseline after 1×1 replacement | go: 56 bytes above baseline after 1×1 replacement | go (recorded): 56 bytes above baseline after 1×1 replacement | **go** | None. SPEC §6.2 #4 (1×1 placeholders) stands. |
<!-- generated:summary:end -->

## 2. Commands

Run from the repository root, alone on the machine, after `npm ci`. Chrome (installed, stable
channel) is started by Playwright in new headless mode; no window has to stay in front.

| GPU         | Command                                                  | Writes                                      |
| ----------- | -------------------------------------------------------- | ------------------------------------------- |
| Intel UHD   | `node spikes/ngne/runner/run.ts --gpu=intel-uhd`         | `docs/spikes/data/se-002-intel-uhd.json`    |
| RTX 4060    | `node spikes/ngne/runner/run.ts --gpu=rtx-4060`          | `docs/spikes/data/se-002-rtx-4060.json`     |
| SwiftShader | `node spikes/ngne/runner/run.ts --gpu=swiftshader`       | `docs/spikes/data/se-002-swiftshader.json`  |
| Tables      | `node spikes/ngne/runner/tables.ts`                      | the generated blocks of this document       |

- The GPU can also be given as `SPIKE_GPU=intel-uhd`. The dev-server port is `PORT` or a free
  port.
- The runner needs no `package.json` script. Node 24 runs the TypeScript files directly.
- Duration: the SwiftShader run took about 4.5 minutes under load from other agents. A hardware
  run is expected to take about the same (questions 5 and 8 have fixed lengths of 60 s and
  about 50 s). No page waits longer than 25 minutes for a result.
- Exit code 0: every question produced a result (go or no-go) and the file was written.
  1: a page produced no result (the file is still written and the question is marked
  "incomplete run"). 2: wrong adapter, nothing written. 64: bad arguments.
- Options: `--only=1,4` (subset; written only with `--out=<file>`), `--quick` (short runs for
  debugging; never written to `docs/spikes/data`), `--out=<file>`, `--headed`, `--probe`
  (adapter check only), `--chrome-arg=<flag>` (repeatable).
- Type check of the spike sources (not part of `npm run check`):
  `npx tsc -p spikes/ngne/tsconfig.json` and `npx tsc -p spikes/ngne/tsconfig.node.json`.

GPU selection

NGNE calls `requestAdapter()` without a power preference, so Chrome's flags choose the adapter.
The mapping below was checked on the reference machine with `--probe` (adapter info only, no
timing), headless and headed:

| Requested   | Chrome flags added by the runner                                                        | Adapter info required    |
| ----------- | --------------------------------------------------------------------------------------- | ------------------------ |
| Intel UHD   | `--force-low-power-gpu`                                                                 | `intel` / `gen-12…`      |
| RTX 4060    | `--force-high-performance-gpu`                                                          | `nvidia` / `lovelace`    |
| SwiftShader | `--use-webgpu-adapter=swiftshader --enable-unsafe-webgpu --enable-unsafe-swiftshader`   | `google` / `swiftshader` |

- The runner reads the adapter from a probe page (the same `requestAdapter()` call NGNE makes)
  and from every device NGNE creates (`GPUAdapter.prototype.requestDevice` wrap). If either is
  not the adapter requested it prints a `WRONG WEBGPU ADAPTER` block, writes nothing and exits
  with code 2.
- `--force-high-performance-gpu` moves Chrome's whole GPU process (compositor and Canvas2D
  included) to the NVIDIA GPU, as the Windows graphics setting would.
- `--use-webgpu-power-preference=force-high-performance` returned no adapter at all on this
  machine and is not used.
- On Windows the SwiftShader list of NGNE's Linux CI (with `--use-angle=vulkan`) leaves Chrome
  without any WebGPU adapter. The runner uses the three flags above on Windows and the CI list
  elsewhere.
- Every Chrome instance also gets `--force-device-scale-factor=<DPR>` matching the context's
  `deviceScaleFactor` (finding 7.1).

## 3. Environment

<!-- generated:environment:begin -->
|  | Intel UHD | RTX 4060 | SwiftShader |
| --- | --- | --- | --- |
| Recorded (UTC) | 2026-10-11T22:45:00.469Z | 2026-10-11T22:48:45.903Z | 2026-10-11T22:34:47.460Z |
| Commit | 3e81fad | 3e81fad+changes | 4611d3e+changes |
| Command | `node spikes/ngne/runner/run.ts --gpu=intel-uhd` | `node spikes/ngne/runner/run.ts --gpu=rtx-4060` | `node spikes/ngne/runner/run.ts --gpu=swiftshader` |
| Raw data | [data/se-002-intel-uhd.json](data/se-002-intel-uhd.json) | [data/se-002-rtx-4060.json](data/se-002-rtx-4060.json) | [data/se-002-swiftshader.json](data/se-002-swiftshader.json) |
| WebGPU adapter (vendor / architecture) | intel / gen-12lp | nvidia / lovelace | google / swiftshader |
| Fallback adapter | false | false | true |
| Chrome | 154.0.8037.98, new headless | 154.0.8037.98, new headless | 154.0.8037.98, new headless |
| Chrome arguments | `--force-color-profile=srgb --force-low-power-gpu` and `--force-device-scale-factor=<DPR>` | `--force-color-profile=srgb --force-high-performance-gpu` and `--force-device-scale-factor=<DPR>` | `--force-color-profile=srgb --use-webgpu-adapter=swiftshader --enable-unsafe-webgpu --enable-unsafe-swiftshader` and `--force-device-scale-factor=<DPR>` |
| OS | Windows NT 10.0.26200.9457 (kernel32 10.0.26100.9444) | Windows NT 10.0.26200.9457 (kernel32 10.0.26100.9444) | Windows NT 10.0.26200.9457 (kernel32 10.0.26100.9444) |
| CPU | 12th Gen Intel(R) Core(TM) i7-12650H x16 | 12th Gen Intel(R) Core(TM) i7-12650H x16 | 12th Gen Intel(R) Core(TM) i7-12650H x16 |
| Memory (GB) | 16 | 16 | 16 |
| GPU0 (chrome://gpu) | VENDOR= 0x8086, DEVICE=0x46a3 [Intel(R) UHD Graphics], SUBSYS=0x13b91462, REV=12, LUID={0,68648}, DRIVER_VENDOR=Intel, DRIVER_VERSION=31.0.101.4314 *ACTIVE* | VENDOR= 0x8086, DEVICE=0x46a3 [Intel(R) UHD Graphics], SUBSYS=0x13b91462, REV=12, LUID={0,68648}, DRIVER_VENDOR=NVIDIA, DRIVER_VERSION=31.0.101.4314 | VENDOR= 0x8086, DEVICE=0x46a3 [Intel(R) UHD Graphics], SUBSYS=0x13b91462, REV=12, LUID={0,68648}, DRIVER_VENDOR=Intel, DRIVER_VERSION=31.0.101.4314 *ACTIVE* |
| GPU1 (chrome://gpu) | VENDOR= 0x10de, DEVICE=0x28a0 [NVIDIA GeForce RTX 4060 Laptop GPU], SUBSYS=0x13b91462, REV=161, LUID={0,69729}, DRIVER_VERSION=32.0.16.1078 | VENDOR= 0x10de, DEVICE=0x28a0 [NVIDIA GeForce RTX 4060 Laptop GPU], SUBSYS=0x13b91462, REV=161, LUID={0,69729}, DRIVER_VERSION=32.0.16.1078 *ACTIVE* | VENDOR= 0x10de, DEVICE=0x28a0 [NVIDIA GeForce RTX 4060 Laptop GPU], SUBSYS=0x13b91462, REV=161, LUID={0,69729}, DRIVER_VERSION=32.0.16.1078 |
| GL_RENDERER (compositor) | ANGLE (Intel, Intel(R) UHD Graphics (0x000046A3) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.101.4314) | ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028A0) Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.16.1078) | ANGLE (Intel, Intel(R) UHD Graphics (0x000046A3) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.101.4314) |
| Node | v24.15.0 | v24.15.0 | v24.15.0 |
| @ngne/core / Playwright / Vite | 0.2.1 / 1.64.0 / 8.3.4 | 0.2.1 / 1.64.0 / 8.3.4 | 0.2.1 / 1.64.0 / 8.3.4 |
<!-- generated:environment:end -->

- The SwiftShader data was recorded from the SE-002 working tree before its commit, so its
  commit field reads `<base>+changes`.
- Timing in the SwiftShader column was taken while other agents loaded the CPU. It is not a
  reference measurement and no timing threshold depends on it.
- New headless Chrome delivered animation frames at the display's refresh rate on this machine,
  not at a fixed 60 Hz. The rate is recorded with question 1.

## 4. Results by question

Each page publishes a result with checks. Checks named in the thresholds decide go / no-go;
other observations are "recorded". Each generated block lists the numbers per GPU and every
check that did not hold.

### 4.1 Upload latency and sustained rate

Page `spikes/ngne/pages/q01-upload.ts`. Canvas 1024×1024, one slot `ed:f:0`.

- Per size (64², 256², 512², 1024²), 200 samples after 10 warm-up samples. Each sample starts
  at a random phase of the frame, paints a 16 px dab into the `Uint8ClampedArray`, builds the
  bitmap (`premultiplyAlpha: "none"`, `colorSpaceConversion: "none"`), awaits `texture()` and
  calls `render()` at once. Recorded: bitmap time, time to `texture()` resolved, time to
  `render()` returned ("submitted").
- A second series of 200 samples per size draws in the next animation frame after the upload
  resolves, as the on-demand viewport of SPEC §6.4 does. It is recorded, not part of the
  threshold.
- Then 5 s per size: a replacement is requested every animation frame through the upload queue
  of SPEC §6.4 (one in flight, latest wins). Completed replacements per second = publishes in
  the window ÷ window length.
- Threshold checks: 256² p95 to submitted ≤ 25 ms (first series) and 256² ≥ 30 completed
  replacements/s. The same two checks on the other sizes are recorded.

<!-- generated:q1:begin -->
Result: **go**. Intel UHD go · RTX 4060 go (recorded, does not decide) · SwiftShader go (recorded, does not decide).

| Measure | Intel UHD | RTX 4060 | SwiftShader |
| --- | --- | --- | --- |
| 64² to texture() resolved, median / p95 / max (ms) | 1.6 / 3.8 / 8.3 | 2 / 4.2 / 6.1 | 2.4 / 6.4 / 9.6 |
| 64² to render() submitted, median / p95 / max (ms) | 1.7 / 3.9 / 8.5 | 2.2 / 4.3 / 6.5 | 2.6 / 6.6 / 9.6 |
| 64² to submitted in the next animation frame, median / p95 (ms) | 3.1 / 8.6 | 3.8 / 9.5 | 4.9 / 9.1 |
| 64² sustained completed replacements/s (animation frames/s) | 144.16 (144.16) | 143.96 (144.16) | 144.1 (144.1) |
| 256² to texture() resolved, median / p95 / max (ms) | 1.6 / 2.9 / 4.3 | 1.9 / 4.1 / 9.1 | 5.2 / 7.4 / 9.5 |
| 256² to render() submitted, median / p95 / max (ms) | 1.7 / 3.1 / 4.4 | 1.9 / 4.3 / 9.4 | 5.3 / 7.5 / 9.6 |
| 256² to submitted in the next animation frame, median / p95 (ms) | 3.1 / 8.3 | 3.8 / 9.2 | 8.1 / 12.4 |
| 256² sustained completed replacements/s (animation frames/s) | 144.17 (144.17) | 144.02 (144.02) | 144.16 (144.16) |
| 512² to texture() resolved, median / p95 / max (ms) | 1.9 / 2.8 / 3.3 | 2.2 / 3.5 / 4.8 | 10.9 / 14.6 / 15.9 |
| 512² to render() submitted, median / p95 / max (ms) | 2 / 2.8 / 3.4 | 2.2 / 3.6 / 5.2 | 11 / 14.6 / 16 |
| 512² to submitted in the next animation frame, median / p95 (ms) | 3.2 / 8.7 | 4.2 / 9 | 11.7 / 17.6 |
| 512² sustained completed replacements/s (animation frames/s) | 144.04 (144.04) | 143.82 (144.02) | 75.18 (144.17) |
| 1024² to texture() resolved, median / p95 / max (ms) | 4.1 / 5.2 / 13 | 3.8 / 5.5 / 6.7 | 30.9 / 36.3 / 40.2 |
| 1024² to render() submitted, median / p95 / max (ms) | 4.2 / 5.3 / 13.1 | 3.9 / 5.6 / 6.8 | 30.9 / 36.5 / 40.3 |
| 1024² to submitted in the next animation frame, median / p95 (ms) | 5.2 / 10.4 | 4.5 / 10.2 | 31.2 / 37.2 |
| 1024² sustained completed replacements/s (animation frames/s) | 144.09 (144.09) | 144.03 (144.03) | 29.19 (88.97) |

Checks that did not hold (failed checks decide the result; recorded ones do not):

- SwiftShader — recorded: 1024²: p95 to submitted <= 25 ms — p95 36.5 ms
- SwiftShader — recorded: 1024²: >= 30 completed replacements/s sustained — 29.19/s over 5 s; by second 29, 29, 29, 30, 29
- SwiftShader — recorded: 1024²: p95 to submitted in the next animation frame <= 25 ms — p95 37.2 ms
<!-- generated:q1:end -->

Consequence for the spec

- Go: none. SPEC §6.6 keeps the stroke echo as a fallback that SE-015 decides with its own
  measurement of the whole stroke path.
- No-go: SPEC §6.6 is amended so that the overlay stroke echo is required, SE-015 implements
  it, and the amendment is recorded in REVIEW.md.

### 4.2 Single-flight queue

Page `spikes/ngne/pages/q02-single-flight.ts`. 256² uniform textures whose colour encodes a
sequence number; the canvas is read back after each draw.

- 50 groups of two or three `texture()` calls issued in the same task, and 50 pairs whose
  second call is issued one task later. Every earlier call that was still unsettled must reject
  with a message containing "superseded"; the last call must resolve and be the one shown.
- 5 s stream: a request about every 2 ms through the SPEC §6.4 queue. Every draw must show the
  newest published sequence number, the last request must be shown after the queue drains, and
  the largest gap between publishes (including stream start and end) must be ≤ 100 ms.
- Recorded only: the same stream for 2 s with direct `texture()` calls and no queue.

<!-- generated:q2:begin -->
Result: **go**. Intel UHD go · RTX 4060 go · SwiftShader go (recorded, does not decide).

| Measure | Intel UHD | RTX 4060 | SwiftShader |
| --- | --- | --- | --- |
| Overlapping calls: earlier calls rejected as superseded | 110/110 | 110/110 | 110/110 |
| Queue stream: requests/s, publishes/s | 404.2, 401 | 406.18, 402.18 | 331.19, 213 |
| Queue stream: largest gap between publishes (ms) | 99.4 | 57.8 | 47.2 |
| Queue stream: stale renders / renders | 0 / 682 | 0 / 680 | 0 / 693 |
| Without a queue: calls, published during the stream, superseded | 922, 899, 22 | 931, 907, 24 | 904, 0, 903 |

Every check held on the GPUs measured.
<!-- generated:q2:end -->

Consequence for the spec

- Go: none. SPEC §6.2 #3 and the §6.4 upload queue stand.
- No-go: no fallback is defined by the ticket or the SPEC. A starvation failure alone has the
  same remedy as question 1 (stroke echo, SPEC §6.6).

### 4.3 Pixel-exact placement, viewport path (S)

Page `spikes/ngne/pages/q03-placement.ts`, one run per DPR (1, 1.25, 1.5, 2).

- The viewport element is 801×601 CSS px at offset 7,5. Canvas backing size = renderer logical
  size = the element's `devicePixelContentBoxSize`.
- 7 document sizes (32×32, 33×33, 33×32, 16×31, 64×64, 1×1, 255×256) × scales 1, 3, 8 ×
  top-left origins (0,0), (7,5), (10,11), (−3,−2): 84 cases per DPR. `pixelSnap = false`, quad
  centre = origin + size ÷ 2. Every device pixel of the readback is compared with the expected
  pattern (opaque texels, each different from its neighbours).
- Recorded only: the same 84 quads with the default `pixelSnap = true`.

<!-- generated:q3:begin -->
Result: **go**. Intel UHD go · RTX 4060 go · SwiftShader go.

| Measure | Intel UHD | RTX 4060 | SwiftShader |
| --- | --- | --- | --- |
| [DPR 1] Backing size (device px) of the 801x601 CSS px viewport | 801x601 | 801x601 | 801x601 |
| [DPR 1] pixelSnap off: exact cases / cases | 84 / 84 | 84 / 84 | 84 / 84 |
| [DPR 1] pixelSnap off: differing device pixels | 0 | 0 | 0 |
| [DPR 1] Default pixelSnap: misaligned cases / cases (recorded) | 0 / 84 | 32 / 84 | 32 / 84 |
| [DPR 1.25] Backing size (device px) of the 801x601 CSS px viewport | 1001x752 | 1001x752 | 1001x752 |
| [DPR 1.25] pixelSnap off: exact cases / cases | 84 / 84 | 84 / 84 | 84 / 84 |
| [DPR 1.25] pixelSnap off: differing device pixels | 0 | 0 | 0 |
| [DPR 1.25] Default pixelSnap: misaligned cases / cases (recorded) | 0 / 84 | 32 / 84 | 32 / 84 |
| [DPR 1.5] Backing size (device px) of the 801x601 CSS px viewport | 1201x901 | 1201x901 | 1201x901 |
| [DPR 1.5] pixelSnap off: exact cases / cases | 84 / 84 | 84 / 84 | 84 / 84 |
| [DPR 1.5] pixelSnap off: differing device pixels | 0 | 0 | 0 |
| [DPR 1.5] Default pixelSnap: misaligned cases / cases (recorded) | 0 / 84 | 32 / 84 | 32 / 84 |
| [DPR 2] Backing size (device px) of the 801x601 CSS px viewport | 1602x1202 | 1602x1202 | 1602x1202 |
| [DPR 2] pixelSnap off: exact cases / cases | 84 / 84 | 84 / 84 | 84 / 84 |
| [DPR 2] pixelSnap off: differing device pixels | 0 | 0 | 0 |
| [DPR 2] Default pixelSnap: misaligned cases / cases (recorded) | 0 / 84 | 32 / 84 | 32 / 84 |

Checks that did not hold (failed checks decide the result; recorded ones do not):

- Intel UHD, DPR 1 — recorded: Default pixelSnap misaligns some of the same quads (expected; recorded per adapter) — 0/84 cases differ with pixelSnap = true
- Intel UHD, DPR 1.25 — recorded: Default pixelSnap misaligns some of the same quads (expected; recorded per adapter) — 0/84 cases differ with pixelSnap = true
- Intel UHD, DPR 1.5 — recorded: Default pixelSnap misaligns some of the same quads (expected; recorded per adapter) — 0/84 cases differ with pixelSnap = true
- Intel UHD, DPR 2 — recorded: Default pixelSnap misaligns some of the same quads (expected; recorded per adapter) — 0/84 cases differ with pixelSnap = true
<!-- generated:q3:end -->

Consequence for the spec

- Go: none. SPEC §6.2 #7 and the §6.4 view rules stand.
- No-go: no fallback is defined by the ticket or the SPEC.

### 4.4 Renderer replacement vs fixed oversized canvas

Page `spikes/ngne/pages/q04-sizing.ts`. Scene: checker slot, a half-transparent current frame
over it, a second frame beside it; all 14 viewport slots are uploaded (the unused ones with a
1×1 transparent image). Live devices are counted with the `requestDevice` wrap.

(a) Replacement, in the SPEC §6.4 order (create on a new canvas, upload every slot, draw once,
swap, dispose the old instance). Three variants of "swap":

| Variant           | New canvas while it loads           | At the swap                           |
| ----------------- | ----------------------------------- | ------------------------------------- |
| `detached`        | not in the document                 | replaces the old canvas               |
| `detached-redraw` | not in the document                 | replaces it and is drawn once more    |
| `stacked`         | in the document, under the old one  | the old canvas is removed             |

- Timing pass per variant: 50 swaps across five backing sizes, 25 one at a time and 25 in
  bursts of five overlapping requests that the caller serializes. Checks: no error or
  diagnostic, exactly one live device at the end of each swap, the first draw of each new
  renderer exact by readback, median swap time ≤ 250 ms.
- Blank check per variant: a second pass of 50 swaps, one at a time, driven by the runner, with
  a screenshot of the 900×640 region common to all sizes after every swap and continuously
  during swaps. Every screenshot must equal the expected image. The timing pass is kept free
  of screenshots so they do not load it. This samples the screen; a blank lasting less than
  the interval between two screenshots can be missed.
- Control (recorded): the wrong order on purpose (old canvas removed before the new one draws).
  It shows that the screenshots do see a blank viewport.
- (a) is go when at least one variant passes both passes.

(b) Fixed oversized canvas: backing = logical = `ceil(screen × devicePixelRatio)`, CSS size
backing ÷ DPR, clipped by a window-sized element with `overflow: hidden`. The runner resizes
the window 50 times (640×480 up to the screen size 1920×1080). After each resize the page
redraws with a marker anchored to the viewport's bottom-right corner and reads back the whole
canvas; the runner compares a screenshot of the window. Checks: every readback and screenshot
exact, one device for the whole run, no diagnostic. A run at DPR 1.5 (screen 1707×1067 CSS px,
10 resizes) is recorded.

<!-- generated:q4:begin -->
Result: **go**. Intel UHD go · RTX 4060 go · SwiftShader go (recorded, does not decide).

| Measure | Intel UHD | RTX 4060 | SwiftShader |
| --- | --- | --- | --- |
| [a detached auto] (a) detached: swap time median / p95 / max (ms) | 37 / 46.6 / 49.9 | 50.5 / 59.7 / 66.7 | 89.8 / 101.8 / 122.2 |
| [a detached auto] (a) detached: swaps with one live device, exact first draw | 50/50, 50/50 | 50/50, 50/50 | 50/50, 50/50 |
| [a detached auto] (a) detached: render() to GPU work done, median (ms) at 1280x720 (recorded) | 3.6 | 3.5 | 3.1 |
| [a detached step] (a) detached: screenshots exact / taken (blank) | 144 / 144 (0) | 151 / 151 (0) | 158 / 158 (0) |
| [a detached-redraw auto] (a) detached-redraw: swap time median / p95 / max (ms) | 34.5 / 40.5 / 47.2 | 46.7 / 57.6 / 64 | 90 / 97.8 / 100.3 |
| [a detached-redraw auto] (a) detached-redraw: swaps with one live device, exact first draw | 50/50, 50/50 | 50/50, 50/50 | 50/50, 50/50 |
| [a detached-redraw auto] (a) detached-redraw: render() to GPU work done, median (ms) at 1280x720 (recorded) | 5 | 3.8 | 4.2 |
| [a detached-redraw step] (a) detached-redraw: screenshots exact / taken (blank) | 148 / 148 (0) | 149 / 149 (0) | 154 / 154 (0) |
| [a stacked auto] (a) stacked: swap time median / p95 / max (ms) | 34.3 / 39.3 / 45.3 | 47 / 55 / 80.1 | 88.9 / 97.2 / 102.4 |
| [a stacked auto] (a) stacked: swaps with one live device, exact first draw | 50/50, 50/50 | 50/50, 50/50 | 50/50, 50/50 |
| [a stacked auto] (a) stacked: render() to GPU work done, median (ms) at 1280x720 (recorded) | 3.8 | 3.7 | 4 |
| [a stacked step] (a) stacked: screenshots exact / taken (blank) | 138 / 138 (0) | 150 / 150 (0) | 156 / 156 (0) |
| [a control step] (a) control: screenshots exact / taken (blank) | 22 / 32 (10) | 22 / 32 (10) | 21 / 38 (17) |
| [b DPR 1] (b) backing size (device px) | 1920x1080 | 1920x1080 | 1920x1080 |
| [b DPR 1] (b) resizes with exact readback | 50/50 | 50/50 | 50/50 |
| [b DPR 1] (b) devices created | 1 | 1 | 1 |
| [b DPR 1] (b) render() to GPU work done, median (ms) at full backing size (recorded) | 3.8 | 3.8 | 6.3 |
| [b DPR 1] (b) DPR 1: screenshots exact / resizes | 50 / 50 | 50 / 50 | 50 / 50 |
| [b DPR 1.5] (b) backing size (device px) | 2561x1601 | 2561x1601 | 2561x1601 |
| [b DPR 1.5] (b) resizes with exact readback | 10/10 | 10/10 | 10/10 |
| [b DPR 1.5] (b) devices created | 1 | 1 | 1 |
| [b DPR 1.5] (b) render() to GPU work done, median (ms) at full backing size (recorded) | 3.8 | 3.6 | 11.4 |
| [b DPR 1.5] (b) DPR 1.5: screenshots exact / resizes | 10 / 10 | 10 / 10 | 10 / 10 |

Every check held on the GPUs measured.
<!-- generated:q4:end -->

Consequence for the spec

The ticket and the SPEC do not say how the adopted strategy is chosen when both pass ("if it
wins"). That choice is left to checkpoint B. Facts that bear on it:

- (a) is the SPEC's current default. Its cost is one renderer replacement per settled resize.
- (b) removes replacement on resize but not entirely: the logical size is fixed at creation, so
  a change of the screen size in device pixels (DPR change, move to another display, a window
  spanning displays) still needs the replacement of (a).
- (b) renders and composites the whole screen-sized canvas even when the viewport is small.
  The rows "render() to GPU work done" record the median time from `render()` to
  `queue.onSubmittedWorkDone()` over 30 draws, for the last canvas of each (a) variant and for
  the oversized canvas of (b).
- At a fractional DPR the screen size in device pixels is not always `screen.width × DPR`
  (1707 × 1.5 = 2560.5), so (b) rounds up and the canvas can be one pixel larger than the screen.

Text for SPEC §6.4, second Lifecycle bullet, if (a) is adopted:

> - Sizing (decided by SE-002 question 4): canvas backing size = the viewport element's size in
>   device pixels (`devicePixelContentBoxSize`); a size or DPR change replaces the renderer
>   after 120 ms of quiet, with the old canvas CSS-stretched until the swap. The fixed
>   oversized canvas was evaluated and not adopted.

Text for SPEC §6.4, second Lifecycle bullet, if (b) is adopted:

> - Sizing (decided by SE-002 question 4): one canvas whose backing size and renderer logical
>   size are the screen size in device pixels (`ceil(screen.width × devicePixelRatio)` by
>   `ceil(screen.height × devicePixelRatio)`). Its CSS size is the backing size ÷
>   `devicePixelRatio`; it sits at the viewport element's top-left and is clipped by it
>   (`overflow: hidden`). A viewport resize does not replace the renderer; it marks the view
>   dirty. The renderer is replaced, in the order above, only when the screen size in device
>   pixels changes (DPR change, move to another display) or the viewport element becomes
>   larger than the canvas. View state and pointer mapping use the viewport element's
>   `devicePixelContentBoxSize`.

If the adopted (a) variant is not `detached`, the first Lifecycle bullet also has to say where
the new canvas is while it loads (the variant table above).

### 4.5 Two renderers

Page `spikes/ngne/pages/q05-two-renderers.ts`, 60 s.

- Viewport: bare `WebGPURenderer`, 512×512. Every 250 ms a dab is painted, the slot is uploaded
  through the queue and the canvas is drawn in the next animation frame; every draw is read
  back and compared with the buffer that was uploaded.
- Preview: `BrowserGame`, 64×64 logical, `pixelSnap = false`, a four-frame animation from
  `pv:atlas`. The host uploads the atlas after `start()` resolves and the render callback draws
  nothing before that. Every frame is read back in `afterFrame`.
- Timeline: 10 s steady; 20 × `stop()` then `start()` plus the atlas upload, both issued in the
  same task through one serialized queue; 20 × dispose and recreate on a new canvas; steady
  until 60 s. After each start the preview must show three exact frames within 5 s.
- Checks: no diagnostic other than dropped-tick notices (`{ type: "overload" }`) from either
  renderer, every lifecycle call resolved, no wrong viewport draw or preview frame, both
  renderers `ready` and the game `Running` at the end.

<!-- generated:q5:begin -->
Result: **go**. Intel UHD go · RTX 4060 go · SwiftShader go (recorded, does not decide).

| Measure | Intel UHD | RTX 4060 | SwiftShader |
| --- | --- | --- | --- |
| Run length (s) | 60.01 | 60.01 | 60.01 |
| Viewport draws exact / wrong | 238 / 0 | 237 / 0 | 237 / 0 |
| Preview frames exact / wrong | 8573 / 0 | 8493 / 0 | 8429 / 0 |
| Diagnostics: dropped-tick notices (ticks) / other | 0 (0) / 0 | 0 (0) / 0 | 0 (0) / 0 |
| Preview frames per second at the end | 143.97 | 143.9 | 143.89 |

Every check held on the GPUs measured.
<!-- generated:q5:end -->

Consequence for the spec

- Go: none. SPEC §6.2 #12, #14 and §6.5 stand.
- No-go: no fallback is defined by the ticket or the SPEC (SPEC §13 lists only "preview stops
  when hidden", which §6.5 already requires).

### 4.6 Not-ready textures

Page `spikes/ngne/pages/q06-not-ready.ts`.

- Ungated: a frame that references `ed:f:0` before any upload. Checks: `renderer.sprites` and
  `renderer.drawCalls` are 0 after `render()` (nothing submitted) and `onError` received exactly
  one diagnostic. Recorded: five more ungated frames, and the same frame after the upload.
- Gated: a new renderer draws every animation frame while the upload is in flight and adds the
  slot to the frame only after `texture()` resolved. Checks: no diagnostic, exact readback.
- Recorded: the same mistake inside a `BrowserGame`.

<!-- generated:q6:begin -->
Result: **go**. Intel UHD go · RTX 4060 go · SwiftShader go (recorded, does not decide).

| Measure | Intel UHD | RTX 4060 | SwiftShader |
| --- | --- | --- | --- |
| Ungated: diagnostics after 1 frame / after 6 frames | 1 / 1 | 1 / 1 | 1 / 1 |
| Ungated: diagnostic text | Texture is not ready: ed:f:0 | Texture is not ready: ed:f:0 | Texture is not ready: ed:f:0 |
| Ungated: sprites, draw calls submitted | 0, 0 | 0, 0 | 0, 0 |
| Gated: diagnostics | 0 | 0 | 0 |
| BrowserGame ungated (recorded): diagnostics, lifecycle | 1, Running | 1, Running | 1, Running |

Every check held on the GPUs measured.
<!-- generated:q6:end -->

Consequence for the spec

- Go: none. SPEC §6.2 #5 stands.
- No-go: no fallback is defined by the ticket or the SPEC.

### 4.7 Readback and screenshots (S)

Page `spikes/ngne/pages/q07-readback.ts`, three runs: DPR 1; "DPR 1.5 emulated" (Playwright
`deviceScaleFactor: 1.5` on a browser whose own scale is 1, the ticket's "DPR 1.5 emulation");
DPR 1.5 (browser started with `--force-device-scale-factor=1.5` as well).

- Bare renderer, 96×66: `readCanvas` in the task of `render()` must be exact. Recorded: the
  same readback after a microtask, in a later task, and two animation frames later.
- `BrowserGame`, 48×36 logical shown at 3 device px per logical px: `readCanvas` in
  `afterFrame` must be exact for 10 frames.
- The runner takes a Playwright screenshot of each canvas element and compares it with the
  expected image. It decides the result at DPR 1 and is recorded at DPR 1.5.
- Recorded: `devicePixelContentBoxSize` of both canvases and of five boxes; channel error of
  partially transparent texels against a blend over the clear colour.

<!-- generated:q7:begin -->
Result: **go**. Intel UHD go · RTX 4060 go · SwiftShader go.

| Measure | Intel UHD | RTX 4060 | SwiftShader |
| --- | --- | --- | --- |
| [DPR 1] Readback after render(): differing pixels | 0 | 0 | 0 |
| [DPR 1] Readback in afterFrame: frames exact / wrong | 13 / 0 | 13 / 0 | 13 / 0 |
| [DPR 1] Readback after a microtask / in the next task / two frames later: differing pixels (recorded) | 0 / 6336 / 6336 | 0 / 6336 / 6336 | 0 / 6336 / 6336 |
| [DPR 1] Partially transparent texels: largest channel error | 0.63 | 0.63 | 0.49 |
| [DPR 1] devicePixelContentBoxSize of the two canvases | 96x66, 144x108 | 96x66, 144x108 | 96x66, 144x108 |
| [DPR 1] Screenshot of the bare renderer canvas | exact | exact | exact |
| [DPR 1] Screenshot of the BrowserGame canvas | exact | exact | exact |
| [DPR 1.5 emulated] Readback after render(): differing pixels | 0 | 0 | 0 |
| [DPR 1.5 emulated] Readback in afterFrame: frames exact / wrong | 14 / 0 | 13 / 0 | 13 / 0 |
| [DPR 1.5 emulated] Readback after a microtask / in the next task / two frames later: differing pixels (recorded) | 0 / 6336 / 6336 | 0 / 6336 / 6336 | 0 / 6336 / 6336 |
| [DPR 1.5 emulated] Partially transparent texels: largest channel error | 0.63 | 0.63 | 0.49 |
| [DPR 1.5 emulated] devicePixelContentBoxSize of the two canvases | 64x44, 96x72 | 64x44, 96x72 | 64x44, 96x72 |
| [DPR 1.5 emulated] Screenshot of the bare renderer canvas | exact | exact | exact |
| [DPR 1.5 emulated] Screenshot of the BrowserGame canvas | exact | exact | exact |
| [DPR 1.5] Readback after render(): differing pixels | 0 | 0 | 0 |
| [DPR 1.5] Readback in afterFrame: frames exact / wrong | 11 / 0 | 13 / 0 | 13 / 0 |
| [DPR 1.5] Readback after a microtask / in the next task / two frames later: differing pixels (recorded) | 0 / 6336 / 6336 | 0 / 6336 / 6336 | 0 / 6336 / 6336 |
| [DPR 1.5] Partially transparent texels: largest channel error | 0.63 | 0.63 | 0.49 |
| [DPR 1.5] devicePixelContentBoxSize of the two canvases | 96x66, 144x108 | 96x66, 144x108 | 96x66, 144x108 |
| [DPR 1.5] Screenshot of the bare renderer canvas | exact | exact | exact |
| [DPR 1.5] Screenshot of the BrowserGame canvas | exact | exact | exact |

Checks that did not hold (failed checks decide the result; recorded ones do not):

- Intel UHD, DPR 1.5 emulated — recorded: devicePixelContentBoxSize equals the backing size of both canvases — bare 64x44 (backing 96x66), game 96x72 (144x108)
- RTX 4060, DPR 1.5 emulated — recorded: devicePixelContentBoxSize equals the backing size of both canvases — bare 64x44 (backing 96x66), game 96x72 (144x108)
- SwiftShader, DPR 1.5 emulated — recorded: devicePixelContentBoxSize equals the backing size of both canvases — bare 64x44 (backing 96x66), game 96x72 (144x108)
<!-- generated:q7:end -->

Consequence for the spec

- Go: SPEC §6.7 stands, including "in the same task as the render".
- No-go: no fallback is defined by the ticket or the SPEC.
- Independent of go / no-go, finding 7.1 below affects every test at a DPR other than 1.

Finding 7.1: `devicePixelContentBoxSize` under Playwright emulation

- Playwright's `deviceScaleFactor` changes `devicePixelRatio` but not
  `devicePixelContentBoxSize`, which keeps the browser's own scale. Measured in headless
  Chrome 154: an 801×601 CSS px element reports 801×601 at an emulated DPR of 1.5 and 2.
- With `--force-device-scale-factor=1.5` on the browser and `deviceScaleFactor: 1.5` on the
  context the same element reports 1201×901, and the viewport stays 1280×720 CSS px.
- A viewport sized from `devicePixelContentBoxSize` (SPEC §6.4) therefore gets a backing size in
  CSS pixels under emulation alone. E2E tests at DPR 1.5 (SPEC §11) have to start Chrome with
  `--force-device-scale-factor=1.5`. This is a change to `playwright.config.ts` (a DPR 1.5
  project), owned by the first ticket that tests at DPR 1.5. A note in SPEC §6.7 is suggested;
  it is not an amendment required by a no-go.

### 4.8 Device loss

Page `spikes/ngne/pages/q08-device-loss.ts`. Canvas 256×192 with three manual slots. A loss is
`device.destroy()` on the renderer's current device, kept by the `requestDevice` wrap.

- A, three losses: `status` is read every task. Recorded: time until `status` is `ready` again
  and, after one explicit draw, until the readback is exact again. Both must be ≤ 2 s.
- B, the idle viewport of SPEC §6.4: a dirty flag schedules one animation frame; a draw while
  `status` is not `ready` keeps the flag and retries next frame; a 1 s timer reads `status` and
  marks the view dirty on a transition back to `ready`. Five losses, 50 to 950 ms after a timer
  tick, with no input for 3 s after each. Check: every loss is followed by an exact redraw.
- C, recorded candidate: the same timer also marks the view dirty when `renderer.sprites === 0`
  after a draw that submitted sprites (NGNE zeroes that counter when the device is lost).
- D, recorded: the same loss on a running `BrowserGame`.
- The page ends with a loss that is not redrawn; the runner screenshots the canvas and records
  what it shows.

<!-- generated:q8:begin -->
Result: **no-go** (Intel UHD, RTX 4060). Intel UHD no-go · RTX 4060 no-go · SwiftShader no-go (recorded, does not decide).

| Measure | Intel UHD | RTX 4060 | SwiftShader |
| --- | --- | --- | --- |
| Back to ready after destroy(): each loss (ms) | 45.9, 26.1, 27.1 | 45.2, 39.7, 43.7 | 56.6, 54, 56.2 |
| Slots shown again after an explicit draw: slowest (ms) | 49.8 | 48.8 | 69.1 |
| Idle viewport, status polled every 1 s: losses redrawn | 0/5 | 1/5 | 1/5 |
| Idle viewport, status seen by the 1 s timer after each loss | ready>ready>ready \| ready>ready>ready \| ready>ready>ready \| ready>ready>ready \| ready>ready>ready | ready>ready>ready \| ready>ready>ready \| ready>ready>ready \| ready>ready>ready \| recovering>ready>ready | ready>ready>ready \| ready>ready>ready \| ready>ready>ready \| ready>ready>ready \| recovering>ready>ready |
| Candidate (sprites counter): losses redrawn, slowest redraw (ms) | 5/5, 945 | 5/5, 1046.5 | 5/5, 1057 |
| BrowserGame: frames exact again after (ms) | 21.2 | 57.1 | 56.7 |
| Canvas after loss and recovery, before any redraw (screenshot) | blank | blank | blank |

Checks that did not hold (failed checks decide the result; recorded ones do not):

- Intel UHD — **failed**: Polling per SPEC §6.4 (status on a 1 s timer) redraws without user input — 0/5 losses redrawn within 3000 ms; status seen by the timer: ready>ready>ready | ready>ready>ready | ready>ready>ready | ready>ready>ready | ready>ready>ready
- RTX 4060 — **failed**: Polling per SPEC §6.4 (status on a 1 s timer) redraws without user input — 1/5 losses redrawn within 3000 ms; status seen by the timer: ready>ready>ready | ready>ready>ready | ready>ready>ready | ready>ready>ready | recovering>ready>ready
- SwiftShader — **failed**: Polling per SPEC §6.4 (status on a 1 s timer) redraws without user input — 1/5 losses redrawn within 3000 ms; status seen by the timer: ready>ready>ready | ready>ready>ready | ready>ready>ready | ready>ready>ready | recovering>ready>ready
<!-- generated:q8:end -->

Consequence for the spec

- Go: none. SPEC §6.2 #13 and the §6.4 status polling stand.
- No-go on B (status polling): no fallback is defined by the ticket or the SPEC. The cause seen
  under SwiftShader is that recovery completes between two timer reads, so the timer only ever
  reads `ready` and never sees a transition; the canvas stays blank until the next draw.
  Candidate C redrew after every loss. Candidate text for SPEC §6.4 (Lifecycle, rendering
  bullet), replacing "a transition back to `ready` marks the view dirty":

  > Recovery usually completes between two reads, so each read also compares
  > `renderer.sprites` with the last draw: NGNE zeroes it when the device is lost. A transition
  > back to `ready`, or `renderer.sprites === 0` after a draw that submitted sprites, marks the
  > view dirty.

  The same sentence in SPEC §6.8 ("No recovery event | Poll `status` on draw, focus,
  visibility") would gain "and the `sprites` counter". This relies on an NGNE implementation
  detail, so it needs the owner's decision and a REVIEW.md record.
- No-go on A (recovery time): no fallback is defined by the ticket or the SPEC.

### 4.9 Odd sizes through `BrowserGame` (S)

Page `spikes/ngne/pages/q09-odd-sizes.ts`. One atlas (padding 1) with a 33×33 frame and a
32×32 frame. Each case is its own `BrowserGame`, read back in `afterFrame` for three frames.

- Rectangles: 32×32; odd 33×33; the 33×33 frame with the even-padded 34×34 rectangle of SPEC
  §9.2 (one transparent column and row).
- Each with default `pixelSnap` and with snapping off, and each at two placements: canvas =
  source size with the top-left at 0,0 (the preview panel), and an 80×60 canvas with the
  top-left at 7,5. Quad centre = top-left + rectangle size ÷ 2.
- Checks: all six snap-off cases exact; the four even-rectangle cases under default snap exact.
  The two odd-rectangle cases under default snap are recorded.

<!-- generated:q9:begin -->
Result: **go**. Intel UHD go · RTX 4060 go · SwiftShader go.

| Measure | Intel UHD | RTX 4060 | SwiftShader |
| --- | --- | --- | --- |
| Snap off: exact cases | 6/6 | 6/6 | 6/6 |
| Default snap, even rects: exact cases | 4/4 | 4/4 | 4/4 |
| Default snap, odd 33×33 rect: differing pixels per case (recorded) | 0, 0 | 1089, 1089 | 1089, 1089 |

Checks that did not hold (failed checks decide the result; recorded ones do not):

- Intel UHD — recorded: Default snap with an odd 33×33 rect is misaligned (expected; recorded per adapter) — canvas = source size, top-left at 0,0: 0 differing pixels; 80×60 canvas, top-left at 7,5: 0 differing pixels
<!-- generated:q9:end -->

Consequence for the spec

- Go: none. SPEC §9.2 (even rectangles) and §6.5 (`pixelSnap = false`) stand.
- No-go: no fallback is defined by the ticket or the SPEC.
- Recorded for SPEC §6.2 #7: with default snap an odd rectangle's centre is rounded by half a
  pixel, which puts every pixel centre exactly on a texel boundary. Which texel is sampled
  there is up to the adapter, so the outcome is recorded per GPU and must not be relied on.

### 4.10 `ngne-preview` acceptance

Runner only (`q10` in `spikes/ngne/runner/run.ts`). Config
`spikes/ngne/q10/hero.preview.config.mjs`, hand-written per SPEC §9.5: two 33×33 source frames
with even 34×34 rectangles in a 71×36 atlas, one looping animation, `display: { density: 1,
scale: 1, pixelSnap: true }`. `hero.png` is written by the runner from the test pattern.

- `node node_modules/@ngne/core/dist/preview/cli.js spikes/ngne/q10/hero.preview.config.mjs`
  is started from the repository root; the printed URL is opened in the test browser.
- Checks: `#status` starts with `Ready` and `#error` is empty, at load and after selecting each
  frame and playing the animation (as SPEC §9.7 item 2 does).

<!-- generated:q10:begin -->
Result: **go**. Intel UHD go · RTX 4060 go · SwiftShader go (recorded, does not decide).

| Measure | Intel UHD | RTX 4060 | SwiftShader |
| --- | --- | --- | --- |
| Page status | Ready · renderer ready | Ready · renderer ready | Ready · renderer ready |
| Error text | (empty) | (empty) | (empty) |
| Frames and animation selected in turn: Ready without error | yes | yes | yes |

Every check held on the GPUs measured.
<!-- generated:q10:end -->

Consequence for the spec

- Go: none. SPEC §9.5 and §9.7 item 2 stand.
- No-go: no fallback is defined by the ticket or the SPEC.

### 4.11 Slot memory

Page `spikes/ngne/pages/q11-slot-memory.ts`.

- `renderer.inspect()` after create (baseline), after uploading 1024² images into all 14
  viewport slots, and after replacing them with 1×1 images; three cycles.
- Checks: the filled state shows 14 × 1024² × 4 bytes above baseline; after replacement the
  estimated texture bytes are within 1 MB of baseline; a slot draws while full and after it
  held a placeholder.
- `inspect()` is NGNE's own estimate (width × height × 4 per live texture), not a driver
  measurement.

<!-- generated:q11:begin -->
Result: **go**. Intel UHD go · RTX 4060 go · SwiftShader go (recorded, does not decide).

| Measure | Intel UHD | RTX 4060 | SwiftShader |
| --- | --- | --- | --- |
| Baseline estimated texture bytes | 4 | 4 | 4 |
| All 14 slots at 1024²: estimated texture / source bytes (MB) | 56 / 56 | 56 / 56 | 56 / 56 |
| After 1×1 replacement: estimated texture / source bytes | 60 / 56 | 60 / 56 | 60 / 56 |
| Above baseline after replacement (bytes, worst cycle) | 56 | 56 | 56 |

Every check held on the GPUs measured.
<!-- generated:q11:end -->

Consequence for the spec

- Go: none. SPEC §6.2 #4 (1×1 placeholders) stands.
- No-go: no fallback is defined by the ticket or the SPEC.

## 5. Raw data

| File                                        | Content                                   |
| ------------------------------------------- | ----------------------------------------- |
| `docs/spikes/data/se-002-swiftshader.json`  | SwiftShader run (recorded)                |
| `docs/spikes/data/se-002-intel-uhd.json`    | Intel UHD run (written by the orchestrator) |
| `docs/spikes/data/se-002-rtx-4060.json`     | RTX 4060 run (written by the orchestrator)  |

Structure (`spikes/ngne/lib/types.ts`, `SpikeData`):

- `gpu`, `recordedAt`, `commit`, `command`, `quick`.
- `environment`: OS, CPU, memory, Node, Chrome version and arguments, headless flag, adapter
  info, the GPU and driver rows of `chrome://gpu`, the adapters Dawn lists, package versions.
- `questions["1"…"11"]`: `title`, `threshold`, `pass`, `complete`, `parts` (question 4) and
  `runs`. A question has one run per page load (question 3: four DPRs; question 4: ten; question
  7: three).
- Each run: `variant`, `pass`, `checks` (`name`, `pass`, `binding`, `detail`), `summary` (the
  numbers shown in the tables), `metrics` (all aggregates), `samples` (raw samples in ms, for
  example the 200 latencies per size of question 1), `adapters` (from the `requestDevice`
  wrap), `page` (URL, DPR, viewport, screen) and `durationMs`.

## 6. Method choices

Where the ticket leaves room, this is what the pages do. Each is also listed in the ticket
report.

- Question 1 "time to the next `render()` submitted": measured with `render()` called as soon as
  `texture()` resolves. The viewport-path figure (draw in the next animation frame) is recorded
  next to it and does not decide.
- Question 1 "sustained": completed replacements ÷ length of the 5 s window; the count per
  second is recorded.
- Question 4(a) is tested in three variants and is go when one of them passes; question 4 as a
  whole is go when (a) or (b) passes.
- Question 4(a) "never a blank viewport" is decided by screenshots, because a WebGPU canvas
  cannot be read back in the page after the task that drew it.
- Question 7 runs the DPR 1.5 case twice (emulation only, and with the browser's scale set).
- Question 8 adds the candidate C and the `BrowserGame` case D as recorded observations.
- DPR is set with `--force-device-scale-factor` plus the context's `deviceScaleFactor`
  (finding 7.1), in questions 3, 4(b) and 7.
- Runs are headless by default. `--headed` exists; a headed run needs the window visible for
  its whole length.
