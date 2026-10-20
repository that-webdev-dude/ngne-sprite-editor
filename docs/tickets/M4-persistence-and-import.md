# M4 — Persistence and import

Goal: save and reopen projects safely; import PNGs as quantized sprites (C2) and as reference
images (C3).

---

## SE-040 · Project file format (`.ngsprite`)

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-003, SE-005, SE-010                                   |
| Blocks       | SE-034, SE-041, SE-045                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §10, §5.1                                           |

Scope
- `core/project`: `serialize(doc, referenceSources) → Uint8Array` and
  `deserialize(bytes) → Promise<{ doc, referenceSources }>` (asynchronous, as the PNG decoder
  of SE-005 is) using `fflate`, with fixed entry timestamps and PNG entries stored uncompressed.
- Container per SPEC §10: `manifest.json`, `doc.json`, `images/*.png`, `refs/*.png`, `thumb.png`
  (from `compositeFrame` of the first frame, nearest-scaled to at most 128 px).
- `doc.json` covers every `SpriteDoc` field of SPEC §5.1, including `settings` and
  `exportSettings`. Session state (selection, active layer/frame) is not written.
- Schema version 1 documented in `docs/FORMAT.md` (file created here if absent).
- Migration scaffold: ordered `vN → vN+1` functions; v1 has none.
- Validation: manifest format/version, JSON shape, every referenced image present and of the
  document size, then `assertInvariants`.
- Linked cels serialize as one image.

Acceptance
- Round trip of a fixture (3 layers, 5 frames, linked cels, 2 tags, reference layer, palette,
  non-default settings and export settings) yields a deep-equal document with identical pixels.
- Serializing the same document twice yields identical bytes, also across two runs one second
  apart (fixed timestamps).
- Golden test compares decoded pixels and parsed JSON of a committed `.ngsprite` fixture, not
  raw zip bytes.
- A session with a selection serializes to the same bytes as one without.
- Typed, descriptive errors for: not a zip, missing manifest, newer version, missing image,
  wrong image size, invariant violation. No partial document is returned.
- Runs under Vitest in Node.

---

## SE-041 · File workflows

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | SE-007, SE-008, SE-040                                   |
| Blocks       | SE-042, SE-044, SE-047, SE-052                           |
| Blocked until | Gate G1 passed                                          |
| Spec         | SPEC §10, §7.8; DESIGN §6 (empty state)                  |

Scope
- Open, Save, Save As, Close, Revert. File System Access API when available (handle kept per
  document, permission re-requested when needed); otherwise file input and download.
- Drag-and-drop of `.ngsprite` opens it; Open on the empty state.
- Save applies a floating selection first (`applyFloating()` hook; a no-op until SE-032).
- Save records the saved history position and clears the dirty flag (SE-007 store, rule of
  SPEC §5.2); unsaved marker next to the document name; confirm on close; `beforeunload` guard
  while any document is dirty.
- The document's reference source bytes (SE-007 store) are passed to `serialize` and restored
  from `deserialize`.
- Results and failures reported by toast.

Acceptance
- E2E: draw with the pencil, save, close, reopen — composite of every frame byte-identical;
  undo history is empty after reopen.
- Saving twice without changes writes identical bytes and clears the dirty marker each time.
- With the File System Access API stubbed away, Save downloads a file and Open uses a file input.
- Closing a dirty document asks once; cancelling keeps the document.
- Opening a corrupt file shows an error toast naming the problem and leaves the current
  document untouched.

---

## SE-042 · Autosave and crash recovery

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-041                                                   |
| Blocks       | SE-072                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §10; DESIGN §7 (Recovery)                           |

Scope
- Snapshot each dirty document to IndexedDB 2 s after its last change: `doc.json` plus raw image
  buffers keyed by image ID; only images changed since the last snapshot are rewritten;
  reference sources written once.
- Snapshot removed on successful save or explicit close-without-saving.
- On launch, the recovery dialog lists snapshots (name, time, thumbnail) with Recover / Discard.
- Storage quota errors are reported once by toast and disable autosave for the session.
- Honours the autosave preference (SE-007 store).
- From SE-032 (REVIEW F33): a floating selection holds the document's transaction open for as
  long as it floats, so a reader of the document or the composite cache must not wait for an
  idle history (SPEC §5.3); call `applyFloating()` first where the ticket's action must
  include the floating pixels (`src/app/selection/floating.ts`).
- From the SE-047 review (REVIEW F62): a document closes through two paths, the active tab's
  Close and `closeBackground` for another tab; remove the snapshot on both (or where
  `sessions.close` runs). Save As to another file gives the document a new id
  (`sessions.changeId`), so snapshots keyed by document id must follow it. Since SE-045 the
  store holds only the reference sources a layer names; the steps own the others.

Acceptance
- E2E: draw, wait 3 s, reload without saving → recovery prompt → recovered composite is
  byte-identical to the pre-reload composite.
- After a normal save and reload, no recovery prompt appears.
- Editing one cel of a 16-frame, 256×256 document writes exactly one image record (IndexedDB
  write spy).
