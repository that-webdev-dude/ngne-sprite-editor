# M6 — Palette and parity extras

Goal: close the remaining v1 rows of the parity matrix (SPEC §2.3). Tickets here are independent
of each other except where a dependency is listed. All are part of v1: release gate G3 requires
each to be Done or descoped by the owner in writing.

---

## SE-060 · Palette panel

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-016, SE-043                                           |
| Blocks       | SE-066                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §2.3 (Colour); DESIGN §5.4                          |

Scope
- Panel per DESIGN §5.4, replacing the read-only grid of SE-016: highlight of the swatch equal
  to FG, add current colour, remove, drag to reorder, edit a swatch in the picker, keyboard
  navigation with arrow keys, overflow menu on the Menu key.
- Palette commands are undoable and stored in the document (at most 256 colours).
- Preset menu loading the palettes of `core/palettes` (SE-043).
- Palette from sprite: unique colours when ≤ 256, otherwise `buildPalette` (SE-043).

Acceptance
- Palette from sprite on an image with 5 colours returns exactly those 5.
- Add, remove, reorder and edit are each one undo step.
- Loading a preset replaces the palette in one undo step.
- A 256-colour palette renders as a scrolling grid of 16 px swatches with no horizontal overflow
  at dock widths 220 and 360.
- Arrow keys move swatch focus; Enter sets FG; Shift+Enter sets BG.

---

## SE-061 · Blend modes and cel opacity

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-010, SE-022                                           |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §5.1 (`BlendMode`), §5.3, §2.3 (Layers)             |

Scope
- Compositor blend functions for every `BlendMode` value, matching Aseprite's formulas.
- Layer properties popover: blend mode select (command from SE-020).
- Cel properties popover (DESIGN §7), opened from the Frame menu for the active cel: cel opacity
  (command from SE-021).

Acceptance
- Golden tests per mode for a fixed 4×4 source/destination matrix including transparent,
  half-transparent and opaque pixels (expected values computed from the published formulas and
  stored as fixtures).
- With every layer set to normal and every cel at 255, `compositeFrame` output is byte-identical
  to the pre-ticket compositor on the regression fixtures.
- Changing a blend mode or cel opacity is undoable and updates the viewport within two
  animation frames.
- Merge down of a multiply layer equals `compositeFrame` of the two layers.

---

## SE-062 · Symmetry and tiled mode

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-011, SE-015, SE-017                                   |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §2.3 (View), §5.1 (`DocSettings`), §6.4             |

Scope
- Symmetry: horizontal, vertical or both, with draggable axes (snapping to half-pixel
  positions); applies to pencil, eraser, line, rectangle, ellipse and bucket seeds; axes drawn
  on the overlay. Stored in `DocSettings.symmetry` (setter; saved, not undoable).
- Tiled mode: X, Y or both, stored in `DocSettings.tiled`. The viewport draws the current frame
  slot 3×3 (NGNE sprites); paint wraps around the canvas edges.
- View menu toggles.
- From the SE-015 review: symmetry and tiled wrap belong in the `Stamper` of
  `core/raster/stroke.ts`. Inks compute from the stroke-start copy, so a pixel stamped twice
  (the centre column) gets one value. Pixel-perfect filters the base path before mirroring.
  The Shift anchor (`lastStrokeEnd`) is kept per `DocSession` in
  `app/tools/brush/freehandTool.ts`.
  The stroke echo (SPEC §6.6) draws the stroke's frame once; in tiled mode it must also draw
  each copy, or the copies lag the stroke by an upload.
- From the SE-017 review: line, rectangle and ellipse do not stamp through `Stamper`; they mark
  their pixels in `ShapeStroke` (`core/raster/shapeStroke.ts`), so their symmetry and wrap go
  into its mark pass (mirror the outline pixels and filled runs before marking). The bucket
  reads its source in place: with symmetric seeds, compute every seed's flood mask before any
  paint and paint their union, or a later seed reads what an earlier one wrote.
- From SE-065 (REVIEW F19): symmetry and wrap also apply to its four tools. The spray and the
  contour's outline stamp through `Stamper`; the contour's inside is written by
  `Stamper.inkRun` (and the row range the Stamper owns), a second write path that must mirror
  and wrap too; the curve and the polygon draw through `ShapeStroke`. Read the symmetry and
  tiled settings where `Stamper` and `ShapeStroke` get their options, so the tool modules
  need no edit.

