# M2 — Layers and timeline

Goal: multi-layer, multi-frame documents with tags, playback and onion skin.

---

## SE-020 · Layer commands

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-004, SE-010                                           |
| Blocks       | SE-022                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.3, §5.1                                          |

Scope
- Commands in `core`: add (above active), delete, duplicate (with cels; linked cels stay linked
  within the copy), rename, reorder, set visible, set locked, set opacity, merge down, flatten.
- Merge down and flatten bake opacity (and blend mode once SE-061 lands) per frame; linked cels
  in the target are unlinked when their results differ.
- Guards: cannot delete the last pixel layer; merge down requires a pixel layer below.
- Orphaned images are removed by the command and restored by undo.

Acceptance
- Do/undo/redo symmetry test for every command on a 3-layer, 4-frame fixture with linked cels.
- Merge down result equals `compositeFrame` restricted to the two layers, for every frame.
- Flatten yields one layer whose composite is byte-identical to the pre-flatten composite.
- Invariants hold after each command and each undo.

---

## SE-021 · Frame, cel and tag commands

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-004, SE-010                                           |
| Blocks       | SE-022, SE-023, SE-034, SE-044, SE-051                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.4, §5.1, §9.3                                    |

Scope
- Frame commands: add empty, duplicate, delete (not the last), reorder, set duration (one or
  many), reverse a range.
- Tag commands in `core` (no UI): create, edit (name, colour, range, direction, repeat), delete.
- `core/animation`: `expandTag(doc, tag) → { frameId, ms }[]` implementing forward, reverse and
  ping-pong (end frames not repeated) and repeat counts; shared by playback (SE-024) and
  export (SE-051).
- Cel commands: clear, move, copy, link, unlink; operate on a rectangular cel selection
  (layers × frames).
- Tags follow their frames through reorder and delete: a tag whose range becomes empty is
  removed by the same command (and restored by undo); otherwise endpoints move to the nearest
  remaining frame inside the range.
- Lazy image allocation: painting on an empty cel creates its image inside the stroke
  transaction.

Acceptance
- Do/undo/redo symmetry test for every command, including tag commands and tag side effects.
- Unit tests for `expandTag`: every direction on ranges of length 1, 2 and 5; repeat 0, 1, 3.
- A tag cannot be given a range outside the document's frames.
- Editing a linked cel changes all cels sharing the image; after unlink it changes one.
- Deleting frames never leaves a tag referencing a missing frame.
- Duration accepts 1–65535 and rejects other values with a typed error.

---

## SE-022 · Timeline panel

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-007, SE-011, SE-020, SE-021                           |
| Blocks       | SE-023, SE-024, SE-045, SE-061                           |
| Blocked until | Gate G2 passed                                          |
| Spec         | DESIGN §5.6; SPEC §7.3, §7.4                             |

Scope
- Layer column and frame grid per DESIGN §5.6: visibility, lock, rename in place, opacity
  popover; cel states (empty, filled, linked); active cell, row and column highlighting.
- Selection: click, Shift-range, Ctrl-toggle for cels, frames (header) and layers (rows).
- Drag to reorder layers and frames; drag cels to move, Ctrl-drag to copy.
- Context menus for layers, frames and cels generated from the command registry.
- Frame navigation: ←/→, Home/End; new frame Alt+N; new layer Shift+N; Tab toggles the panel.
- Frame duration field for the selected frames.
- Virtualized rendering so 200 frames × 30 layers scroll smoothly.
- Switching the active frame updates `ed:frame` from the composite cache.

Acceptance
- E2E: add 3 layers and 4 frames, reorder each by drag, undo all, and the model returns to the
  start state.
- Keyboard-only: create a layer, rename it, move to frame 3, add a frame — no pointer needed.
- With 200×30 cels, scrolling stays above 50 fps on reference hardware (recorded).
- Hidden layers disappear from the viewport within one animation frame of the toggle.
- Layout matches DESIGN §5.6 metrics (24 px cells, 200 px layer column).

---

## SE-023 · Tags UI

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | S                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-021, SE-022                                           |
| Blocks       | SE-024                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.4; DESIGN §5.6, §7 (Tag)                         |

Scope
- UI for the tag commands of SE-021: create from the selected frame range (registry command and
  timeline context menu), edit dialog (name, colour, range, direction, repeat), delete.
- Tag bar above the frame header: coloured spans, drag ends to resize, double-click to edit.
- Overlapping tags stack in rows.
- Active-tag indication for the playhead frame (used by SE-024).

Acceptance
- E2E: select frames 2–5, create a tag, rename it, change direction to ping-pong, delete it;
  undo restores each step in reverse order.
- Resizing a tag by drag is one undo step and cannot extend past the first or last frame.
- Three overlapping tags render in three rows without overlap.
- The dialog rejects an empty name and a `from` after `to` with inline messages.

---

## SE-024 · Editor playback

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-011, SE-022, SE-023                                   |
| Blocks       | SE-025                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.5; DESIGN §5.6                                   |

Scope
- Transport: first, previous, play/pause (Enter), next, last; speed 0.25×–4×.
- Playback clock driven by elapsed visible time (not callback counts), start-inclusive,
  end-exclusive intervals; pauses when the tab is hidden.
- Plays the tag under the playhead using `expandTag`, otherwise all frames forward, looping.
- While playing, the viewport shows cached composites; editing input stops playback first.
- Composites for the playing range are prepared before playback starts.

Acceptance
- Unit tests of the playback clock with a controlled time source: frame at time t for mixed
  durations, each direction, and after speed changes.
- E2E: an 8-frame, 100 ms animation completes a loop in 800 ms ± one display frame.
- Starting a stroke during playback stops playback on the displayed frame and paints there.
- Playback of 64 frames at 256×256 drops no frames on reference hardware (recorded).

---

## SE-025 · Onion skin

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-024                                                   |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | SPEC §7.5, §6.4                                          |

Scope
- Settings (per document): enabled (F3), frames before/after 0–3, base opacity, falloff, tint
  on/off (red before, blue after), placement behind/in front, "within tag only".
- Slots `ed:onion:0..5` uploaded from the composite cache on frame switch and when a neighbour
  frame is edited; drawn with NGNE `alpha` and `color`.
- Hidden during playback.
- Toggle in the timeline transport; settings popover.

Acceptance
- E2E screenshot: with one frame before at 50% and tint off, a known pixel shows the expected
  blend over the checkerboard within ±1 per channel.
- Frames outside the document range are not drawn; no "texture not ready" diagnostics appear
  when toggling quickly or scrubbing frames.
- Editing frame N updates its ghost when viewing frame N+1.
- Onion skins never appear in any export or in the preview panel.
