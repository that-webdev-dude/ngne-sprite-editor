# M0 — Foundation

Goal: a buildable project, a verified engine integration approach, and the core model the rest
depends on. Exit: gates G0 and G1 pass ([README](README.md#gates)).

---

## SE-001 · Project scaffold and toolchain

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | —                                                        |
| Blocks       | SE-002, SE-003, SE-005, SE-006                           |
| Blocked until | Assumptions A1, A4, A5, A6 not overridden by the owner  |
| Spec         | SPEC §3, §4, §5, §11                                     |

Scope
- Vite + React + TypeScript (strict) app; `@ngne/core` pinned exactly to 0.2.1 from npm.
- `tsconfig` per the NGNE guide (`moduleResolution: "Bundler"`, `types: []`,
  `skipLibCheck: false`, target es2022). If NGNE declarations fail under the pinned TypeScript,
  pin 5.9.x and record it.
- Source layout `src/core`, `src/engine`, `src/app`, `src/ui`; lint rule that fails when `core`
  imports DOM globals, React or `@ngne/core`, or when anything outside `engine` imports
  `@ngne/core`.
- Vitest (Node environment) for `core`; Playwright with Chrome launched with WebGPU enabled
  (hardware locally; SwiftShader flags as used by NGNE's tooling for CI).
- Scripts: `dev`, `build`, `typecheck`, `lint`, `format:check`, `test`, `test:e2e`, `check` (all).
- Prettier config matching NGNE's (4 spaces, 100 columns).

Out of scope: any feature code, deployment.

Acceptance
- `npm run check` passes on a clean clone with Node ≥ 24.
- An E2E smoke test opens the dev build, creates a `WebGPURenderer` on a canvas, draws one
  `frame.rect`, and a screenshot shows the expected colour at the expected pixel.
- A deliberately added `import "@ngne/core"` in `src/core` fails lint.
- `package.json` contains only the dependencies listed in SPEC §4, all exact versions.

---

## SE-002 · Spike: NGNE viewport feasibility (gate G0)

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-001                                                   |
| Blocks       | SE-011, SE-053, SE-054                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §6.2, §6.4, §6.5, §6.6, §13                         |

Scope: a throwaway page under `spikes/ngne-viewport/` that measures and demonstrates each
assumption marked ⚠ or relied on by `engine/`. No production code is kept.

Questions to answer, each with a measured result
1. **Upload latency.** Time from `texture("ed:frame", bitmap)` call to resolution for 64², 256²,
   512², 1024² buffers, 200 samples each, on Intel UHD and on the discrete GPU. Report p50/p95.
2. **Single-flight queue.** Confirm overlapping calls reject the earlier one, and that a
   latest-wins queue delivers every final state with no starvation during a 5 s continuous stroke.
3. **Pixel-exact placement.** With `camera.pixelSnap = false`, integer top-left and integer size,
   at DPR 1, 1.25, 1.5 and 2: every texel of a test pattern covers exactly `scale × scale`
   device pixels, verified from a screenshot, for odd and even document sizes.
4. **Resize.** Dispose and recreate the renderer on the same canvas element 50 times; no errors,
   no leaked devices; time per recreate. If the same canvas cannot be reused, replacing the
   element works.
5. **Two renderers.** A bare `WebGPURenderer` and a `BrowserGame` on two canvases run together;
   stopping and restarting the `BrowserGame` works; manual `texture()` on `app.renderer` works
   inside a scene with no `assets`.
6. **Not-ready textures.** Confirm a frame referencing an unuploaded slot is skipped, and that
   gating on first-upload resolution avoids it.
7. **Screenshot fidelity.** Playwright screenshots of the WebGPU canvas return exact RGB for
   opaque pixels, under hardware and SwiftShader.
8. **Device loss.** Force a loss (`device.destroy()` is not reachable; use
   `chrome://gpucrash` or the GPU-process kill switch); confirm manual slots are restored by NGNE
   or that recreate-and-reupload recovers.

Deliverable: `docs/spikes/SE-002-ngne-viewport.md` with a table (question, method, result,
go / no-go, consequence for the spec), environment details and the raw numbers.

Acceptance
- Every question has a recorded result and a go/no-go.
- For each no-go, SPEC §6 is amended with the fallback (for question 1: the overlay stroke echo
  in §6.6) and the amendment is recorded in REVIEW.md.
- Gate G0 is marked passed or failed in `docs/tickets/README.md`.

---

## SE-003 · Document model

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-001                                                   |
| Blocks       | SE-004, SE-007, SE-010, SE-040, SE-043, SE-051           |
| Blocked until | —                                                       |
| Spec         | SPEC §5.1                                                |

Scope
- Types of SPEC §5.1 in `core/model`, including `ReferenceLayer`, `Tag`, `ExportSettings`.
- `createDocument({ name, width, height })`: one pixel layer, one frame, empty cel, default
  palette, centre pivot.
- `assertInvariants(doc)` covering every invariant listed in §5.1.
- ID generation injectable for deterministic tests.
- Pure read helpers: `celAt(layerId, frameId)`, `frameIndex(id)`, `layerIndex(id)`,
  `tagsAtFrame(index)`, `pixelMemoryBytes(doc)`.

Acceptance
- Unit tests: a new document satisfies all invariants; each invariant has a test that violates
  it and is caught with a message naming the invariant.
- Creating a document outside 1..1024 per side throws a typed error.
- No file in `core/model` imports from outside `core`.

---

## SE-004 · Commands, transactions and undo history

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-003                                                   |
| Blocks       | SE-014, SE-020, SE-021, SE-030                           |
| Blocked until | —                                                       |
| Spec         | SPEC §5.2                                                |

Scope
- `Command` interface and `History` per document: execute, undo, redo, labels for menu text.
- Pixel patch command: stores before/after sub-buffers for a dirty rectangle of one image.
- Transaction API for strokes: `begin(imageId)`, accumulate dirty rectangle while the tool
  writes pixels directly, `commit(label)` produces one patch command, `abort()` restores.
- Composite command (several commands as one undo step).
- Memory budget 256 MB per history; dropping oldest entries; `bytes` accounting per command.
- Change notifications: which frames/layers a command touched (consumed by compositor cache
  and UI).

Acceptance
- Property test: for 500 random sequences of pixel patches, `undo` all then `redo` all
  reproduces every intermediate buffer byte-exactly.
- Aborting a transaction leaves the buffer byte-identical to its state at `begin`.
- Exceeding the budget drops oldest commands only; undo stops at the oldest retained command.
- A new command after undo clears redo.
- `assertInvariants` holds after every do/undo/redo in tests.

---

## SE-005 · Pixel buffers and lossless PNG codec

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-001                                                   |
| Blocks       | SE-032, SE-040, SE-043, SE-050                           |
| Blocked until | —                                                       |
| Spec         | SPEC §4, §6.2 (9), §9.1                                  |

Scope
- `core/pixels`: create, clone, crop, blit, fill, compare, bounds of non-transparent pixels,
  flip, rotate 90/180, nearest resize.
- `core/png`: `decodePng(bytes) → PixelBuffer` (all PNG colour types and bit depths to straight
  RGBA8; 16-bit reduced to 8; palette + tRNS expanded) and `encodePng(buffer) → bytes` (RGBA8,
  no ancillary colour chunks) using `fast-png`.
- Normalization option: zero RGB where alpha is 0.
- If `fast-png` cannot satisfy an acceptance item, replace only the failing direction with a
  minimal implementation over `CompressionStream`/`DecompressionStream` and record the decision.

Acceptance
- Round trip `encode(decode(x))` is byte-exact in pixel data for a fixture with every alpha
  value 0–255 against varied RGB (no premultiplication loss).
- Fixtures decode correctly: greyscale, greyscale+alpha, RGB, RGBA, indexed with tRNS, 16-bit,
  interlaced.
- Encoding the same buffer twice yields identical bytes.
- Malformed input throws a typed error; it does not hang or return garbage.
- Codec runs under Vitest in Node (no DOM).

---

## SE-006 · Design tokens, UI primitives and app shell

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-001                                                   |
| Blocks       | SE-007, SE-011, SE-016, SE-034, SE-044, SE-052, SE-054   |
| Blocked until | —                                                       |
| Spec         | DESIGN §2, §3, §4, §7 (WebGPU required), §8              |

Scope
- CSS custom properties for every token in DESIGN §3, dark and light sets; theme switch persisted
  in `localStorage`.
- Primitives from DESIGN §4: button, icon button, tool button, number field (scrub + keys),
  slider, toggle, select, segmented control, dialog, popover, context menu, tooltip, toast,
  splitter. Radix underneath where listed.
- App shell: the seven regions of DESIGN §2 with resizable right dock and timeline, sizes
  persisted; empty placeholders for panel content.
- "WebGPU required" full-window notice shown when `navigator.gpu` is missing or adapter
  acquisition fails; "window too small" notice under 1024×640.
- A `/gallery` dev route rendering every primitive in both themes.

Out of scope: menus' command wiring (SE-007), panel contents.

Acceptance
- The shell at 1440×900 matches `docs/design/mockup.html` region sizes within 1 px.
- No component stylesheet contains a raw colour value; a lint/grep check enforces tokens.
- Every primitive is operable by keyboard and shows the focus ring only on keyboard focus.
- Contrast: automated check (axe) reports no AA violations on the gallery in both themes.
- E2E: with WebGPU disabled via launch flag, the notice renders and no uncaught error is logged.

---

## SE-007 · Editor state, command registry, keymap and menus

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-003, SE-006                                           |
| Blocks       | SE-012, SE-014, SE-022, SE-034, SE-041, SE-064           |
| Blocked until | —                                                       |
| Spec         | SPEC §5, §7.8; DESIGN §4 (Menu bar), §5.7                |

Scope
- Stores: open documents and their histories; per-document editor state (active layer, active
  frame, selection of cels, view); global state (tool, tool options, FG/BG colours).
- Command registry: `{ id, title, run, enabled?, shortcut?, menuPath? }`. Menus, context
  menus and shortcuts are generated from it; UI never calls document mutations directly.
- Keymap: Aseprite defaults from SPEC §7.1/§7.8; chord matching; ignores keys while a text
  field is focused; alternates for browser-reserved chords.
- Menu bar with File, Edit, Sprite, Layer, Frame, Select, View; items for unimplemented
  commands are present and disabled.
- Undo/redo commands wired to the active document's history with dynamic labels
  ("Undo Pencil").
- Status bar bound to state (values may be placeholders until their features land).

Acceptance
- Unit tests: keymap resolves every registered shortcut; no two enabled commands share a chord
  in the same context.
- E2E: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z invoke undo/redo on a test command; typing "z" in a text
  field does not.
- Every menu item corresponds to a registry entry (test enumerates and fails on orphans).
- Switching the active document switches history, state and status bar.
