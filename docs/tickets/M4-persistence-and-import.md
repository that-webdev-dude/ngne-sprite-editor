# M4 — Persistence and import

Goal: save and reopen projects safely; import PNGs as quantized sprites (C2) and as reference
images (C3).

---

## SE-040 · Project file format (`.ngsprite`)

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-003, SE-005                                           |
| Blocks       | SE-041, SE-045                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §10                                                 |

Scope
- `core/project`: `serialize(doc, referenceSources) → Uint8Array` and
  `deserialize(bytes) → { doc, referenceSources }` using `fflate`.
- Container per SPEC §10: `manifest.json`, `doc.json`, `images/*.png`, `refs/*.png`, `thumb.png`.
- `doc.json` schema version 1 documented in `docs/FORMAT.md` (written under this ticket).
- Migration scaffold: ordered `vN → vN+1` functions; v1 has none.
- Validation: manifest format/version, JSON shape, every referenced image present and of the
  document size, then `assertInvariants`.
- Linked cels serialize as one image.

Acceptance
- Round trip of a fixture (3 layers, 5 frames, linked cels, 2 tags, reference layer, palette,
  export settings) yields a deep-equal document with byte-identical pixels.
- Serialization is deterministic: same document → identical bytes.
- Typed, descriptive errors for: not a zip, missing manifest, newer version, missing image,
  wrong image size, invariant violation. No partial document is returned.
- Runs under Vitest in Node.
- Once merged, the v1 schema is frozen (gate G3).

---

## SE-041 · File workflows and document tabs

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-007, SE-040                                           |
| Blocks       | SE-042, SE-044, SE-052, SE-072                           |
| Blocked until | —                                                       |
| Spec         | SPEC §10; DESIGN §2, §7 (New sprite)                     |

Scope
- New (dialog), Open, Save, Save As, Close, Revert. File System Access API when available
  (handle kept per document, permission re-requested when needed); otherwise file input and
  download.
- Drag-and-drop of `.ngsprite` opens it.
- Dirty tracking from history position; unsaved marker in the tab and title; confirm on close;
  `beforeunload` guard while any document is dirty.
- Document tabs in the menu bar: switch, close, middle-click close, reorder; each tab has its
  own history, view and selection.
- Recent files list (handles in IndexedDB) on the empty state and in File → Open Recent.
- Empty state when no document is open: New, Open, Import PNG, recent files.

Acceptance
- E2E: draw, save, close, reopen — composite of every frame byte-identical; undo history is
  empty after reopen.
- Saving twice without changes writes identical bytes and clears the dirty marker each time.
- In a browser profile without File System Access, Save downloads a file and Open uses a file
  input (tested by stubbing the API away).
- Closing a dirty tab asks once; cancelling keeps the document.
- Two open documents never share state: drawing in one leaves the other's composite unchanged.

---

## SE-042 · Autosave and crash recovery

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-041                                                   |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §10                                                 |

Scope
- Snapshot each dirty document to IndexedDB 2 s after its last change (serialized with SE-040),
  off the main interaction path (chunked or in a worker if serialization exceeds 16 ms).
- Snapshot removed on successful save or explicit close-without-saving.
- On launch, list recoverable snapshots (name, time, thumbnail) with Recover / Discard.
- Storage quota errors are reported once and disable autosave for the session.

Acceptance
- E2E: draw, wait 3 s, reload without saving → recovery prompt → recovered composite is
  byte-identical to the pre-reload composite.
- After a normal save and reload, no recovery prompt appears.
- Autosave during a continuous 10 s stroke causes no dropped pointer samples (stroke has no
  gaps) on reference hardware.
- Discard removes the snapshot permanently.

---

## SE-043 · Import pipeline core (slice, resample, quantize)

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-003, SE-005                                           |
| Blocks       | SE-044, SE-060                                           |
| Blocked until | Assumption A3 not overridden by the owner               |
| Spec         | SPEC §8                                                  |

Scope: pure functions in `core/import`, each step independently testable.
- `crop`, `sliceGrid` (cell size or columns×rows, offset, spacing, skip empty cells).
- `resample(buffer, w, h, { method, fit })`: nearest, area average (alpha-weighted), dominant
  colour per block; fit stretch / contain / cover.
