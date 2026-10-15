# M3 — Selection and transform

Goal: select, move, transform and copy pixels; resize and reshape the sprite.

---

## SE-030 · Selection model and marching ants

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-004, SE-013, SE-014                                   |
| Blocks       | SE-031, SE-034, SE-066                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §5.2, §7.2; DESIGN §6                               |

Scope
- `core/selection`: 1-bit mask with bounds; set, add, subtract, intersect, invert, all, none;
  mask from rectangle, ellipse, polygon and from a flood mask.
- Selection changes are commands on `DocSession.selection` (undoable; not persisted; unchanged
  by frame and layer switches).
- Boundary extraction to axis-aligned edge segments for drawing.
- Overlay layer: marching ants per DESIGN §6; static dashes under `prefers-reduced-motion`.
- From the SE-013 review: a grid line is the first device pixel inside a texel and the document
  outline lies 1 px outside the bounds. This ticket decides where the ants lie (the mockup puts
  them 1 px outside on every side, as the outline) and records it. Alignment is tested as
  `se-013-grid-cases` does: positions taken from NGNE's image, the whole canvas compared. The
  animation runs from the layer's `watch` on a timer that exists only while there is a
  selection and motion is allowed, so SE-013's idle test (no redraw for 2 s) still holds.
- From the SE-014 review: the selection is passed as `clip` where the pipeline begins the
  transaction (`src/app/tools/pipeline.ts`, a comment marks the place).
- From the SE-015 review: the transaction's clip puts pixels outside the selection back at
  `markDirty`; SE-015's inks compute from the stroke-start copy, so the two agree. The dot tool
  is gone: the clipping test uses the pencil. Overlay order 900 is the brush cursor's.
- Paint clipping: the tool framework passes the selection as the transaction clip mask (SE-004).
- Commands: Select All, Deselect, Invert with the keys of SPEC §7.8.
- Status bar shows the selection size.

Acceptance
- Unit tests: boolean operations against hand-built masks; bounds correct after each; boundary
  segments of an L-shape and a mask with a hole.
- With a selection active, a dot-tool or pencil stroke crossing its edge changes pixels only
  inside.
- Ants align to texel edges at DPR 1 and 1.5 (screenshot, reduced motion).
- Undo of a selection change restores the previous mask exactly.
- Switching the active frame or layer keeps the mask unchanged.

---

## SE-031 · Selection tools

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-014, SE-017, SE-030                                   |
| Blocks       | SE-032                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.1, §7.2, §7.8; DESIGN §5.1, §5.2                 |

Scope
- Rectangular and elliptical marquee, lasso, polygon lasso, magic wand (tolerance, contiguous,
  sample layer or composite; uses the flood mask of SE-017).
- Modes via modifiers and context-bar toggles: replace, add (Shift), subtract (Alt), intersect
  (Shift+Alt).
- Live preview of the pending shape on the overlay.
- Variant switching in the tool rail (hold, or repeat the key).
- `gesture` keymap context for the polygon lasso.
- From the SE-014 review: the pointer pipeline delivers moves only while a button is held, and
  nothing drops a gesture when the tool changes; the polygon lasso needs both. Rail variants
  (corner mark, hold or repeat the key) are not in SE-014's registry or rail. This ticket
  extends `src/app/tools/types.ts`, `planned.tools.ts`, `pipeline.ts` and
  `src/ui/shell/regions/ToolRail.tsx` for them.
- From the SE-030 review: the masks come from `core/selection` (`rectMask`, `ellipseMask`,
  `polygonMask`, `selectionOf` for the wand's flood mask). The polygon rule (Bresenham sides,
  even-odd interior at pixel centres, fewer than 3 points select nothing) is this editor's own;
  it was not checked against Aseprite's lasso. `polygonMask` refuses vertices that are not
  whole numbers or lie beyond 2^24 and walks each side on the canvas only. The ants redraw in a
  constant number of draw calls, but their ring is rebuilt at each view change in time
  proportional to the visible boundary, and `selectionBoundary` takes about 55 ms for a 1024²
  noise mask: a non-contiguous wand pick of a dithered area is this ticket's worst case.
  Measure it with a benchmark `tests/perf/se-031-*.perf.ts` (a pan over such a selection on a
  256² and a 1024² document); the number is recorded by the orchestrator.
- From the SE-017 review: the wand takes `floodMask` (`core/raster/flood.ts`): Aseprite's match
  rule (`color_equal_32`), 4-connected, and its `within` mask limits the global (non-contiguous)
  branch as well as the contiguous one, while Aseprite's global fill takes no mask. Decide
  whether the wand passes a mask and record it.

Acceptance
- E2E per tool: the resulting mask equals the expected mask for a scripted gesture.
- Each completed gesture is one undo step; Escape during a gesture changes nothing.
- Polygon lasso closes on Enter and on double-click; a polygon with fewer than 3 points
  selects nothing; while it is open, Enter does not start playback.
- Magic wand on a 1024×1024 flat canvas completes in ≤ 100 ms (recorded).

---

## SE-032 · Move, floating selection and clipboard

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-005, SE-031                                           |
| Blocks       | SE-033, SE-046                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §5.2, §7.2, §7.8                                    |

Scope
- Floating selection per SPEC §5.2: lifting selected pixels from the active cel into a floating
  buffer inside an open transaction, shown through the live-stroke display path (SE-014).
- Auto-apply triggers of SPEC §5.2 that exist at this point (frame/layer switch, tool change,
  playback start, sprite-wide command); save and export call the same `applyFloating()` hook in
  their own tickets.
