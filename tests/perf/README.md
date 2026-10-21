# Performance page

The scripted benchmarks of every budget in SPEC §6.6 (SE-070). They are measured and
recorded, not asserted in CI (SPEC §11): `npm run check` does not run them. The dated results
page `docs/perf/<date>.md` and the records under `docs/perf/` are written by the orchestrator
(docs/tickets/EXECUTION.md, Measurements), never by an implementing agent.

## Running

- One benchmark at a time, with nothing else loading the machine: no E2E run, no other
  benchmark, no agent.
- `npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/<file>` runs one;
  every result is printed (`record.ts`). Vitest hides the console of a passing test without
  `--silent=false`; the record is written either way.
- `PERF_GPU` selects the WebGPU adapter of a browser benchmark: `intel-uhd` or `rtx-4060`
  (the reference hardware of SPEC §3) or `swiftshader` (software, no reference). The adapter
  is checked before anything is measured: a wrong one fails the run. Without `PERF_GPU` a
  browser benchmark is skipped.
- `PERF_RECORD=1` writes the record to `docs/perf/<id>.json`, with the environment and the
  date. Only the orchestrator sets it.
- `PERF_ID=<id>` names the record of this one run: it is printed and written under `<id>`
  instead of the benchmark's own id, which the record keeps as `benchmarkId`. Without it
  every benchmark writes what it always did. A run on other hardware is recorded this way
  beside the reference records, for example the cloud run of run 4 as
  `se-070-<scenario>-cloud-swiftshader`. A process records once under a `PERF_ID`.

Browser benchmarks start installed Chrome (new headless) with `--force-color-profile=srgb`,
the adapter's flags of SE-002 and a device pixel ratio of 1, in a 1920 × 1080 window, the app
in its default layout with the preview panel expanded (REVIEW.md F68 M): the frame-switch and
idle benchmarks check that its section is expanded and its game renders frames before they
measure. Except the cold load,
they run the app from a Vite dev server.

The reference document of SPEC §6.6 is 256 × 256 with 8 layers: the bottom layer an opaque
image of its own in each frame, the seven above a translucent band each, linked across the
frames (as SE-024 built it); the stroke benchmark has 8 layers of translucent noise of its own
(SE-015).

## The budgets

| SPEC §6.6 row                                                         | Budget               | Benchmark                                               | Statistic                                                                                                                                                           | Valid only when                                                                                                                                                                                                                |
| --------------------------------------------------------------------- | -------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stroke: pointer event to the frame containing it being submitted, p95 | ≤ 33 ms              | `se-015-stroke-latency.perf.ts` (SE-015)                | largest of four p95s: every sample of a 6 s stroke; first, second and later samples of 40 short strokes; the earlier of NGNE's submit and the overlay echo's redraw | every sample is on screen by one path; `details.continuousStroke.framesSubmitted` is the usual count (about 740 on Intel UHD, 650–700 on RTX 4060); an unrecorded run right after agrees within a few ms (docs/perf/README.md) |
| Dirty-rectangle recomposite for a 16 px brush dab                     | ≤ 2 ms               | `se-010-dirty-rectangle.perf.ts` (SE-010, Node, no GPU) | p95 of 5000 calls of a 16 × 16 dirty rectangle at 256² over 8 half-transparent layers (the compositor's worst case)                                                 | the buffer is still the frame's full composite after the calls                                                                                                                                                                 |
| Frame switch to a frame already in the slot cache: submitted          | next animation frame | `se-070-frame-switch-cached.perf.ts`                    | largest number of animation frames from the key to the submit, over 70 switches (`unit: count`, budget 1)                                                           | the cache holds all 8 frames before the sweeps, no switch makes a `texture()` call, every switch counts at least 1 frame, the preview plays                                                                                    |
| Frame switch needing an upload: submitted, p95                        | ≤ 50 ms              | `se-070-frame-switch-upload.perf.ts`                    | larger of two p95s: the first sweep (63 switches, composites built) and the two later sweeps (126, composites cached)                                               | every switch makes a `texture()` call (no frame was cached) and counts at least 1 frame; the preview plays                                                                                                                     |
| Editor playback from `ed:play`, 64 frames, 100 ms each                | no skipped frames    | `se-024-playback.perf.ts` (SE-024)                      | entries skipped of about 128 (two passes at 1×; `unit: count`, budget 0)                                                                                            | the viewport draws from the `ed:play` grid of 64 cells and uploads nothing during the window; the window covers about two passes                                                                                               |
| Idle editor: frames submitted per second                              | 0                    | `se-070-idle.perf.ts`                                   | larger of two 10 s windows' viewport frames per second: pointer outside the viewport, then resting on the canvas (`unit: count`, budget 0)                          | the page ran at least 20 animation frames per second in each window; the preview's frames are reported beside it, one per entry while it plays                                                                                 |
| Cold load to interactive (production build, local)                    | ≤ 2 s                | `se-070-cold-load.perf.ts`                              | largest of 10 cold loads, navigation start to interactive                                                                                                           | the page is a production build (no test hook, no Vite client); the adapter is the one asked for                                                                                                                                |

Frame switches (`se-070-frame-switch.ts`) are real ArrowRight presses on the focused viewport
(the registered Next Frame (Canvas) command), as a user steps through the frames. The page
records the key's `timeStamp` and its animation frame (a `requestAnimationFrame` loop that was
registered before anything the key causes, so it runs first in each frame), and the first
frame the viewport submits (`viewportLink.onDrawn`: handed to NGNE, not known to be presented)
that draws the new active frame. The cached case uses 8 frames, as many as the viewport has
cache slots; the upload case 64 frames stepped through in order, so the frame stepped to was
last shown 63 switches before and is never in the cache.

