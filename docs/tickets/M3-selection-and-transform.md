# M3 — Selection and transform

Goal: select, move, transform and copy pixels; resize and reshape the sprite.

---

## SE-030 · Selection model and marching ants

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Ready                                                    |
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
| Size         | M                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-006, SE-007, SE-021, SE-030                           |
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

Acceptance
- Do/undo symmetry for each command on a multi-layer, multi-frame fixture with linked cels
  (links preserved) and an active selection (cleared, then restored by undo).
- Canvas size 32→48 anchored centre places old content at offset (8, 8) in every cel, and a
  reference layer's `x`, `y` increase by 8.
- Sprite size 32→64 doubles a reference layer's `x`, `y` and `scale`.
- Trim on a document whose content differs per frame trims to the union of all frames.
- Invariant "every image has the document's dimensions" holds after each command and undo.
- A sprite-wide command larger than the history budget is retained and undoable (SE-004 rule).
- E2E: with the menu-bar region failed (SE-006 boundary harness), New sprite from the empty
  state still opens its dialog and creates the document.
- Typing 0.9688 into a pivot field stores 0.9688.
