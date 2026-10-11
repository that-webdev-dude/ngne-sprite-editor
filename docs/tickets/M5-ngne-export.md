# M5 — NGNE export

Goal: export a bundle NGNE consumes unmodified (C1) and preview it in-engine.
Exit: gate G4 ([README](README.md#gates)).

---

## SE-050 · Atlas packer

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-005, SE-010                                           |
| Blocks       | SE-051                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §9.4                                                |

Scope
- `core/export/pack(frames: PixelBuffer[], options) → { atlas: PixelBuffer, rects }` where each
  rect carries `x, y, w, h, sourceW, sourceH, offsetX, offsetY` and the source frame indices it
  serves.
- Layouts: near-square grid, single row, single column. Options: padding 0–8, extrude 0–2,
  trim, merge identical frames.
- Input frames come from `compositeFrame` (visible pixel layers only).
- Fully transparent pixels normalized to `0,0,0,0`.
- Side limit 8192; typed error naming the limit and the required size.

Acceptance
- Golden tests: 8 frames of 32×32, padding 1 → expected atlas size and rect positions for each
  layout.
- Every packed rect, cropped from the atlas, equals its (trimmed) source frame byte-exactly.
- Extrude replicates edge pixels into the gutter and never overlaps another rect.
- With merge on, identical frames share one rect; with merge off they do not.
- A fully transparent frame with trim on yields a 1×1 transparent rect, not a zero-size one.
- Deterministic: identical input and options → identical atlas bytes and rects.

---

## SE-051 · NGNE bundle writers

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-003, SE-021, SE-050                                   |
| Blocks       | SE-052, SE-053, SE-054                                   |
| Blocked until | Assumption A2 not overridden by the owner               |
| Spec         | SPEC §9.1–§9.5                                           |

Scope
- `core/export/bundle(doc, settings) → { files: { name, bytes }[], atlas, meta }`.
- ID rules: slugify, pattern check, case-insensitive uniqueness, numeric suffixes for clashes.
- Document → atlas mapping per SPEC §9.3 using `expandTag` (SE-021).
- Writers: `<name>.png` (SE-005), `<name>.atlas.json` (stable key order, 4-space indent,
  trailing newline), `<name>.sprites.ts`, `<name>.preview.config.mjs`.
- `validateAtlas(json, pngSize)`: schema and bounds validation, used by the writer's tests, the
  preview panel and the export dialog.
- `resolveAnimationFrame(animation, ageMs)` in `core/animation`: the single implementation
  whose source text is also emitted into `<name>.sprites.ts`.
- `ExportSettings` persisted in the document.
- `docs/FORMAT.md` gains the `ngne-sprite-atlas` v1 section.

Acceptance
- Golden-file tests for all four outputs on a fixture with 3 tags (forward loop, ping-pong,
  reverse repeat 2) and frames outside any tag.
- `validateAtlas` rejects: missing field, non-integer rect, rect outside image, bad ID, IDs
  differing only by case, animation referencing an unknown frame, non-positive `ms`.
- Generated `<name>.sprites.ts` typechecks against `@ngne/core` 0.2.1 under the NGNE consumer
  `tsconfig` settings (a test compiles it).
- Generated `<name>.preview.config.mjs` passes a local re-implementation of the `ngne-preview`
  field rules (IDs unique and non-empty, integer source rects, positive `ms`, non-empty
  entries, derived sizes ≤ 8190).
- Emitted `resolveAnimationFrame` text equals the tested function's source (test compares).
- Deterministic bytes for all files.
- Once merged, `ngne-sprite-atlas` v1 is frozen (gate G3).

---

## SE-052 · Export dialog and delivery

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-006, SE-041, SE-051                                   |
| Blocks       | SE-063, SE-070                                           |
| Blocked until | Gate G3 passed                                          |
| Spec         | SPEC §9.6; DESIGN §7 (Export)                            |

Scope
- Export dialog per DESIGN §7: bundle options, atlas thumbnail with rects, resulting files and
  sizes, final frame and animation IDs, warnings (renamed IDs, atlas near the size limit).
- Delivery: directory picker (File System Access) with the handle stored per document in
  IndexedDB; zip download otherwise. Overwrite confirmation lists existing files once per folder.
- "Export again" (Ctrl+Shift+E) without the dialog; "Export on save" setting.
- Other exports: current frame PNG (scale 1–16×, nearest), sprite sheet PNG alone, PNG
  sequence as zip.
- Result toast: file count, destination, link to reveal options.

Acceptance
- E2E (File System Access stubbed with an in-memory directory): export writes exactly the four
  bundle files with bytes equal to `bundle()` output.
- "Export again" after an edit rewrites the files without a dialog; the PNG differs, IDs do not.
- With "Export on save" enabled, Ctrl+S saves the project and rewrites the bundle; a failed
  export does not block the save and shows an error toast.
- Without File System Access, a zip containing the same four files downloads.
- Revoked folder permission triggers one re-prompt, then falls back to the dialog.
- Frame PNG at 4× is an exact nearest-neighbour upscale of the composite.

---

## SE-053 · Export conformance against NGNE (gate G4)

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-002, SE-051                                           |
| Blocks       | SE-070, SE-073                                           |
| Blocked until | Gate G0 passed                                          |
| Spec         | SPEC §9.7                                                |

Scope
- Node test: write a fixture bundle to a temp directory, spawn the installed `ngne-preview`
  binary on `<name>.preview.config.mjs`, assert it prints its loopback URL and no startup
  diagnostic, then terminate it.
- E2E fixture page `tests/fixtures/ngne-consumer/`: a minimal NGNE game whose scene lists
  `<name>Image` in `assets` and draws frames with `draw<Name>` from the generated module.
- For every frame of three fixture documents (no trim; trim + extrude; merged duplicates),
  screenshot the fixture canvas and compare with `compositeFrame`.
- Pivot check: a fixture with pivot `[0.5, 1]` draws with its bottom-centre at the anchor.
- Animation check: stepping the fixture game with a controlled scheduler shows the expected
  frame at t = 0, mid-entry, entry boundary and after the end for `loop` and `once`.

Acceptance
- All three conformance conditions of SPEC §9.7 pass in CI (SwiftShader) and locally (hardware).
- Comparison tolerance: opaque pixels exact; others ±1 per channel after blending over the
  fixture's clear colour.
- A deliberately corrupted bundle (rect outside image) fails the suite.
- Gate G4 is marked passed in `docs/tickets/README.md`.

---

## SE-054 · Preview panel (NGNE `BrowserGame`)

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-002, SE-006, SE-051                                   |
| Blocks       | SE-070                                                   |
| Blocked until | Gate G0 passed                                          |
| Spec         | SPEC §6.5; DESIGN §5.5                                   |

Scope
- `engine/NgnePreview`: a `BrowserGame` on the panel canvas, logical size = document size, CSS
  integer scaling with `image-rendering: pixelated`.
- Scene with no `assets`; atlas uploaded with `app.renderer.texture("pv:atlas", bitmap)`
  through the same single-flight queue used by the viewport.
- Input is `bundle()` output in memory (SE-051): atlas pixels + metadata. A system advances
  `ageMs` by `dt × 1000 × speed`; `resolveAnimationFrame` picks the frame; the render callback
  draws it with the same UV and pivot maths the generated module uses (shared function).
- Controls per DESIGN §5.5: animation select (all export animations + "All frames"),
  play/pause, speed, background.
- Repack and re-upload 150 ms after the last edit; recreate on document size change; stop when
  the panel is collapsed, the tab is hidden or no document is open; dispose on unmount.
- NGNE diagnostics other than dropped-tick notices are shown in the panel.

Acceptance
- E2E: paused on frame k, a screenshot of the preview canvas equals the composite of frame k
  (opaque exact, else ±1).
- Editing a pixel updates the preview within 500 ms.
- Changing a tag's direction to ping-pong changes the preview sequence without reload.
- Collapsing the panel stops the game loop (no frames submitted, verified by `afterFrame` count).
- Opening, switching and closing documents 20 times leaves at most one live `BrowserGame`.
- The viewport keeps rendering correctly while the preview runs (two renderers coexisting).
