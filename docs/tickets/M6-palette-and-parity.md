# M6 — Palette and parity extras

Goal: close the remaining v1 rows of the parity matrix (SPEC §2.3). Tickets here are
independent of each other and can be reordered or dropped without affecting M7 gates.

---

## SE-060 · Palette panel

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-016, SE-043                                           |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §2.3 (Colour); DESIGN §5.4                          |

Scope
- Panel per DESIGN §5.4: swatch grid, left/right click to set FG/BG, highlight of the swatch
  equal to FG, add current colour, remove, drag to reorder, edit a swatch in the picker.
- Palette commands are undoable and stored in the document.
- Presets bundled as data: DawnBringer 16 and 32, PICO-8, Sweetie 16, Endesga 32, AAP-64,
  Game Boy (4), 1-bit.
- Import/export: GIMP `.gpl`, `.hex` (one colour per line), JASC `.pal`, and from a PNG
  (unique colours, up to 256).
- Palette from sprite: unique colours when ≤ 256, otherwise `buildPalette` (SE-043).
- Replace colour: all occurrences in the selection, cel, frame or sprite, with tolerance.
- Sort by hue, luminance (OKLab L), or original order.

Acceptance
- Round-trip tests for `.gpl`, `.hex` and `.pal` on a 32-colour fixture.
- Palette from sprite on an image with 5 colours returns exactly those 5.
- Replace colour across the sprite is one undo step and changes only matching pixels.
- Malformed palette files produce an inline error and no change.
- Grid remains usable with 256 colours (scrolls; no layout break).

---

## SE-061 · Blend modes and cel opacity

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-010, SE-022                                           |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §5.3, §2.3 (Layers)                                 |

Scope
- Compositor blend functions matching Aseprite: normal, multiply, screen, overlay, darken,
  lighten, colour dodge, colour burn, hard light, soft light, difference, exclusion, hue,
  saturation, colour, luminosity, addition, subtract, divide.
- Layer properties popover: blend mode select; cel opacity in the cel context menu.
- Merge down and flatten bake the blend mode (SE-020 path).

Acceptance
- Golden tests per mode for a fixed 4×4 source/destination matrix including transparent,
  half-transparent and opaque pixels (expected values computed from the published formulas and
  stored as fixtures).
- Viewport, preview panel and every export show identical results (all read the compositor).
- Changing a blend mode is undoable and invalidates only the affected frames' cache.
- With every layer set to normal, output is byte-identical to the pre-ticket compositor.

---

## SE-062 · Symmetry and tiled mode

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-011, SE-015                                           |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §2.3 (View), §6.4                                   |

Scope
- Symmetry: horizontal, vertical or both, with draggable axes (snapping to half-pixel
  positions); applies to pencil, eraser, shapes and bucket seeds; axes drawn on the overlay.
- Tiled mode: X, Y or both. The viewport draws the frame slot 3×3 (NGNE sprites); paint wraps
  around the canvas edges.
- View menu toggles; state stored per document.

Acceptance
- A stroke with horizontal symmetry on an even-width canvas is a pixel-exact mirror; one undo step.
- With an axis at a half-pixel on an odd-width canvas the centre column is painted once.
- In tiled mode, a stroke crossing the right edge continues from the left edge; the nine copies
  stay aligned at DPR 1 and 1.5.
- Tiled copies and symmetry axes never appear in exports.

---

## SE-063 · Compatibility exports: Aseprite JSON and GIF

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-052                                                   |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §9.6, §2.3 (File)                                   |

Scope
- Aseprite-format sprite sheet JSON (hash and array variants) with `frames[*].frame`,
  `spriteSourceSize`, `sourceSize`, `duration`, and `meta.frameTags`, written next to the sheet.
- Animated GIF via `gifenc`: per-frame delays (rounded to 10 ms), loop count, scale 1–8×,
  per-frame palette from `buildPalette` capped at 256, 1-bit transparency.
- Both appear as formats in the export dialog.

Acceptance
- JSON output for a fixture matches a golden file whose structure follows the sample at
  `ngne-town-dungeon/authoring/exports/player.json` (array variant).
- GIF of a 4-frame fixture decodes (in a test, with a decoder dev-dependency or the browser's
  `ImageDecoder`) to 4 frames with the expected delays and pixel colours.
- Frames with more than 256 colours export with a quantization warning, not a failure.

---

## SE-064 · Preferences, command palette and shortcut sheet

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-007                                                   |
| Blocks       | SE-071                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.8; DESIGN §4 (Command palette), §7 (Preferences) |

Scope
- Command palette (Ctrl+K): fuzzy search over the registry, shows shortcuts and disabled state,
  recent commands first.
- Preferences dialog: theme, checkerboard colours and size, default grid, onion-skin defaults,
  default import settings, autosave on/off. Stored in `localStorage`, versioned.
- Shortcut sheet (`?`): generated from the registry, grouped by menu.

Acceptance
- Every enabled command can be run from the palette; disabled commands are listed but inert.
- Preference changes apply immediately without reload and persist across reloads.
- Corrupt or older stored preferences fall back to defaults without an error.
- The shortcut sheet lists exactly the registry's shortcuts (test compares).

---

## SE-065 · Tools II: curve, contour, polygon, spray

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-017                                                   |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §2.3 (Tools)                                        |

Scope
- Curve (quadratic/cubic Bézier, Aseprite's click-drag-adjust flow), contour (freehand closed
  shape, filled), polygon (click vertices, outline or filled), spray (radius, density, seeded
  RNG per stroke so undo/redo and tests are deterministic).
- Variants grouped under their neighbours in the tool rail.

Acceptance
- Golden tests: rasterized curve for fixed control points; filled polygon for a concave shape
  (even-odd rule); contour fill equals polygon fill of the same path.
- Spray with a fixed seed is reproducible; one stroke is one undo step.
- Each tool supports Escape to cancel and respects selection clipping and layer guards.
