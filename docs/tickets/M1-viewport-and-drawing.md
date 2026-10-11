# M1 — Viewport and drawing

Goal: draw on a single layer and frame with the core tools, rendered by NGNE, with undo.
Exit: gate G2 ([README](README.md#gates)).

---

## SE-010 · CPU compositor

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-003                                                   |
| Blocks       | SE-011, SE-020, SE-021, SE-050, SE-061                   |
| Blocked until | —                                                       |
| Spec         | SPEC §5.3                                                |

Scope
- `compositeFrame(doc, frameId, { rect?, into?, excludeLayerIds? }) → PixelBuffer`: visible
  pixel layers bottom to top, normal blend, layer opacity × cel opacity, straight-alpha integer
  math. Reference layers are skipped.
- Dirty-rectangle recomposite into an existing buffer.
- Per-frame composite cache keyed by frame ID, invalidated from command change notifications
  (SE-004 notifications are consumed here once SE-004 lands; until then the cache exposes
  `invalidate(frameId)`), 128 MB LRU budget.
- Blend function table with only `normal` implemented; the signature accommodates SE-061.

Acceptance
- Golden tests: opaque over opaque, 50% over opaque, 50% over 50%, layer opacity, hidden layer,
  empty cel, fully transparent result — each compared byte-exactly to hand-computed buffers.
- Dirty-rectangle result equals the same region of a full recomposite for 200 random cases.
- Cache returns the identical buffer object until invalidated and respects the byte budget.
- Benchmark: 16×16 dirty rectangle over 8 layers at 256×256 in ≤ 2 ms (recorded, Node).

---

## SE-011 · NgneViewport

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-002, SE-006, SE-010                                   |
| Blocks       | SE-012, SE-022, SE-024, SE-045, SE-062                   |
| Blocked until | Gate G0 passed                                          |
| Spec         | SPEC §6.1–§6.4                                           |

Scope
- `engine/NgneViewport`: owns one `WebGPURenderer`, one `Frame`, one `Camera`
  (`pixelSnap = false`).
- Lifecycle: create on mount; recreate on device-pixel size or DPR change after 120 ms quiet;
  dispose on unmount; recreate when `renderer.status` is `failed`.
- Slot upload queue per SPEC §6.4 (single-flight, latest-wins, superseded/abort ignored, one
  retry on other errors). Sources are `ImageBitmap`s created from `ImageData` with
  `premultiplyAlpha: "none"`, `colorSpaceConversion: "none"`.
- Slots `ed:checker` and `ed:frame`; frame builder draws only slots whose first upload resolved.
- View input: `{ scale, originX, originY }`; document rectangle computed in integer device pixels.
- On-demand rendering via a dirty flag and one `requestAnimationFrame`.
- Subscribes to the active document and frame; re-uploads `ed:frame` when the composite changes.
- Errors from NGNE diagnostics surface as a toast and in the console, once per distinct message.

Out of scope: onion slots (SE-025), reference slots (SE-045), overlay (SE-013).

Acceptance
- E2E at DPR 1 and 1.5: a 5×3 test document at scale 8 is drawn with every texel exactly 8×8
  device pixels at the expected position; colours exact for opaque texels.
- Semi-transparent texels show the checkerboard blended within ±1 per channel of the expected value.
- Resizing the window 20 times leaves exactly one live renderer and a correct image.
- With no state change for 2 s, zero frames are submitted (counter exposed for tests).
- Mutating the document buffer and notifying produces the new image within two animation frames.
- Only `src/engine` imports `@ngne/core`.

---

## SE-012 · View navigation and coordinate mapping

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-007, SE-011                                           |
| Blocks       | SE-013, SE-014                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §6.4, §7.1 (Hand, Zoom); DESIGN §5.7, §6            |

Scope
- Zoom steps of SPEC §6.4; wheel zooms about the cursor; `1`–`6` keys, fit (Ctrl+0), 100%.
- Pan: Space-drag, middle-drag, Hand tool; two-finger scroll pans, Ctrl+wheel zooms.
- `clientToDoc(x, y)` and `docToDevice(x, y)` mapping functions (pure, unit-tested) shared by
  tools and the overlay.
- Pan limits: at least 32 device pixels of the document stay visible.
- New and opened documents start fitted and centred.
- Status bar: live cursor position in document pixels, document size, zoom.

Acceptance
- Unit tests: `clientToDoc(docToClient(p)) == p` for all zoom steps and DPRs 1, 1.25, 1.5, 2.
- E2E: zooming with the wheel keeps the document pixel under the cursor fixed (±0 texels).
- E2E: the document cannot be panned fully out of view.
- Status bar shows integer coordinates, blank when the cursor is outside the document.

---

## SE-013 · Overlay canvas

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-012                                                   |
| Blocks       | SE-015, SE-030                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §6.3; DESIGN §6                                     |

Scope
- A Canvas2D element stacked over the NGNE canvas at identical device-pixel size; it is the
  pointer target for the viewport.
- Layered draw routines registered by feature: document outline, pixel grid (≥ 8×), tile grid,
  brush cursor outline. Later tickets add ants, handles, symmetry axes.
- Redraw only when view, cursor or a registered layer changes.
- Grid settings (size, offset, visibility) in document state; toggles in the View menu.

Acceptance
- E2E at DPR 1 and 1.5: grid lines fall exactly on texel boundaries of the NGNE image at scales
  8, 12 and 16 (screenshot check on a test pattern).
- The brush cursor outline matches the footprint the pencil will paint for sizes 1, 2, 3, 8 in
  both shapes.
- The system cursor is hidden over the document while a paint tool is active and restored
  outside it.
- Overlay never intercepts keyboard focus from panels.

---

## SE-014 · Tool framework and pointer pipeline

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-004, SE-007, SE-012                                   |
| Blocks       | SE-015, SE-016, SE-031                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §5.2, §7.1                                          |

Scope
- `Tool` interface: `onDown`, `onMove`, `onUp`, `onCancel`, `onKey`, `cursor`, `options` schema.
- Pointer pipeline on the overlay: pointer capture, coalesced events, conversion to document
  coordinates, left/right button mapping, modifier state, Escape and `pointercancel` → abort.
- Temporary tools while a key is held (Alt → eyedropper, Space → hand) with return to the
  previous tool.
- Paint target resolution and guards: active layer must be a visible, unlocked pixel layer;
  otherwise a status-bar message and no stroke.
- Context bar renders the active tool's option schema.
- Tool selection from the rail and shortcuts; active tool reflected in the rail.

Acceptance
- Unit tests with synthetic pointer sequences: one down–moves–up yields exactly one history
  entry; Escape mid-stroke yields none and restores pixels.
- E2E: drawing on a locked layer changes nothing and shows the message.
- Holding Space pans regardless of the active tool and restores the tool on release.
- A stroke that leaves and re-enters the canvas while the button is held continues.

---

## SE-015 · Pencil and eraser

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-013, SE-014                                           |
| Blocks       | SE-017, SE-062                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §7.1, §6.6                                          |

Scope
- `core/raster`: Bresenham line, brush stamps (square and circle, sizes 1–64, Aseprite-style
  even-size centring), pixel-perfect filter, stroke interpolation between samples.
- Inks: simple (replace), alpha compositing, lock alpha; tool opacity.
- Pencil (left = FG, right = BG) and eraser (transparent; right = BG colour).
- Shift-click draws a straight line from the last stroke end.
- Dirty-rectangle recomposite and `ed:frame` upload per animation frame while drawing.

Acceptance
- Golden tests for brush stamps at sizes 1–8 in both shapes and for pixel-perfect on a
  diagonal and an L-corner path.
- A fast diagonal drag across a 64×64 canvas leaves no gaps.
- Lock alpha never changes any pixel's alpha; alpha ink over 50% red with 50% blue matches the
  compositor's result.
- One stroke = one undo step; undo restores byte-exactly.
- Performance: pointer event to uploaded texture p95 ≤ 33 ms at 256×256 on reference hardware
  (recorded with the scripted benchmark), or the SE-002 fallback is in place.

---

## SE-016 · Colour state, picker and eyedropper

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-006, SE-014                                           |
| Blocks       | SE-017, SE-060                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §7.1; DESIGN §5.1, §5.3                             |

Scope
- FG/BG colours (RGBA) in global state; swap (X), reset (D); chips in the tool rail.
- Colour panel per DESIGN §5.3: SV field, hue strip, alpha strip, hex, HSV/RGB fields.
- Pure conversions `rgb↔hsv`, `hex↔rgba` in `core/color` (round-trip stable for 8-bit values).
- Eyedropper tool: sample composite or active layer (option); left → FG, right → BG; Alt as a
  temporary tool from paint tools.

Acceptance
- Unit tests: `hsv→rgb→hsv` keeps RGB identical for all 8-bit greys and a 4096-colour sample;
  hex parsing accepts 3, 4, 6 and 8 digits.
- Dragging in the SV field does not drift hue when saturation or value reach 0.
- E2E: eyedropper on a known pixel sets the exact RGBA; on a transparent pixel sets alpha 0.
- Picker is fully keyboard-operable (arrow keys on field and strips).

---

## SE-017 · Bucket, line, rectangle and ellipse

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-015, SE-016                                           |
| Blocks       | SE-065                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.1                                                |

Scope
- `core/raster`: scanline flood fill (contiguous and global, tolerance, sample layer or
  composite), midpoint ellipse fitting an exact bounding box (odd and even sizes), rectangle,
  filled variants.
- Line, rectangle and ellipse tools with rubber-band preview drawn into the stroke transaction
  (preview is the real pixels; released = committed), brush size applies to outlines.
- Modifiers: Shift (45° / square / circle), Ctrl (from centre).
- Bucket tool with tolerance and contiguous options.

Acceptance
- Golden tests: ellipses for bounding boxes 1×1 through 9×9 and a 16×7; flood fill on a spiral
  maze; tolerance thresholds at 0, 1 and 255.
- Flood fill of a 1024×1024 empty canvas completes in ≤ 100 ms (recorded) without recursion.
- Preview while dragging equals the committed result; Escape leaves the canvas unchanged.
- Each shape and each fill is one undo step.