Acceptance
- A stroke with horizontal symmetry on an even-width canvas is a pixel-exact mirror; one undo step.
- With an axis at a half-pixel on an odd-width canvas the centre column is painted once.
- In tiled mode, a stroke crossing the right edge continues from the left edge; readback shows
  the nine copies aligned at DPR 1 and 1.5.
- `compositeFrame` output is unaffected by tiled mode and by the axes (unit test).

---

## SE-063 · GIF export

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-043, SE-052                                           |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §9.6, §2.3 (File)                                   |

Scope
- Animated GIF via `gifenc`: frames from `compositeFrame` (all frames or one tag, expanded with
  `expandTag`), per-frame delays rounded to 10 ms (minimum 20 ms), loop count from the tag,
  scale 1–8×, per-frame palette from `buildPalette` capped at 256, 1-bit transparency.
- Appears as a format in the export dialog.

Acceptance
- GIF of a 4-frame fixture decodes (in a browser test with `ImageDecoder`) to 4 frames with the
  expected delays and exact colours for a ≤ 256-colour fixture.
- A ping-pong tag exports its expanded sequence.
- Frames with more than 256 colours export with a quantization warning toast, not a failure.

---

## SE-064 · Preferences dialog, command palette and shortcut sheet

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-007                                                   |
| Blocks       | SE-071                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.8; DESIGN §4 (Command palette), §7 (Preferences, Shortcut sheet) |

Scope
- Command palette (Ctrl+K): fuzzy search over the registry, shows shortcuts and disabled state,
  recent commands first.
- Preferences dialog editing the SE-007 preference store: checkerboard colours and size,
  default grid, onion-skin defaults, default import settings, autosave on/off. (Each consumer
  reads the store in its own ticket; this ticket only edits it.) The theme is edited through
  the SE-006 theme store (`src/ui/theme`), which stays its single owner.
- Shortcut sheet (`?`): generated from the registry, grouped by menu.

Acceptance
- Every enabled command can be run from the palette; disabled commands are listed but inert.
- Changing a preference updates the store and notifies subscribers without reload (asserted
  with a test subscriber for every field); the value persists across reloads.
- Changing the theme changes the running app immediately.
- The shortcut sheet lists exactly the registry's shortcuts (test compares).

---

## SE-065 · Tools II: curve, contour, polygon, spray

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | In progress                                              |
| Depends on   | SE-017                                                   |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §2.3 (Tools), §7.8                                  |

Scope
- Curve (cubic Bézier, Aseprite's click-drag-adjust flow, `gesture` context), contour (freehand
  closed shape, filled; key D), polygon (click vertices, outline or filled), spray (radius,
  density, seeded RNG per stroke so undo/redo and tests are deterministic).
- Variants grouped under their neighbours in the tool rail.
- From SE-031 (REVIEW F2, F5, F6): a variant joins a slot through `variantOf` in its own
  `*.tools.ts` module; `planned.tools.ts` keeps its 13 slots. A key pressed again while its
  tool is selected cycles only among the slot's variants of the same letter
  (`tool.<id>.next`), so B and Shift+B, L and Shift+L, D and Shift+D switch within a slot only
  when both tools share it; decide the grouping with that in mind and run the E2E files that
  press B or L while that tool is selected (`se-007-keymap`, `se-015-pencil`). The polygon
  tool and the curve open their gestures through `ToolContext.openGesture` and close with
  `tool.gesture.close`; the polygon lasso's vertex rule (a vertex at every press and release)
  is a model for the polygon tool.

Acceptance
- Golden tests: rasterized curve for fixed control points; filled polygon for a concave shape
  (even-odd rule); contour fill equals polygon fill of the same path.
- Spray with a fixed seed is reproducible; one stroke is one undo step.
- Each tool supports Escape to cancel and respects selection clipping and layer guards.

---

## SE-066 · Palette files, replace colour and sort

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-030, SE-060                                           |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §2.3 (Colour); DESIGN §5.4, §7 (Replace colour)     |

Scope
- Import/export: GIMP `.gpl`, `.hex` (one colour per line), JASC `.pal`, and import from a PNG
  (unique colours, up to 256). Codecs in `core/palettes`.
- Replace colour dialog: all occurrences in the selection, cel, frame or sprite, with tolerance.
- Sort by hue, luminance (OKLab L), or original order.

Acceptance
- Round-trip tests for `.gpl`, `.hex` and `.pal` on a 32-colour fixture.
- Malformed palette files produce an error toast and no change.
- Replace colour across the sprite is one undo step and changes only matching pixels; with a
  selection active and scope "selection", pixels outside it are untouched.
- Sort is one undo step; "original order" restores the order held before the first sort.