- `applyAlpha`: threshold to binary; colour key with tolerance.
- `core/color/oklab`: sRGB8 ↔ OKLab.
- `buildPalette(buffers[], n)`: median cut over all buffers, then 8 k-means iterations seeded
  from the median-cut result; deterministic; ignores fully transparent pixels.
- `mapToPalette(buffer, palette, { dither })`: nearest in OKLab; none, Bayer 4×4,
  Floyd–Steinberg (serpentine off, fixed order).
- `runImport(source, settings) → { frames: PixelBuffer[], palette }` composing the steps with
  the limits of SPEC §8.

Acceptance
- Golden tests per step on small fixtures (including a 4×4 → 2×2 area average with mixed alpha
  and a grid slice with offset and spacing).
- `buildPalette` returns exactly n colours when the input has ≥ n distinct colours, and the
  input's own colours when it has fewer.
- Determinism: `runImport` twice with the same input and settings gives byte-identical output.
- A 2048×2048 source reduced to 16 colours at 64×64 completes in ≤ 500 ms (recorded, Node).
- Mapping an image already using only palette colours is the identity.
- Limit violations throw typed errors naming the limit.

---

## SE-044 · Import PNG dialog

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-006, SE-021, SE-041, SE-043, SE-045                   |
| Blocks       | SE-070                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §8; DESIGN §7 (Import PNG)                          |

Scope
- Entry points: File → Import PNG, drop a PNG on the window, paste an image with no document
  focus target. Dropping/pasting asks: sprite, reference, or both.
- Dialog per DESIGN §7: source pane with draggable crop rectangle and grid overlay; result pane
  showing the frames at target size with zoom; the nine steps as form controls; summary line.
- Live preview recomputed off the main thread (worker) with cancellation; controls stay
  responsive.
- Destinations: new document; append as frames to the current document; new layer in the
  current document (frames aligned from the active frame, adding frames if needed).
- "Keep source as reference" creates a reference layer aligned to the cropped region.
- Palette handling choice: replace document palette, append new colours, leave unchanged.
- Settings remembered per session.

Acceptance
- E2E: import a 256×64 sheet as 4 frames of 32×32 with 8 colours → document has 4 frames, each
  32×32, using ≤ 8 colours, equal to `runImport` output for the same settings.
- E2E: import with "keep source as reference" → reference layer exists, sits behind, and its
  on-screen bounds coincide with the canvas bounds (±1 device pixel).
- Appending to a document of a different size is blocked with an inline message.
- Import into an existing document is one undo step.
- Changing a setting updates the preview within 300 ms for a 1024×1024 source (recorded).
- A non-PNG or corrupt file shows an inline error and leaves the dialog usable.

---

## SE-045 · Reference layers

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-011, SE-022, SE-040                                   |
| Blocks       | SE-044                                                   |
| Blocked until | Assumption A7 not overridden by the owner               |
| Spec         | SPEC §7.6, §6.4                                          |

Scope
- Commands: add reference layer from PNG bytes, delete, set position, scale, opacity,
  visibility, lock, placement (behind / front), reset to fit.
- Rendering through slots `ed:ref:0..3`: CPU resample of the source to on-screen device size
  (`resizeQuality: "high"`), capped per SPEC §7.6, re-run 100 ms after zoom settles; drawn by
  NGNE with `alpha`, at `layer` 2 (behind) or 6 (front).
- Timeline: "Reference" group at the bottom of the layer column with visibility, lock, opacity.
- Move tool on an unlocked reference layer drags it; corner handles scale uniformly.
- Paint tools refuse reference layers (SE-014 guard).
- Menu: Layer → New Reference Layer from File; limit of four with a clear message.
- Reference sources kept in a per-document blob store and saved by SE-040.

Acceptance
- E2E: add a reference image → it renders behind pixel layers at 50% opacity, fitted and
  centred; drawing on a pixel layer appears above it.
- At scale 4 a 2000×2000 reference fitted to a 64×64 canvas is displayed without nearest
  minification artefacts (screenshot compared to a high-quality downscale, mean error ≤ 2/255).
- Save and reopen restores position, scale, opacity, placement and the identical source bytes.
- No export (any format) and no preview-panel frame contains reference pixels.
- Zooming rapidly never shows a "texture not ready" diagnostic and never blanks the frame.
- Every property change is undoable.
