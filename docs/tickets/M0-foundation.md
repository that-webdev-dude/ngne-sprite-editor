# M0 — Foundation

Goal: a buildable, versioned project with CI, a verified engine integration approach, and the
core model the rest depends on. Exit: gate G0 ([README](README.md#gates)).

---

## SE-001 · Repository, scaffold, toolchain and CI

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | —                                                        |
| Blocks       | SE-002, SE-003, SE-005, SE-006                           |
| Blocked until | Owner acknowledgement of A1, A4, A5, A6, A8 recorded in REVIEW.md |
| Spec         | SPEC §3, §4, §5, §6.7, §11                               |

Scope
- Git repository initialized in this directory (docs already present), `.gitignore`, licence
  file and remote per A8.
- Vite + React + TypeScript (strict) app; `@ngne/core` pinned exactly to 0.2.1 from npm.
- `tsconfig` per the NGNE guide (`moduleResolution: "Bundler"`, `types: []`,
  `skipLibCheck: false`, target es2022). If NGNE declarations fail under the pinned TypeScript,
  pin 5.9.x and record it.
- Source layout `src/core`, `src/engine`, `src/app`, `src/ui`; lint rule that fails when `core`
  imports DOM globals, React or `@ngne/core`, or when anything outside `engine` imports
  `@ngne/core`.
- Vitest (Node environment) for `core`.
- Playwright driving installed Chrome (`channel: "chrome"`, new headless), with
  `--force-color-profile=srgb`; hardware WebGPU locally.
- CI on an Ubuntu runner, copying NGNE's working setup (`ngne/.github/workflows/ci.yml`):
  packages `libvulkan1 mesa-vulkan-drivers`, `xvfb-run`, and flags
  `--use-webgpu-adapter=swiftshader --enable-unsafe-webgpu --enable-unsafe-swiftshader
  --no-sandbox --enable-features=Vulkan --use-angle=vulkan --use-vulkan=swiftshader
  --disable-vulkan-surface`.
- Ambient declaration for `*?raw` imports (needed under `types: []`).
- Test helper `readCanvas(canvas)` for in-page readback of a WebGPU canvas (SPEC §6.7).
- Scripts: `dev`, `build`, `typecheck`, `lint`, `format:check`, `test`, `test:e2e`, `check` (all).
- CI workflow running `check` and `test:e2e` on every push.
- Prettier config matching NGNE's (4 spaces, 100 columns).

Out of scope: any feature code, deployment.

Acceptance
- `npm ci && npm run check` passes on a fresh clone with Node ≥ 24, locally and in CI.
- An E2E smoke test opens the dev build, creates a `WebGPURenderer` on a canvas, draws one
  `frame.rect`, and `readCanvas` returns the expected colour at the expected pixel — under
  hardware locally and SwiftShader in CI.
- A deliberately added `import "@ngne/core"` in `src/core` fails lint.
- Runtime `dependencies` in `package.json` are exactly those of SPEC §4 (minus `gifenc` until
  SE-063), all exact versions.

---

## SE-002 · Spike: NGNE integration feasibility (gate G0)

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | SE-001                                                   |
| Blocks       | SE-011, SE-053, SE-054                                   |
| Blocked until | Owner acknowledgement of A9 recorded in REVIEW.md       |
| Spec         | SPEC §6.2, §6.4, §6.5, §6.6, §6.7, §9.2, §13             |

Scope: throwaway pages under `spikes/ngne/` that measure each assumption `engine/` relies on.
No production code is kept. Each question has a go threshold; all are measured on both reference
GPUs (Intel UHD, RTX 4060) and, where marked S, also under SwiftShader.

| # | Question | Method | Go threshold |
| - | -------- | ------ | ------------ |
| 1 | Upload latency and sustained rate | From a CPU `Uint8ClampedArray`: build bitmap, `texture("ed:f:0")`, `render()`; time to `texture()` resolution and to the next `render()` submitted. 64², 256², 512², 1024²; 200 samples each; then 5 s of replacements requested every animation frame | 256²: p95 ≤ 25 ms to submitted on Intel UHD and ≥ 30 completed replacements/s sustained. Other sizes recorded |
| 2 | Single-flight queue | Overlapping `texture()` calls; latest-wins queue during a 5 s continuous stream | Earlier call rejects "superseded"; final content always shown; no starvation (≥ 1 publish per 100 ms) |
| 3 | Pixel-exact placement, viewport path (S) | `pixelSnap = false`, integer top-left and size; DPR 1, 1.25, 1.5, 2; odd and even document sizes; scales 1, 3, 8 | In-page readback: zero device pixels differ from the expected pattern |
| 4 | Renderer replacement vs fixed oversized canvas | (a) Dispose and create on a new canvas 50 times, including overlapping requests serialized by the caller. (b) One canvas with backing = logical = screen size in device pixels, CSS-clipped, window resized 50 times | (a) No errors, one live device after each swap completes, never a blank viewport, median ≤ 250 ms. (b) Correct image, no recreation. Record which is adopted for SPEC §6.4 |
| 5 | Two renderers | Bare `WebGPURenderer` and a `BrowserGame` on two canvases for 60 s; `stop()`/`start()` the game 20 times through a serialized queue; host calls `app.renderer.texture()` after `start()` resolves; dispose and recreate the game on a new canvas 20 times | No diagnostics other than dropped-tick notices; both keep rendering correctly |
| 6 | Not-ready textures | Reference an unuploaded slot, then gate on first-upload resolution | Ungated frame is skipped with one diagnostic; gated path produces none |
| 7 | Readback and screenshots (S) | `readCanvas` after `render()` and inside `afterFrame`; Playwright screenshot of the same canvas; DPR 1.5 emulation; `devicePixelContentBoxSize` under emulation | Readback exact for opaque texels in all modes; screenshot exact at DPR 1 |
| 8 | Device loss | Wrap `GPUAdapter.prototype.requestDevice` before creating the renderer, keep the device, call `destroy()` | NGNE returns to `ready` and manual slots show their content again within 2 s; polling per SPEC §6.4 redraws without user input |
| 9 | Odd sizes through `BrowserGame` (S) | 33×33 and 32×32 sprites drawn by a scene with default `pixelSnap` and with snapping off; even-padded rect per SPEC §9.2 | With snap off and with even rects under default snap: readback exact. Odd rect under default snap: result recorded (expected misaligned) |
| 10 | `ngne-preview` acceptance | Hand-written config per SPEC §9.5 with an odd-source, even-rect frame; run `node node_modules/@ngne/core/dist/preview/cli.js`; open the printed URL | Page status starts with `Ready`, no error text |
| 11 | Slot memory | `renderer.inspect()` after filling all slots at 1024² and after replacing them with 1×1 images | Estimated texture bytes fall back to within 1 MB of baseline |

Method notes: counting live devices (question 4a) uses the same `requestDevice` wrap as
question 8. NGNE calls `requestAdapter()` without a power preference, so the GPU under test is
selected with `--force-high-performance-gpu` or the OS graphics setting and recorded from the
adapter info.

Deliverable: `docs/spikes/SE-002-ngne-integration.md` with a row per question (method, numbers,
go / no-go, consequence for the spec), environment details and raw data.

Acceptance
- Every question has a recorded result against its threshold.
- For each no-go, SPEC §6 or §9 is amended with the fallback (question 1: the overlay stroke
  echo of §6.6, owned by SE-015) and the amendment is recorded in REVIEW.md.
- The sizing strategy chosen in question 4 is written into SPEC §6.4.
- Gate G0 is marked passed or failed in `docs/tickets/README.md`.

---

## SE-003 · Document model and session

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-001                                                   |
| Blocks       | SE-004, SE-007, SE-010, SE-040, SE-043, SE-051           |
| Blocked until | Owner acknowledgement of A7 recorded in REVIEW.md       |
| Spec         | SPEC §5.1, §5.2                                          |

Scope
- Every type of SPEC §5.1, and `DocSession`, `Selection` and the `touched` data type of §5.2,
  in `core/model`, with defaults for `DocSettings` and `ExportSettings`.
- `createDocument({ name, width, height, grid? })` → session with one pixel layer, one frame, no
  cel (empty), the default palette (DawnBringer 32, defined as data in `core/model`), centre
  pivot.
- `assertInvariants(session)` covering every invariant listed in §5.1, plus: active layer and
  frame exist; selection mask (when present) has the document's dimensions.
- ID generation injectable for deterministic tests.
- Pure read helpers: `celAt(layerId, frameId)`, `frameIndex(id)`, `layerIndex(id)`,
  `tagsAtFrame(index)`, `activeTagAt(index)` (rule of SPEC §7.4), `pixelMemoryBytes(doc)`.

Acceptance
- Unit tests: a new document satisfies all invariants; each invariant has a test that violates
  it and is caught with a message naming the invariant.
- `activeTagAt` tests: nested tags, equal-length overlap (later-created wins), no tag.
- Creating a document outside 1..1024 per side throws a typed error.
- No file in `core/model` imports from outside `core`.

---

## SE-004 · Commands, transactions and undo history

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | SE-003                                                   |
| Blocks       | SE-007, SE-014, SE-020, SE-021, SE-030                   |
| Blocked until | —                                                       |
| Spec         | SPEC §5.2                                                |

Scope
- `Command` interface and `History` per session: execute, undo, redo, labels for menu text,
  `touched` reporting, change subscription.
- Pixel patch command: stores before/after sub-buffers for a dirty rectangle of one image.
- Transaction API for strokes: `begin({ layerId, frameId })` snapshots the target image and, if
  the cel is empty, creates its image and cel; the tool writes pixels directly and reports dirty
  rectangles; `commit(label)` produces one command (including cel creation); `abort()` restores
  the snapshot and removes a cel it created. A linked cel's image is shared, so the patch
  applies to every cel using it.
- Optional clip mask on a transaction (used by selections in SE-030).
- Composite command (several commands as one undo step).
- Memory budget 256 MB per history; oldest entries dropped; the newest command is always kept.
- Allocation failure inside a command or transaction: state restored, typed error thrown.

Acceptance
- Property test: for 500 random sequences of pixel patches, `undo` all then `redo` all
  reproduces every intermediate buffer byte-exactly.
- A stroke on an empty cel creates the cel; undo removes it; redo restores identical pixels.
- Aborting a transaction leaves the session deep-equal to its state at `begin`.
- Exceeding the budget drops oldest commands only; a single command larger than the budget is
  retained and remains undoable; undo stops at the oldest retained command.
- A new command after undo clears redo.
- A simulated allocation failure leaves the session unchanged and throws the typed error.
- `assertInvariants` holds after every do/undo/redo in tests.

---

## SE-005 · Pixel buffers and lossless PNG codec

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-001                                                   |
| Blocks       | SE-032, SE-040, SE-043, SE-050                           |
| Blocked until | —                                                       |
| Spec         | SPEC §4, §6.2 (9), §9.1                                  |

Scope
- `core/pixels`: create, clone, crop, blit, fill, compare, bounds of non-transparent pixels,
  flip, rotate 90/180, nearest resize.
- `core/png`: `decodePng(bytes) → PixelBuffer` (all PNG colour types and bit depths to straight
  RGBA8; 16-bit reduced to 8; palette + tRNS expanded; interlaced supported) and
  `encodePng(buffer) → bytes` (RGBA8, no ancillary colour chunks) using `fast-png`.
- Normalization option: zero RGB where alpha is 0.
- If `fast-png` cannot satisfy an acceptance item, replace only the failing direction with a
  minimal implementation over `CompressionStream`/`DecompressionStream` and record the decision.

Acceptance
- `decode(encode(buffer))` returns pixel data identical to `buffer` for a fixture with every
  alpha value 0–255 against varied RGB (no premultiplication loss).
- Fixtures decode to the expected pixels: greyscale, greyscale+alpha, RGB, RGBA, indexed with
  tRNS, 16-bit, interlaced.
- Encoding the same buffer twice in one run yields identical bytes.
- Malformed input throws a typed error within 1 s; it does not hang or return a buffer.
- Codec runs under Vitest in Node (no DOM).

---

## SE-006 · Design tokens, UI primitives and app shell

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | SE-001                                                   |
| Blocks       | SE-007, SE-008, SE-011, SE-016, SE-034, SE-044, SE-052, SE-054 |
| Blocked until | —                                                       |
| Spec         | DESIGN §2, §3, §4, §7 (WebGPU required), §8              |

Scope
- CSS custom properties for every token in DESIGN §3, dark and light sets; theme switch persisted
  in `localStorage`.
- Primitives from DESIGN §4: button, icon button, tool button, number field (scrub + keys),
  slider, toggle, select, segmented control, dialog (standard and large), popover, context menu,
  tooltip, splitter. Radix underneath where listed.
- Toast service (`toast.info/error`) and per-region error boundary per DESIGN §4.
- App shell: the seven regions of DESIGN §2 with resizable right dock and timeline, sizes
  persisted, and the overflow rules of DESIGN §2 (two-column rail, scrolling dock, default
  timeline height); empty placeholders for panel content.
- "WebGPU required" full-window notice shown when `navigator.gpu` is missing or adapter
  acquisition fails; "window too small" notice under 1280×720.
- A `/gallery` dev route rendering every primitive in both themes.

Out of scope: menus' command wiring (SE-007), panel contents.

Acceptance
- The shell at 1440×900 matches `docs/design/mockup.html` region sizes within 1 px.
- At 1280×720 every rail tool button and every dock section header is fully visible or
  reachable by scrolling the dock; no region overlaps another (E2E bounding-box check).
- No component stylesheet contains a raw colour value; a lint/grep check enforces tokens.
- Every primitive is operable by keyboard and shows the focus ring only on keyboard focus.
- Contrast: automated check (axe) reports no AA violations on the gallery in both themes.
- A component that throws inside a region shows the boundary message while other regions keep
  working.
- E2E: with `navigator.gpu` removed by an init script, the notice renders and no uncaught error
  is logged.

---

## SE-007 · Editor state, command registry, keymap, menus and preference store

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-003, SE-004, SE-006                                   |
| Blocks       | SE-008, SE-011, SE-012, SE-014, SE-022, SE-034, SE-041, SE-054, SE-064 |
| Blocked until | —                                                       |
| Spec         | SPEC §5, §7.8; DESIGN §4 (Menu bar), §5.7                |

Scope
- Stores: open sessions with their histories and dirty flag (rule of SPEC §5.2; "saved
  position" is set by SE-041); per-document view state and reference source
  bytes (`Map<sourceId, Uint8Array>`, empty until SE-045); global state (tool, tool options,
  FG/BG colours); test hook to open a session programmatically.
- Command registry: `{ id, title, run, enabled?, shortcut?, context?, menuPath? }`. Menus,
  context menus and shortcuts are generated from it; UI never calls document mutations directly.
- Keymap implementing the contexts and bindings of SPEC §7.8 (bindings for commands that do not
  exist yet are registered by their own tickets); chord matching; focus regions and F6 cycling.
- Menu bar with File, Edit, Sprite, Layer, Frame, Select, View; items for unimplemented
  commands are present and disabled.
- Undo/redo commands wired to the active session's history with dynamic labels ("Undo Pencil").
- Preference store: versioned `localStorage` record with defaults, typed getters, change
  subscription. Consumers (checkerboard, grid, onion, import, autosave) read it in their tickets.
- Status bar bound to state (fields without a source yet stay blank).

Acceptance
- Unit tests: keymap resolution follows context priority; no two enabled commands share a chord
  in the same context (test enumerates the registry).
- E2E in Chrome: every chord listed in SPEC §7.8 reaches the registry (a spy command per chord);
  any chord that does not is given an alternate and SPEC §7.8 is updated in the same change.
- E2E: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z invoke undo/redo on a test command; typing "z" in a text
  field does not.
- Every menu item corresponds to a registry entry (test enumerates and fails on orphans).
- Switching the active session switches history, state and status bar.
- Corrupt or older stored preferences fall back to defaults without an error.

---

## SE-008 · New sprite, sprite properties and empty state

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-006, SE-007                                           |
| Blocks       | SE-012, SE-041                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §7.7, §5.1; DESIGN §6 (empty state), §7             |

Scope
- New sprite dialog (width, height, presets, name) creating a session through the store. Until
  SE-047 adds tabs, creating a document replaces the open one after a discard confirmation.
- Empty state in the workspace when no document is open: New sprite (Open, Import PNG and
  recent files are added by SE-041, SE-044 and SE-047).
- New documents take their grid size from the preference store's default grid.
- Sprite properties dialog: name and pivot (3×3 presets and numeric) as undoable commands in
  `core`; grid size and offset as `DocSettings` setters (no history entry, SPEC §5.2).
- The active document's name in the menu bar.

Acceptance
- E2E: launch → empty state → New sprite 32×32 "hero" → the store holds a session that passes
  `assertInvariants`, and the menu bar shows "hero".
- Width or height outside 1..1024 disables Create and shows an inline message.
- Setting pivot to bottom-centre stores `{ x: 0.5, y: 1 }`; undo restores the previous value.
- Renaming the sprite updates the menu bar and is undoable.
- Changing the grid size adds no history entry and does not set the dirty flag; changing the
  pivot does both.