- Move tool: drag selection content; with no selection, move the whole active cel. Arrow-key
  nudge per SPEC §7.8 (`floating` context, and lift-and-nudge from `canvas` with a selection).
- Apply (Enter, click outside) and cancel (Escape); one undo step from lift to apply; undo
  while floating cancels the float.
- Cut, copy, paste, delete, fill with FG. Internal clipboard always; system clipboard
  `image/png` read/write when permitted, encoded with SE-005.
- Paste creates a floating selection at the viewport centre, aligned to whole pixels; an image
  larger than the canvas is allowed and clipped on apply.

Acceptance
- Lift then cancel leaves the cel byte-identical.
- Lift, move by (3, −2), apply: pixels moved exactly; source area transparent; one undo step.
- Moving content partly off-canvas and applying clips it.
- Switching frame while floating applies the float to the original frame first.
- Copy in the app, paste in the app: byte-identical region. Copy to the system clipboard and
  paste back: identical for opaque pixels.
- With clipboard permission denied, internal copy/paste still works and the status bar explains
  the limitation.
- With no selection, ← and → change frame; with a selection they nudge (keymap context test).

---

## SE-033 · Selection transforms

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-032                                                   |
| Blocks       | SE-070                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.2; DESIGN §5.2                                   |

Scope
- Flip horizontal/vertical, rotate 90° CW/CCW, rotate 180° on the selection (or the whole cel).
- Free transform on a floating selection: scale via 8 handles (Shift keeps aspect), rotate by
  dragging outside the box (Shift snaps 15°), nearest-neighbour sampling.
- Context bar shows X, Y, W, H and angle fields with Apply / Cancel.
- Handles and bounding box drawn on the overlay.

Acceptance
- Golden tests: flips and 90° rotations are exact permutations; four 90° rotations return the
  original; scale 2× then 0.5× of a checker pattern returns the original.
- Typing values in the context bar gives the same result as the equivalent drag.
- Apply is one undo step; cancel restores the pre-lift pixels.
- Rotation by a non-right angle produces only colours present in the source (nearest).

---

## SE-034 · Sprite operations

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-006, SE-007, SE-020, SE-021, SE-030, SE-040           |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §7.7, §7.6 (sprite operations); DESIGN §7 (Canvas / Sprite size) |

Scope
- Commands over every image in the document: canvas size (with 3×3 anchor), sprite size
  (nearest or area average; lock aspect), crop to selection, trim to content (all frames),
  rotate canvas 90/180, flip canvas.
- Each command clears the selection (restored by undo) and applies a floating selection first.
- Reference layers: canvas size, crop, trim and sprite size adjust `x`, `y` and `scale` so the
  reference stays over the same content; flip and rotate leave reference layers untouched.
- Pivot stays normalized. Linked cels stay linked.
- Dialogs for canvas size and sprite size.
- Dialog host (from the SE-008 review): the host that renders command dialogs moves out of the
  menu-bar region to the app root, inside its own error boundary, and dialogs register from
  their own module; a request made while no host is mounted is answered at once instead of
  staying pending.
- Sprite properties, pivot fields (from the SE-008 review): numeric entry keeps four decimals
  (arrow keys still step by 0.01), so a pivot on a pixel boundary of a 1024 px sprite can be
  entered.
- Size guard: result must be within 1..1024 per side; memory guard per SPEC §5.1.
- Document limits (from the W3 review; SPEC §5.1, FORMAT.md §1): `core/model` exports the
  limits — pixel memory 1 GB and the layer, frame, tag and cel counts of the project format —
  with one typed error. Every command that adds a layer, frame, tag, cel or image refuses to
  pass a limit and leaves the document unchanged: SE-004 cel creation, SE-020 add and duplicate
  layer, SE-021 add and duplicate frames, copy and unlink cels and create tag, and this
  ticket's size changes. `core/project` (SE-040) takes its count limits from the same
  constants. The app shows a warning when a document's pixel memory passes 512 MB.
- Text length (same source): sprite, layer, tag and palette names are limited to the 255
  UTF-16 code units of the project format by the commands that set them (SE-008 rename, SE-020
  rename and duplicate, SE-021 create and edit tag), so nothing the editor creates is refused
  on save.
- `assertInvariants` checks tag ranges with a frame-index map instead of a search per tag (it
  is quadratic in tags × frames today), and the `assertTagRanges` workaround of `core/project`
  is removed.

Acceptance
- Do/undo symmetry for each command on a multi-layer, multi-frame fixture with linked cels
  (links preserved) and an active selection (cleared, then restored by undo).
- Canvas size 32→48 anchored centre places old content at offset (8, 8) in every cel, and a
  reference layer's `x`, `y` increase by 8.
- Sprite size 32→64 doubles a reference layer's `x`, `y` and `scale`.
- Trim on a document whose content differs per frame trims to the union of all frames.
- Invariant "every image has the document's dimensions" holds after each command and undo.
- A sprite-wide command larger than the history budget is retained and undoable (SE-004 rule).
- With each limit lowered by a test option, every adding command named in the scope throws the
  typed limit error and leaves the session deep-equal; a document exactly at a count limit
  saves and reopens (SE-040).
- A document whose pixel memory passes 512 MB shows the warning once.
- E2E: with the menu-bar region failed (SE-006 boundary harness), New sprite from the empty
  state still opens its dialog and creates the document.
- Typing 0.9688 into a pivot field stores 0.9688.