- No long task over 50 ms is attributed to autosave for that document (PerformanceObserver in
  the E2E run on reference hardware, recorded).
- Discard removes the snapshot permanently.

---

## SE-043 · Import pipeline core and preset palettes

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | SE-003, SE-005                                           |
| Blocks       | SE-044, SE-060, SE-063                                   |
| Blocked until | Owner acknowledgement of A3 recorded in REVIEW.md       |
| Spec         | SPEC §8                                                  |

Scope: pure functions in `core/import`, each step independently testable.
- `crop`, `sliceGrid` (cell size or columns×rows, offset, spacing, skip empty cells), and
  `cellsFromFiles` (one cell per decoded file, natural filename order).
- `resample(buffer, w, h, { method, fit })`: nearest, area average (alpha-weighted), dominant
  colour per block; fit stretch / contain / cover; identity when the size already matches.
- `applyAlpha`: threshold to binary; colour key with tolerance.
- `core/color/oklab`: sRGB8 ↔ OKLab.
- `buildPalette(buffers[], n)`: median cut over all buffers, then 8 k-means iterations seeded
  from the median-cut result; deterministic; ignores fully transparent pixels.
- `mapToPalette(buffer, palette, { dither })`: nearest in OKLab; none, Bayer 4×4,
  Floyd–Steinberg (fixed left-to-right, top-to-bottom order).
- `smartDefaults(cells, targetSize)` implementing the default rules of SPEC §8.
- `runImport(sources, settings) → { frames: PixelBuffer[], palette }` composing the steps with
  the limits of SPEC §8.
- `core/palettes`: preset palettes as data — DawnBringer 16 and 32, PICO-8, Sweetie 16,
  Endesga 32, AAP-64, Game Boy (4), 1-bit — each with name and source attribution.

Acceptance
- Golden tests per step on small fixtures (including a 4×4 → 2×2 area average with mixed alpha,
  a grid slice with offset and spacing, and three files in natural order `a2, a10, a1` →
  `a1, a2, a10`).
- `buildPalette` returns exactly n colours when the input has ≥ n distinct colours, and the
  input's own colours when it has fewer.
- Determinism: `runImport` twice with the same input and settings gives byte-identical output.
- `smartDefaults`: binary-alpha, 12-colour, same-size input → Keep/Keep; a photo larger than
  the target size → threshold 128 / Reduce to 16.
- A 2048×2048 source reduced to 16 colours at 64×64 completes in ≤ 500 ms (recorded, Node).
- Mapping an image already using only palette colours is the identity.
- Limit violations throw typed errors naming the limit.
- Each preset palette has the documented number of colours and no duplicates.

---

## SE-044 · Import PNG dialog

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | SE-006, SE-021, SE-041, SE-043, SE-045                   |
| Blocks       | SE-070                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §8; DESIGN §7 (Import PNG, Drop chooser)            |

Scope
- Entry points: File → Import PNG (multi-select), dropping PNG files on the window, the empty
  state, and pasting an image while no document is open (with a document open, paste belongs to
  SE-032). Dropping one image shows the drop chooser (sprite, reference, both).
- Large dialog per DESIGN §7: source pane with draggable crop rectangle and grid overlay; result
  pane showing the frames at target size with zoom; the steps as form controls initialized from
  `smartDefaults`; summary line.
- Live preview recomputed in a worker with cancellation; controls stay responsive.
- Destinations: new document; append as frames to the current document; new layer in the
  current document (frames aligned from the active frame, adding frames if needed).
- "Keep source as reference" (single-sprite imports only; disabled otherwise) creates a
  reference layer aligned to the cropped region.
- Palette handling choice: replace document palette, append new colours, leave unchanged.
- Settings remembered per session; defaults from the preference store.
- From the SE-064 review: the stored preference `import.dither` says `"ordered"` where
  `core/import` says `"bayer"`; the dialog maps between them. The preference store has no fit
  field: the default fit is "contain" (SPEC §8).
- From the SE-045 review (REVIEW F58): "Keep source as reference" builds its layer with
  `referenceLayerCommandFromPng` (`src/app/references/references.ts`), which returns the step
  without running it, its source bytes owned by the step; chain it with the import so one undo
  removes both.

Acceptance
- E2E: import a 256×64 sheet as 4 frames of 32×32 with 8 colours → document has 4 frames, each
  32×32, using ≤ 8 colours, equal to `runImport` output for the same settings.
