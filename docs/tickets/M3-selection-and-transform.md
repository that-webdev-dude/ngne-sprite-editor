# M3 — Selection and transform

Goal: select, move, transform and copy pixels; resize and reshape the sprite.

---

## SE-030 · Selection model and marching ants

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-004, SE-013                                           |
| Blocks       | SE-031, SE-034                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §7.2; DESIGN §6                                     |

Scope
- `core/selection`: 1-bit mask with bounds; set, add, subtract, intersect, invert, all, none;
  mask from rectangle, ellipse, polygon and from a flood region.
- Selection changes are commands (undoable), stored per document.
- Boundary extraction to axis-aligned edge segments for drawing.
- Overlay layer: marching ants per DESIGN §6; static dashes under `prefers-reduced-motion`.
- Paint clipping: stroke transactions (SE-004/SE-014) clip writes to the mask when one exists.
- Commands: Select All (Ctrl+A), Deselect (Ctrl+D), Invert (Ctrl+Shift+I).

Acceptance
- Unit tests: boolean operations against hand-built masks; bounds correct after each; boundary
  segments of an L-shape and a mask with a hole.
- With a selection active, a pencil stroke crossing its edge changes pixels only inside.
- Ants align to texel edges at DPR 1 and 1.5 (screenshot).
- Undo of a selection change restores the previous mask exactly.

---

## SE-031 · Selection tools

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-014, SE-030                                           |
| Blocks       | SE-032                                                   |
| Blocked until | Gate G2 passed                                          |
| Spec         | SPEC §7.1, §7.2; DESIGN §5.1, §5.2                       |

Scope
- Rectangular and elliptical marquee, lasso, polygon lasso, magic wand (tolerance, contiguous,
  sample layer or composite).
- Modes via modifiers and context-bar toggles: replace, add (Shift), subtract (Alt), intersect
  (Shift+Alt).
- Live preview of the pending shape on the overlay.
- Variant switching in the tool rail (hold, or repeat the key).

Acceptance
- E2E per tool: the resulting mask equals the expected mask for a scripted gesture.
- Each completed gesture is one undo step; Escape during a gesture changes nothing.
- Polygon lasso closes on Enter and on double-click; a polygon with fewer than 3 points
  selects nothing.
- Magic wand on a 1024×1024 flat canvas completes in ≤ 100 ms (recorded).

---

## SE-032 · Move, floating selection and clipboard

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-005, SE-031                                           |
| Blocks       | SE-033                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.2                                                |

Scope
- Floating selection: lifting selected pixels from the active cel into a floating buffer
  composited above it (included in `ed:frame` through the stroke transaction path).
- Move tool: drag selection content; with no selection, move the whole active cel. Arrow keys
  nudge 1 px, Shift+arrow 8 px.
- Apply (Enter, click outside, tool change) and cancel (Escape); one undo step from lift to apply.
- Cut, copy, paste, delete, fill with FG. Internal clipboard always; system clipboard
  `image/png` read/write when permitted, encoded with SE-005.
- Paste creates a floating selection at the viewport centre, clamped to pixel alignment;
  pasting an image larger than the canvas is allowed and clipped on apply.

Acceptance
- Lift then cancel leaves the cel byte-identical.
- Lift, move by (3, −2), apply: pixels moved exactly; source area transparent; one undo step.
- Copy in the app, paste in the app: byte-identical region. Copy to the system clipboard and
  paste back: identical for opaque pixels.
- With clipboard permission denied, internal copy/paste still works and a status message
  explains the limitation.
- Moving content partly off-canvas and applying clips it (Aseprite behaviour).

---

## SE-033 · Selection transforms

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
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
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-006, SE-007, SE-021, SE-030                           |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §7.7; DESIGN §7 (Canvas / Sprite size)              |

Scope
- Commands over every image in the document: canvas size (with 3×3 anchor), sprite size
  (nearest or area average; lock aspect), crop to selection, trim to content (all frames),
  rotate canvas 90/180, flip canvas.
- Reference layers are repositioned so they stay aligned to the same content after canvas
  resize, crop, flip and rotation.
- Selection is cleared or transformed consistently; pivot stays normalized.
- Dialogs for canvas size and sprite size.
- Size guard: result must be within 1..1024 per side.

Acceptance
- Do/undo symmetry for each command on a multi-layer, multi-frame fixture with linked cels
  (links preserved).
- Canvas size 32→48 anchored centre places old content at offset (8, 8) in every cel.
- Trim on a document whose content differs per frame trims to the union of all frames.
- Invariant "every image has the document's dimensions" holds after each command and undo.
- Undo memory for sprite-wide operations is accounted in the history budget.
