# M1 — Viewport and drawing

Goal: draw on a single layer and frame with the core tools, rendered by NGNE, with undo.
Exit: gate G1 ([README](README.md#gates)).

---

## SE-010 · CPU compositor

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-003                                                   |
| Blocks       | SE-011, SE-020, SE-021, SE-040, SE-050, SE-061           |
| Blocked until | —                                                       |
| Spec         | SPEC §5.3                                                |

Scope
- `compositeFrame(doc, frameId, { rect?, into?, overrides? }) → PixelBuffer`: visible pixel
  layers bottom to top, normal blend, layer opacity × cel opacity, straight-alpha integer math.
  Reference layers are skipped. `overrides` substitutes an image for one cel (used for live
  strokes and floating selections).
- Dirty-rectangle recomposite into an existing buffer.
- Per-frame composite cache keyed by frame ID with `invalidate(touched)` taking the `touched`
  shape of SPEC §5.2 (a plain data type defined in SE-003; no dependency on the history),
  128 MB LRU budget.
- Blend function table with only `normal` implemented; other `BlendMode` values fall back to
  `normal` until SE-061.

Acceptance
- Golden tests: opaque over opaque, 50% over opaque, 50% over 50%, layer opacity, cel opacity,
  hidden layer, empty cel, fully transparent result — each compared byte-exactly to
  hand-computed buffers.
- Dirty-rectangle result equals the same region of a full recomposite for 200 random cases.
- Cache returns the identical buffer object until invalidated and respects the byte budget.
- A document containing a reference layer composites identically to the same document without it.
- Benchmark: 16×16 dirty rectangle over 8 layers at 256×256 in ≤ 2 ms (recorded, Node).

---

## SE-011 · NgneViewport

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | SE-002, SE-006, SE-007, SE-010                           |
| Blocks       | SE-012, SE-022, SE-024, SE-045, SE-054, SE-062           |
| Blocked until | Gate G0 passed                                          |
| Spec         | SPEC §6.1–§6.4, §6.7                                     |

Scope
- `engine/NgneViewport`: owns one `WebGPURenderer` on its own canvas element, one `Frame`, one
  `Camera` (`pixelSnap = false`).
- Lifecycle per SPEC §6.4 with the sizing strategy recorded by SE-002: serialized creates, a
  new canvas per renderer instance with create–upload–draw–swap–dispose replacement, status
  handling (`recovering`, `failed`; focus, visibility and 1 s timer checks).
- `engine/UploadQueue` per SPEC §6.4 (single-flight, latest-wins, bitmap closed on settle,
  ignore rules, 1×1 placeholders), reusable by SE-054. Sources are `ImageBitmap`s created from
  `ImageData` with `premultiplyAlpha: "none"`, `colorSpaceConversion: "none"`.
- Slots `ed:checker` and the frame cache `ed:f:0..7` (LRU by `frameId:variant`, `plain` only
  here); frame builder draws only slots whose first upload resolved.
- View input: `{ scale, originX, originY }`; document rectangle computed in integer device pixels.
- On-demand rendering via a dirty flag and one `requestAnimationFrame`.
- Wiring: history change (`touched`) → compositor cache invalidation → slot refresh for affected
  frames → redraw. Also reacts to active-frame and active-session changes.
- Checkerboard colours and size read from the preference store.
- Errors from NGNE diagnostics surface as a toast and in the console, once per distinct message.
- Test hooks: submitted-frame counter, `readCanvas`, live renderer count.

Out of scope: onion variants (SE-025), `ed:play` (SE-024), reference slots (SE-045), overlay
(SE-013).

Acceptance
- E2E readback at DPR 1 and 1.5: a 5×3 test document at scale 8 is drawn with every texel
  exactly 8×8 device pixels at the expected position; colours exact for opaque texels.
- Semi-transparent texels show the checkerboard blended within ±1 per channel of the expected value.
- Executing a pixel patch command (SE-004) changes the image within two animation frames; undo
  restores the previous image within two animation frames.
- Switching between two frames that are both in the slot cache triggers no `texture()` call.
- While a slot is being re-keyed to another frame, readback shows either the old frame or the
  new one in full, never the new frame's key drawn with the old texture (scripted with a delayed
  upload).
- Resizing the window 20 times leaves exactly one live renderer and a correct image.
- With no state change for 2 s, zero frames are submitted.
- A forced device loss (method of SE-002 question 8) while the window is focused and idle is
  followed by a correct image within 3 s without user input.
- After filling and then clearing the frame cache, `renderer.inspect()` reports texture bytes
  within 1 MB of the checker-only baseline.
- Only `src/engine` imports `@ngne/core`.

---

## SE-012 · View navigation and coordinate mapping

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-007, SE-008, SE-011                                   |
| Blocks       | SE-013, SE-014                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §6.4, §7.8; DESIGN §5.7, §6                         |

Scope
- Zoom steps of SPEC §6.4. Wheel and Ctrl+wheel zoom about the cursor; Shift+wheel pans
  horizontally; middle-drag pans; keys `1`–`6` and `0` per SPEC §7.8; View menu commands
  zoom in, zoom out, fit, 100%.
- `clientToDoc(x, y)` and `docToClient(x, y)` (CSS pixels ↔ document pixels) and
  `docToDevice(x, y)` (document → device pixels), pure and unit-tested, shared by tools and the
  overlay.
- Pan limits: at least 32 device pixels of the document stay visible.
- New and opened documents start fitted (largest zoom step that fits) and centred.
- Status bar: live cursor position in document pixels, document size, zoom.
- The viewport container is the focusable viewport element (`tabindex="0"`) and a focus region
  for F6; wheel and middle-drag are handled by pointer location, independent of focus.
- From the SE-011 review: the fit applies to a document whose view was never set. A view set
  through the store before the viewport reports its first size is kept (SE-011's tests open a
  session and set its view in the next step). Listeners and `tabindex` belong on the viewport
  element, not on the NGNE canvas, which is replaced at every resize.

Out of scope: Hand and Zoom tools and Space-pan (SE-014).

Acceptance
- Unit tests: `clientToDoc(docToClient(p)) == p` for integer `p`, all zoom steps ≥ 1 and DPRs
  1, 1.25, 1.5, 2.
- E2E: zooming with the wheel keeps the document pixel under the cursor fixed (same integer
  document coordinate before and after) for steps ≥ 1.
- E2E: the document cannot be panned so that fewer than 32 device pixels of it remain visible.
- Status bar shows integer coordinates, blank when the cursor is outside the document.

---

## SE-013 · Overlay canvas

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-012                                                   |
| Blocks       | SE-014, SE-030                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §6.3; DESIGN §6                                     |

Scope
- A Canvas2D element stacked over the NGNE canvas at identical device-pixel size; it is the
  pointer target for the viewport (pointer down focuses the viewport container of SE-012).
- Draw-layer registry: features register draw routines with an order. This ticket registers the
  document outline, pixel grid (≥ 8×) and tile grid. Later tickets add brush cursor, ants,
  handles and symmetry axes.
- Redraw only when view, cursor or a registered layer requests it.
- Grid toggles in the View menu, bound to `DocSettings.grid` and `pixelGrid`.
- From the SE-011 review: `NgneViewport` appends and replaces its own canvas inside the
  element it was given and expects to be alone there. The overlay canvas is a sibling of that
  element, not a child of it.
- From the SE-012 review: the overlay is the second child of SE-012's viewport element
  (`[data-viewport]`), which keeps the focus and the wheel and middle-drag listeners. Events
  from the overlay reach them by bubbling, so the overlay stops neither. Positions are mapped
  with `currentViewMapping()` (`app/view/viewNavigation`), read at each event or redraw.

Acceptance
- E2E at DPR 1 and 1.5 (screenshot of both canvases): grid lines fall exactly on texel
  boundaries of the NGNE image at scales 8, 12 and 16.
- Clicking the viewport makes the viewport container `document.activeElement`.
- With no view or cursor change for 2 s, the overlay performs no redraw (counter test hook).

---

## SE-014 · Tool framework and pointer pipeline

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | SE-004, SE-007, SE-012, SE-013                           |
| Blocks       | SE-015, SE-016, SE-030, SE-031                           |
| Blocked until | —                                                       |
| Spec         | SPEC §5.2, §7.1, §7.8                                    |

Scope
- `Tool` interface: `onDown`, `onMove`, `onUp`, `onCancel`, `onKey`, `cursor`, `options` schema.
- Pointer pipeline on the overlay: pointer capture, coalesced events, conversion to document
  coordinates, left/right button mapping, modifier state, Escape and `pointercancel` → abort.
- Live-stroke display path: while a transaction is open, the viewport composites the active
  frame with the in-progress image (`compositeFrame` `overrides`) and uploads at most once per
  animation frame.
- At stroke end the frame is not composited again in full: the live composite is handed to the
  composite cache. `CompositeCache` (SE-010) gains `adopt(frameId, buffer)` for this, which keeps
  the buffer only when the frame's layer stack matches the one it was composited from.
- From the SE-011 review: the cache is `activeComposites.cache` (`app/state/composites`), the
  object the viewport reads. During a stroke the pipeline keeps it current and calls
  `viewportLink.invalidate` (`app/viewport/viewportLink`) with the frame's key; the viewport
  copies the pixels when the upload starts, so the live buffer may be rewritten between
  uploads. Neither module is edited for this.
- Temporary tools while a key is held (Alt → eyedropper once SE-016 lands, Space → hand) with
  return to the previous tool.
- Paint target resolution and guards: active layer must be a visible, unlocked pixel layer;
  otherwise a status-bar message and no stroke.
- Context bar renders the active tool's option schema.
- Tool selection from the rail and shortcuts; active tool reflected in the rail.
- Focus rules of SPEC §7.8: pointer activation of a non-text control returns focus to the
  viewport; `text` context passes only the † chords.
- First tools: Hand, Zoom, and a development-only "dot" tool that writes one pixel per sample
  (used by this ticket's tests; removed by SE-015).
- From the SE-012 review: Hand and Space use `panBy`, the Zoom tool `zoomBy` with the clicked
  device pixel as anchor (`app/view/viewNavigation`); both keep the pan limit. A middle-button
  `pointerdown` is left to SE-012's panning. At the overview steps (1/2, 1/4, 1/8)
  `clientToDoc` names the first texel of a device pixel, which need not be the one NGNE
  shows: this ticket decides whether a paint tool works below 1× and tests what it decides.
- From the SE-013 review: the pointer target is `canvas[data-viewport-overlay]`. Pointer events
  are not stopped there: the overlay follows the cursor and SE-012 navigates from listeners on
  the viewport element. The right button paints with the background colour (DESIGN §4), so the
  pipeline cancels `contextmenu` over the viewport; nothing does yet. For about 120 ms after a
  resize (NGNE's quiet, SPEC §6.4) the overlay's `frame.cursor.pixel` names the texel shown under
  the pointer and `currentViewMapping().clientToDoc` the texel by the host box: this ticket
  decides which a stroke uses in that window.

Acceptance
- Unit tests with synthetic pointer sequences: one down–moves–up yields exactly one history
  entry; Escape mid-stroke yields none and restores pixels.
- After a committed stroke the cache returns the adopted buffer for the frame, equal to a new
  full composite, without compositing the frame again.
- E2E with the dot tool: a stroke appears in the viewport while the button is held; after
  release, undo removes it within two animation frames.
- E2E: with the active layer's `locked` flag set through the store test hook, a stroke changes
  no pixel and the status bar shows the message.
- Holding Space pans regardless of the active tool and restores the tool on release.
- Zoom tool: click steps in, Alt-click steps out, about the clicked document pixel.
- A stroke that leaves and re-enters the canvas while the button is held continues.
- E2E: click a rail tool button, then press H → the hand tool is active (no extra click on the
  canvas needed). With a number field focused, pressing H does not change the tool and Ctrl+S
  still reaches the registry.

---

## SE-015 · Pencil and eraser

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | SE-014                                                   |
| Blocks       | SE-017, SE-062                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §7.1, §6.6                                          |

Scope
- `core/raster`: Bresenham line, brush stamps (square and circle, sizes 1–64, Aseprite-style
  even-size centring), pixel-perfect filter, stroke interpolation between samples.
- Inks: simple (replace), alpha compositing, lock alpha; tool opacity.
- Pencil (left = FG, right = BG) and eraser (transparent; right = BG colour).
- Shift-click draws a straight line from the last stroke end.
- Brush cursor outline registered on the overlay (footprint of the current brush).
- From the SE-013 review: a draw layer is a module `*.overlay.ts` with an order above 300 that
  touches no DOM global at top level and imports neither `overlayLayers` nor `mountOverlay`.
  "Inverted against content" (DESIGN §6) cannot be drawn with Canvas2D composite modes on the
  overlay, which does not hold NGNE's pixels, and `mix-blend-mode` on the overlay canvas would
  change the grid colours: use an element of its own (a third child of `[data-viewport]`) or a
  two-tone outline, and record which. The overlay redraws every grid at each device-pixel move
  of the cursor: the latency benchmark runs with the pixel grid shown.
- From the SE-014 review: delete `src/app/tools/dot/` with its own tests; SE-014's other tests
  use a fixture tool of their own. The assertions of `se-014-tools.spec.ts` that no tool is
  active at start (no rail button pressed, empty context bar) are placeholders this ticket
  updates. With the pencil registered as the default tool, a click on the canvas in an earlier
  test paints: check SE-012's and SE-013's tests. Options are stored per tool id, while SPEC
  §7.1 calls brush size, shape, pixel-perfect, ink and opacity shared: decide whether pencil,
  eraser and the shape tools share them, and record it. The press composites the frame in full
  and snapshots the image, and a second sample in one animation frame can wait up to two
  frames: the benchmark measures the first sample too.
- Scripted latency benchmark page for the stroke budget of SPEC §6.6.
- Conditional: if SE-002 question 1 was a no-go, or this ticket's benchmark misses the stroke
  budget, implement the overlay stroke echo of SPEC §6.6 and record the before/after numbers.

Acceptance
- Golden tests for brush stamps at sizes 1–8 in both shapes and for pixel-perfect on a
  diagonal and an L-corner path.
- A scripted diagonal drag across a 64×64 canvas at 2000 px/s leaves no gaps.
- Lock alpha never changes any pixel's alpha; alpha ink over 50% red with 50% blue matches the
  compositor's result.
- One stroke = one undo step; undo restores byte-exactly.
- The brush cursor outline matches the painted footprint for sizes 1, 2, 3, 8 in both shapes;
  the system cursor is hidden over the document while a paint tool is active.
- Performance record: stroke budget of SPEC §6.6 met at 256×256 on reference hardware, with or
  without the echo fallback; numbers committed under `docs/perf/`. The benchmark includes one
  continuous stroke of at least 5 s and records the longest pointer-to-submitted gap beside
  the p95 (SPEC §6.6, SE-002 question 2).

---

## SE-016 · Colour state, picker and eyedropper

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-006, SE-014                                           |
| Blocks       | SE-017, SE-060                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §7.1; DESIGN §5.1, §5.3, §5.4                       |

Scope
- FG/BG colours (RGBA) in global state; swap (X), reset (button); chips in the tool rail.
- Colour panel per DESIGN §5.3: SV field, hue strip, alpha strip, hex, HSV/RGB fields.
- Pure conversions `rgb↔hsv`, `hex↔rgba` in `core/color` (round-trip stable for 8-bit values).
- Eyedropper tool: sample composite or active layer (option); left → FG, right → BG; Alt as a
  temporary tool from paint tools.
- Palette section as a read-only swatch grid of the document palette (left-click FG,
  right-click BG).
- From the SE-014 review: the temporary eyedropper is the eyedropper's `hold` (`key: "Alt"`,
  while the selected tool paints). SE-014 lets a hold act only while the viewport element has
  the focus, which was made for Space, a key controls consume; Alt is not one and acts in the
  whole `canvas` context of SPEC §7.8. An enabled hold command in the command palette would run
  without its release, and SE-064's palette test spies only `run`: decide whether hold commands
  leave the palette (they stay on the shortcut sheet) or the test also records `release`
  (asserting more), and record it. The paint guard refuses paint tools below 1×; at the overview
  steps `clientToDoc` names the first texel of a device pixel, not always the one shown: decide
  what the eyedropper samples there. The colour chips go in the rail (`ToolRail.tsx`).
- From the SE-015 review: pencil and eraser are `paints: true`, so the Alt hold can test
  `selected?.paints`. A stroke takes its colour at the press (`context.colour`). SE-015's tests
  set the foreground and background themselves (`setColours`), so the defaults are this
  ticket's. SE-014's rail test counts pressed `[data-tool]` buttons only, so colour chips with
  `aria-pressed` do not change it.

Acceptance
- Unit tests: `hsv→rgb→hsv` keeps RGB identical for all 8-bit greys and a 4096-colour sample;
  hex parsing accepts 3, 4, 6 and 8 digits.
- Dragging in the SV field does not change the stored hue when saturation or value reach 0.
- E2E: eyedropper on a known pixel sets the exact RGBA; on a transparent pixel sets alpha 0.
- Picker is fully keyboard-operable (arrow keys on field and strips).
- Clicking a palette swatch sets FG to exactly that colour.

---

## SE-017 · Bucket, line, rectangle and ellipse (gate G1)

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | In progress                                              |
| Depends on   | SE-015, SE-016                                           |
| Blocks       | SE-031, SE-062, SE-065                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.1                                                |

Scope
- `core/raster`: scanline flood fill returning a mask (contiguous and global, tolerance, sample
  layer or composite), midpoint ellipse fitting an exact bounding box (odd and even sizes),
  rectangle, filled variants.
- Line, rectangle and ellipse tools with rubber-band preview drawn into the stroke transaction
  (each move restores the snapshot and redraws; released = committed); brush size applies to
  outlines.
- Modifiers: Shift (45° / square / circle), Ctrl (from centre).
- Bucket tool with tolerance and contiguous options.
- From the SE-014 review: a stroke exposes no snapshot of the image at its start; the rubber
  band keeps its own copy from `onDown` and marks the previous preview rectangle dirty so the
  live composite clears it. The bucket is a paint tool, refused below 1×.
- From the SE-015 review: shape tools list `BRUSH_SIZE`, `BRUSH_SHAPE`, `INK` and `OPACITY`
  from `app/tools/brush/brushOptions.ts` and take their brush from `brushOf(values)`; listing
  size and shape gives them the brush cursor. `StraightStroke` (`core/raster/stroke.ts`) is
  already a rubber-band brush line that takes its previous bounds back from the stroke-start
  copy. Inks compute from that copy; report only changed rectangles. A shape released where it
  changes nothing records nothing (SPEC §7.1). The midpoint ellipse is this ticket's own; SE-015's
  circle-brush goldens stay as they are.

Acceptance
- Golden tests: ellipses for bounding boxes 1×1 through 9×9 and a 16×7; flood fill on a spiral
  maze; tolerance thresholds at 0, 1 and 255.
- Flood fill of a 1024×1024 empty canvas completes in ≤ 100 ms (recorded) without recursion.
- Preview while dragging equals the committed result; Escape leaves the canvas unchanged.
- Each shape and each fill is one undo step.
- Gate G1 is marked passed in `docs/tickets/README.md` once this ticket and SE-015 are Done.