- E2E: selecting three PNG files yields three frames in natural filename order.
- E2E: single-sprite import with "keep source as reference" → reference layer exists, sits
  behind, and its on-screen bounds coincide with the bounds of the fitted image (the canvas
  bounds for a source of the canvas's aspect ratio), ±1 device pixel.
- With grid slicing producing more than one cell, "keep source as reference" is disabled.
- E2E: dropping one PNG shows the chooser; "Add as reference" adds only a reference layer.
- "New layer" into a 2-frame document from a 4-cell import yields 4 frames and one new layer.
- Palette choice "append" adds only colours not already present.
- Appending to a document of a different size is blocked with an inline message.
- Import into an existing document is one undo step.
- Changing a setting updates the preview within 300 ms for a 1024×1024 source (recorded).
- A non-PNG or corrupt file shows an inline error and leaves the dialog usable.

---

## SE-045 · Reference layers

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | SE-011, SE-022, SE-040                                   |
| Blocks       | SE-044, SE-046                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §7.6, §6.4                                          |

Scope
- Commands: add reference layer from PNG bytes, delete, set position, scale, opacity,
  visibility, lock, placement (behind / front), reset to fit. All undoable.
- Display pipeline per SPEC §7.6: decode with SE-005, display source limited to 4096 px per
  side, CPU resample to on-screen size 100 ms after zoom settles, 16 MP total texel budget,
  slots `ed:ref:0..3`, 1×1 placeholder for removed layers; drawn by NGNE with `alpha` at
  `layer` 2 (behind) or 6 (front).
- Timeline: "Reference" group at the bottom of the layer column with visibility, lock, opacity;
  layer properties popover with X, Y, scale and placement fields.
- Menu: Layer → New Reference Layer from File; limit of four with a toast when exceeded.
- Reference sources kept in the per-document store of SE-007 and round-tripped by SE-040.
- From the SE-015 review: the stroke echo (SPEC §6.6) is drawn opaque over the composite's
  place, so it hides a reference placed in front (quad layer 6), and one behind (layer 2) under
  transparent pixels, where it lies. Decide how it gives way while a reference is on screen and
  test it.

Out of scope: dragging and scaling on the canvas (SE-046).

Acceptance
- E2E: add a reference image → it renders behind pixel layers at 50% opacity, fitted and
  centred; pixels committed to a pixel layer through a patch command appear above it.
- Readback at scale 4 of a 2048×2048 smooth two-axis gradient fitted to a 64×64 canvas: mean
  absolute error against a box-filter downscale of the same gradient ≤ 4/255 per channel.
- Readback of a 50%-alpha flat-colour reference over the checkerboard is within ±2 per channel
  of the expected blend.
- `compositeFrame` output is identical with and without the reference layer.
- `serialize`/`deserialize` restores position, scale, opacity, placement and identical source
  bytes.
- A fifth reference layer is refused with the toast; the document is unchanged.
- Zooming through all steps within 1 s logs no "texture not ready" diagnostic and never shows a
  frame without the document.
- After deleting all reference layers, `renderer.inspect()` texture bytes return to within 1 MB
  of the pre-reference baseline.
- Every property change is one undo step.

---

## SE-046 · Reference layer move and scale on the canvas

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-032, SE-045                                           |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §7.6                                                |

Scope
- With an unlocked reference layer active, the Move tool drags it; corner handles on the
  overlay scale it uniformly about the opposite corner.
- One undo step per drag.
- From the SE-033 review (REVIEW, run 3 leg 3): the box helpers in
  `src/app/selection/transform/` (`handlePoints`, `hitBox`, `drawTransformBox`) work with
  fractional boxes and can be reused; `scaleBox` rounds to whole pixels and scales width and
  height apart, so the uniform scale about a fixed corner needs its own function. The Move
  tool's press routing is in `src/app/selection/move/moveTool.ts` (`onDown`).
- From the SE-045 review (REVIEW F58): a locked reference keeps its position, scale and
  placement (SPEC §7.6); `changeReference` and `resetReferenceFit` in
  `src/app/references/references.ts` apply one step and refuse with the lock reason.

Acceptance
- E2E: drag by (10, 4) document pixels changes `x`, `y` by exactly that; undo restores.
- Corner drag changes `scale` and keeps the opposite corner fixed within 0.01 document pixels.
- A locked reference layer does not move and the status bar says so.

---

## SE-047 · Document tabs and recent files

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-041                                                   |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §2.3 (Document); DESIGN §2 (tabs), §6 (empty state) |

Scope
- Several open documents: tab strip in the menu bar (switch, close, middle-click close, reorder,
  overflow per DESIGN §2); New and Open add a tab instead of replacing.
- Each tab has its own session, history, view and reference blob store.
- Composite caches (SPEC §5.3) are per document. A document that stops being active has its
  cache cleared, so the 128 MB budget is not multiplied by the number of tabs.
- Recent files (File System Access handles in IndexedDB) on the empty state and in
  File → Open Recent; entries whose permission is gone prompt once, then are removed on denial.
- From SE-041 (REVIEW F17): Open replaces the active document after the discard question until
  this ticket; the unit test titled "… (until SE-047)" in `tests/unit/se-041-workflows.test.ts`
  is this ticket's to replace with the tab rule. The empty-state assertions of
  `se-006-boundary` and `se-008-new-sprite` are placeholders this ticket may extend (B3).

Acceptance
- E2E: open two documents; drawing in one leaves the other's composite unchanged; undo acts on
  the active tab only.
- Closing a dirty tab asks once; closing the last tab shows the empty state.
- With three open documents only the active one holds composites (the cache of each other
  document reports 0 bytes).
- With 12 open tabs at 1280 px width, every tab is reachable (scroll or overflow menu).
- A saved file appears first in the recent list after reload and reopens from it.