"Interactive" for the cold load: the app is interactive when the user can start work. Past the
WebGPU check that gates the editor (SPEC §3), the shell shows the empty state, whose first
action is New sprite (DESIGN §6), and that action responds. Measured in the page from its
navigation start: from the first animation frame in which the empty state's New sprite button
is on screen, the button is clicked at every frame (at most every 50 ms) until the New sprite
dialog is in the document with a box; "interactive" is that animation frame, which paints the
dialog. A click that comes before the app can answer is lost, as a user's would be. The
production build is `vite build` with the project's configuration, served by `vite preview` on
127.0.0.1; every load is a new Chrome with an empty profile (no HTTP, code or shader cache).
The time to the shell, DOMContentLoaded, the load event, the first contentful paint and the
long tasks are in the record's details.

"Interactive" does not include the editor's first draw: nothing starts the viewport's NGNE
device, pipelines and shaders before a document is open. The details therefore also hold
"Create → first viewport frame on screen", measured in the same loads and not part of the
result: from the first click on the New sprite dialog's Create button (at the animation frame
after the dialog was seen, again every 50 ms while it stays) to the first animation frame in
which the viewport's canvas is in the document with a box. The production build has no test
hook, so the signal is the DOM's: the NGNE viewport inserts its canvas only after that canvas
has drawn its first frame, and the animation frame that finds it there paints it.

## Commands

On the reference hardware (one GPU at a time; the Node benchmark once):

```text
PERF_RECORD=1 PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-015-stroke-latency.perf.ts
PERF_RECORD=1 npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-010-dirty-rectangle.perf.ts
PERF_RECORD=1 PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-070-frame-switch-cached.perf.ts
PERF_RECORD=1 PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-070-frame-switch-upload.perf.ts
PERF_RECORD=1 PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-024-playback.perf.ts
PERF_RECORD=1 PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-070-idle.perf.ts
PERF_RECORD=1 PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-070-cold-load.perf.ts
```

and the same with `PERF_GPU=rtx-4060`. The ids are the benchmarks' own:
`se-015-stroke-latency-<gpu>`, `se-010-dirty-rectangle`, `se-070-frame-switch-cached-<gpu>`,
`se-070-frame-switch-upload-<gpu>`, `se-024-playback-<gpu>`, `se-070-idle-<gpu>`,
`se-070-cold-load-<gpu>`.

In the cloud container of run 4 (Linux, SwiftShader; no reference), each under an id of its
own:

```text
PERF_RECORD=1 PERF_GPU=swiftshader PERF_ID=se-070-stroke-cloud-swiftshader npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-015-stroke-latency.perf.ts
PERF_RECORD=1 PERF_ID=se-070-dirty-rectangle-cloud-swiftshader npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-010-dirty-rectangle.perf.ts
PERF_RECORD=1 PERF_GPU=swiftshader PERF_ID=se-070-frame-switch-cached-cloud-swiftshader npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-070-frame-switch-cached.perf.ts
PERF_RECORD=1 PERF_GPU=swiftshader PERF_ID=se-070-frame-switch-upload-cloud-swiftshader npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-070-frame-switch-upload.perf.ts
PERF_RECORD=1 PERF_GPU=swiftshader PERF_ID=se-070-playback-cloud-swiftshader npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-024-playback.perf.ts
PERF_RECORD=1 PERF_GPU=swiftshader PERF_ID=se-070-idle-cloud-swiftshader npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-070-idle.perf.ts
PERF_RECORD=1 PERF_GPU=swiftshader PERF_ID=se-070-cold-load-cloud-swiftshader npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/se-070-cold-load.perf.ts
```

The dirty-rectangle benchmark runs in Node and uses no GPU; its cloud id keeps the run's
suffix so that the seven records of one run sort together.

On SwiftShader the stroke benchmark submits far fewer frames during its 6 s stroke than on the
reference GPUs (85 in an unrecorded cloud run, against 650–740), so its validity rule of
docs/perf/README.md, which names the reference counts, does not apply there: a SwiftShader
stroke record describes the software adapter only.
