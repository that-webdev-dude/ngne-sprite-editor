# M5 — NGNE export

Goal: export a bundle NGNE consumes unmodified (C1) and preview it in-engine.
Exit: gate G2 ([README](README.md#gates)).

---

## SE-050 · Atlas packer

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-005, SE-010                                           |
| Blocks       | SE-051                                                   |
| Blocked until | Owner acknowledgement of A2 recorded in REVIEW.md       |
| Spec         | SPEC §9.2, §9.4                                          |

Scope
- `core/export/pack(frames: PixelBuffer[], options) → { atlas: PixelBuffer, rects }` where each
  rect carries `x, y, w, h, sourceW, sourceH, offsetX, offsetY`, the unpadded content size
  `contentW, contentH` (the content size of SPEC §9.2: the part of the rect inside the source
  frame) and the source frame indices it serves.
- Every rect has even `w` and `h` (odd sizes padded with a transparent column/row on the
  right/bottom), with or without trim.
- Layouts: near-square grid, single row, single column; atlas size per the formula of SPEC §9.4.
  Options: padding 0–8, extrude 0–2, trim, merge identical frames.
- Input frames come from `compositeFrame` (visible pixel layers only).
- Fully transparent pixels normalized to `0,0,0,0`.
- Side limit 8192; typed error naming the limit and the required size.

Acceptance
- Golden tests: 8 frames of 32×32, padding 1 → expected atlas size and rect positions for each
  layout (grid 3×3 cells → 100×100).
- A 33×33 frame yields a 34×34 rect with `sourceW = sourceH = 33`, `offsetX = offsetY = 0`, and
  a transparent last column and row.
- Every packed rect, cropped from the atlas to its unpadded size, equals its (trimmed) source
  frame byte-exactly.
- Extrude replicates edge pixels into the gutter and never overlaps another rect.
- With merge on, identical frames share one rect; with merge off they do not.
- A fully transparent frame with trim on yields a 2×2 transparent rect.
- Deterministic: identical input and options → identical atlas pixels and rects.

---

## SE-051 · NGNE bundle writers

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | SE-003, SE-021, SE-050                                   |
| Blocks       | SE-052, SE-053, SE-054                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §9.1–§9.5                                           |

Scope
- `core/export/bundle(doc, settings) → { files: { name, bytes }[], atlas, meta }`.
- Name rules: slugify with the `sprite` fallback; identifier derivation of SPEC §9.5; ID pattern
  check; case-insensitive uniqueness; numeric suffixes for clashes.
- Document → atlas mapping per SPEC §9.3 using `expandTag` (SE-021), including the
  `frames: { tagId }` subset.
- Writers: `<name>.png` (SE-005), `<name>.atlas.json` (stable key order, 4-space indent,
  trailing newline), `<name>.sprites.ts`, `<name>.preview.config.mjs` (shape of SPEC §9.5,
  `src` as a `file:` URL object), and the optional `<name>.aseprite.json` (array or hash) with
  the fields and the unpadded-size mapping of SPEC §9.5.
- `core/export/sprite-runtime.ts`: the single runtime source (draw maths of SPEC §9.2 including
  top-left placement, `animationFrame`, `animationDone`), written against a structural
  sprite-sink type (no engine import), imported as code and, by the generator, as raw text; the
  generator adds the `@ngne/core` import lines.
- `core/export/atlasFor(frames, doc, settings) → { atlas, meta }`: packing and metadata without
  the file writers, used by `bundle()` and by the preview worker (SE-054).
- `validateAtlas(json, pngSize)`: schema and bounds validation, including even `w`/`h`.
  Rectangles must lie inside the PNG; they may extend one pixel past the source frame (SPEC §9.2).
- `docs/FORMAT.md` gains the `ngne-sprite-atlas` v1 section (file created here if absent).

Acceptance
- Golden-file tests for all five outputs on a fixture with 3 tags (forward loop, ping-pong,
  reverse repeat 2), frames outside any tag, an odd document size and trim on.
- In `<name>.aseprite.json` for a 33×17 untrimmed document, every `frame` and `sourceSize` is
  33×17 (not the padded 34×18), `trimmed` is false and `filename` equals the frame ID.
- Name cases: `Hero Walk` → `hero-walk` / `heroWalk`; `2d-hero` → identifiers `sprite2dHero`,
  `Sprite2dHero`; `★★` → `sprite`.
- `validateAtlas` rejects: missing field, non-integer rect, odd `w`, rect outside image, bad ID,
  IDs differing only by case, animation referencing an unknown frame, non-positive `ms`,
  `durationMs` not equal to the sum of entries.
- Generated `<name>.sprites.ts` compiles against `@ngne/core` 0.2.1 with the flags listed in
  SPEC §9.5 (a test runs the compiler on it).
- Generated `<name>.preview.config.mjs`, written with its PNG to a temp directory, is accepted
  by NGNE's own validator: the test imports
  `node_modules/@ngne/core/dist/preview/host.js` by file URL and awaits
  `loadAdapter(configPath)` without error. A config with a relative string `src` is rejected by
  the same call (guards against regressions).
- The runtime text emitted into `<name>.sprites.ts` is byte-identical to
  `sprite-runtime.ts` (minus its import/export lines, by a documented marker).
- Unit tests of the draw maths: untrimmed centre pivot equals NGNE's `demo/sprites.ts` result;
  off-centre pivot with trim; rotation 90°; `flipX`; `scale: 2`; integer edges for an integer
  anchor at rotation 0.
- Deterministic bytes for all files within one run and across two runs.

---

## SE-052 · Export dialog and delivery

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | In progress                                              |
| Depends on   | SE-006, SE-041, SE-051, SE-053                           |
| Blocks       | SE-063, SE-070                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §9.6; DESIGN §7 (Export, Overwrite confirm)         |

Scope
- Export dialog per DESIGN §7: bundle options, file toggles, frames (all / one tag), pivot
  control (same command as Sprite properties), atlas thumbnail with rects, resulting files and
  sizes, final frame and animation IDs, warnings (renamed IDs, atlas within 10% of the limit).
  Option changes go through `ExportSettings` setters (saved, not undoable); the pivot change is
  the undoable command.
- Export applies a floating selection first.
- Delivery: directory picker (File System Access) with the handle stored per document in
  IndexedDB; zip download otherwise. Overwrite confirmation once per folder.
- "Export again" without the dialog; `exportOnSave`.
- Other exports: current frame PNG (scale 1–16×, nearest), sprite sheet PNG alone, PNG
  sequence as zip.
- Result toast: number of files and destination name; error toast on failure.
- From the SE-051 review: `bundle()` refuses with `ExportError` (`too-many-entries`,
  `too-many-frames`) and `PackError` (`atlas-size`); each is shown as a message in the dialog
  and as the error toast of "Export again". Different documents can share an export name
  ("Hero Walk" and "hero_walk"), so the overwrite confirmation names the files that exist.
- From the SE-053 review: `core/export` cannot be imported by the Playwright process (the
  sprites module reads the runtime with `?raw`), so the bytes expected of an export are taken
  from the page (`tests/e2e/se-053-support.ts`). SE-053 proves `bundle()` for all frames and
  the default options only: this ticket adds a conformance draw (SE-053's consumer fixture)
  for an export of one tag, whose frame IDs do not start at 0.
- From SE-032 (REVIEW F33): a floating selection holds the document's transaction open for as
  long as it floats, so a reader of the document or the composite cache must not wait for an
  idle history (SPEC §5.3); call `applyFloating()` first where the ticket's action must
  include the floating pixels (`src/app/selection/floating.ts`).

Acceptance
- E2E (File System Access stubbed with an in-memory directory): export writes exactly the
  enabled bundle files with bytes equal to `bundle()` output.
- "Export again" after an edit rewrites the files without a dialog; the PNG differs, IDs do not.
- With `exportOnSave`, Ctrl+S saves the project and rewrites the bundle; a failed export does
  not block the save and shows an error toast.
- Without File System Access, a zip containing the same files downloads.
- Revoked folder permission triggers one re-prompt, then falls back to the dialog.
- Frame PNG at 4× is an exact nearest-neighbour upscale of the composite.
- An export whose animations pass the entry limit shows the error's message and writes no file.
- Sprite sheet PNG alone equals the bundle's `<name>.png`; the PNG sequence zip holds one file
  per frame named `<name>-<index>.png`, each equal to that frame's composite.
- Exporting one tag writes only that tag's frames and animation.

---

## SE-053 · Export conformance against NGNE (gate G2)

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | SE-002, SE-051                                           |
| Blocks       | SE-052, SE-070                                           |
| Blocked until | Gate G0 passed                                          |
| Spec         | SPEC §9.7, §6.7                                          |

Scope
- Fixture documents built in code: (a) 32×32, 4 frames, no trim; (b) 33×17 with trim and
  extrude 1; (c) merged duplicate frames; (d) pivot `[0.5, 1]`.
- From the SE-051 review: a rotated frame with a half-pixel pivot (odd size, centre pivot) is
  on whole pixels only under NGNE's default `pixelSnap`, and quarter turns of a trimmed sheet
  were 1 px apart near the view origin until SE-051's follow-up; the rotation checks draw at
  small anchors as well as large ones.
- `ngne-preview` check: write each bundle to a temp directory; spawn `process.execPath` with
  the absolute path of `node_modules/@ngne/core/dist/preview/cli.js` and the absolute config
  path; parse `NGNE preview: <url>` from stdout; open the URL in the E2E browser and keep that
  page in the foreground (the preview pauses when hidden); assert `#status` starts with
  `Ready` and `#error` is empty; select every frame in turn, wait until `#details` starts with
  `Frame <id>`, and re-assert; terminate the process.
- Consumer fixture `tests/fixtures/ngne-consumer/`: a minimal NGNE game (default camera
  `pixelSnap`) whose scene lists `<name>Image` in `assets` and draws with `draw<Name>` from the
  generated module; canvas read back in `afterFrame`.
- Comparisons against `compositeFrame`: every frame at an integer anchor; plus rotation 90°,
  `flipX`, `scale: 2`, and the pivot fixture (bottom-centre lands on the anchor).
- Animation check with a controlled scheduler: expected frame at t = 0, mid-entry, entry
  boundary and after the end for `loop` and `once`; `AnimationDone` flips at `durationMs`.

Acceptance
- All three conformance conditions of SPEC §9.7 pass locally (hardware) and in CI (SwiftShader).
- Tolerance: opaque pixels exact; others ±1 per channel after blending over the clear colour.
- A deliberately corrupted bundle (rect outside the image) fails: `validateAtlas` rejects it
  and the `ngne-preview` page shows an error instead of `Ready`.
- No orphaned `ngne-preview` process remains after the suite (process list check on Windows).
- Gate G2 is marked passed in `docs/tickets/README.md`.

---

## SE-054 · Preview panel (NGNE `BrowserGame`)

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-002, SE-006, SE-007, SE-011, SE-051                   |
| Blocks       | SE-070                                                   |
| Blocked until | Gates G0 and G1 passed                                  |
| Spec         | SPEC §6.5; DESIGN §5.5                                   |

Scope
- `engine/NgnePreview` per SPEC §6.5: a `BrowserGame` on its own canvas (`pointer-events: none`),
  logical size = document size, CSS size = `k × size / DPR`; one scene with no `assets`,
  `camera.pixelSnap = false`; serialized lifecycle queue; rebuild on failure or document size
  change.
- Atlas upload by the host after `start()` resolves, through `engine/UploadQueue` (SE-011); the
  render callback is gated on the first resolved upload.
- Input is `atlasFor()` output in memory (SE-051); drawing (top-left placement at the canvas
  origin) and frame resolution use `sprite-runtime.ts`. Packing runs in a worker 150 ms after
  the last edit, fed with frame composites (changed frames only after the first pack);
  oversized documents fall back per SPEC §6.5. Atlas metadata used for drawing is swapped only
  when the matching upload resolves.
- From the SE-051 review: an `ExportError` or `PackError` of `atlasFor()` (`too-many-entries`,
  `atlas-size`) is shown in the panel in place of the preview.
- From the SE-011 review: the upload queue is not busy once disposed and publishes nothing
  after that; the atlas metadata travels in the upload's tag and is read from
  `published("pv:atlas")`. The queue is disposed before the game.
- From the SE-053 review: conformance runs with NGNE's default `pixelSnap` only. The readback
  of this ticket is the first GPU check of the runtime with snapping off and of top-left
  placement at the canvas origin; it passes the background colour to the comparison as the
  colour beneath. Ages here are fractions of a millisecond (1/60 s ticks times the speed), so
  one test steps across an entry boundary at the default tick.
- Controls per DESIGN §5.5: animation select (all export animations + "All frames"),
  play/pause, speed, background (drawn as a rect).
- Stopped while the panel is collapsed, the tab is hidden or no document is open; disposed on
  unmount.
- NGNE diagnostics other than dropped-tick notices are shown in the panel.
- From the SE-014 review: the composite of the frame being stroked is one buffer rewritten in
  place until the commit (SPEC §5.3). The preview learns of changes from the cache's
  notifications, not from a buffer's identity, and copies what it keeps across an `await`.
- From the SE-015 review: the viewport's upload versions (`viewportLink.nextVersion`,
  `onDrawn`) are one counter for the page, not one per frame key; a reader of them compares
  versions of one key only.
- From SE-032 (REVIEW F33): a floating selection holds the document's transaction open for as
  long as it floats, so a reader of the document or the composite cache must not wait for an
  idle history (SPEC §5.3); call `applyFloating()` first where the ticket's action must
  include the floating pixels (`src/app/selection/floating.ts`).

Acceptance
- E2E readback (in `afterFrame`): paused on frame k, the preview canvas equals the composite of
  frame k (opaque exact, else ±1), for a 32×32 and a 33×17 document.
- At DPR 1.5 the canvas CSS size times DPR is a whole multiple of the document size.
- Drawing a pencil stroke updates the preview within 500 ms.
- During a repack that changes the atlas layout (frame added), every readback equals either the
  old or the new frame image in full (scripted with a delayed upload).
- Changing a tag's direction to ping-pong changes the preview sequence without reload.
- No "Texture is not ready" diagnostic appears on first open, on document switch or on rapid
  collapse/expand (20 toggles in 2 s).
- Collapsing the panel stops the game loop (`afterFrame` count stays constant for 1 s).
- Opening, switching and closing documents 20 times leaves at most one live `BrowserGame`.
- Wheel over the preview scrolls the dock; clicking it does not move keyboard focus to it.
- A document too large to pack shows the "Too large to preview" message and no error.
- The viewport keeps rendering correctly while the preview runs.
