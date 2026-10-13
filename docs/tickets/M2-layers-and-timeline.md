# M2 — Layers and timeline

Goal: multi-layer, multi-frame documents with tags, playback and onion skin.

---

## SE-020 · Layer commands

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-004, SE-010                                           |
| Blocks       | SE-022, SE-034                                           |
| Blocked until | —                                                       |
| Spec         | SPEC §7.3, §5.1                                          |

Scope
- Commands in `core`: add (above active), delete, duplicate (with cels; linked cels stay linked
  within the copy), rename, reorder, set visible, set locked, set opacity, set blend mode, merge
  down, flatten.
- Merge down and flatten bake opacity and blend mode through `compositeFrame` per frame; linked
  cels in the target are unlinked when their results differ.
- Guards: cannot delete the last pixel layer; merge down requires a pixel layer below.
- Orphaned images are removed by the command and restored by undo.
- Commands update `activeLayerId` in the session the way Aseprite does (new layer becomes
  active; after delete the layer below becomes active).

Acceptance
- Do/undo/redo symmetry test for every command on a 3-layer, 4-frame fixture with linked cels,
  including `activeLayerId`.
- Merge down result equals `compositeFrame` restricted to the two layers, for every frame.
- Flatten yields one pixel layer whose composite is byte-identical to the pre-flatten composite;
  reference layers stay in the stack.
- Invariants hold after each command and each undo.

---

## SE-021 · Frame, cel and tag commands

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | SE-004, SE-010                                           |
| Blocks       | SE-022, SE-023, SE-034, SE-044, SE-051                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.4, §5.1, §9.3                                    |

Scope
- Frame commands: add empty, duplicate, delete (not the last), reorder, set duration (one or
  many), reverse a range. Commands update `activeFrameId`.
- Cel commands: clear, move, copy, link, unlink, set cel opacity; operate on a rectangular cel
  selection (layers × frames).
- Tag commands (no UI): create, edit (name, colour, range, direction, repeat), delete. Deleting
  the tag named by `exportSettings.frames` resets that field to `"all"` (restored by undo).
- Tags follow their frames through reorder and delete: a tag whose range becomes empty is
  removed by the same command (and restored by undo); otherwise endpoints move to the nearest
  remaining frame inside the range. In a reorder or reversal the frames that stay in place
  hold the tag: a frame dropped between them joins it, a member dragged elsewhere leaves it
  unless it lands directly beside them, and a tag whose frames all move travels with them. A
  frame added after a frame of a tag belongs to that tag (Aseprite). One function,
  `followFrames` in `core/tags`, is the rule for every frame command.
- `core/animation`: `expandTag(doc, tag) → { frameId, ms }[]` implementing the sequences of
  SPEC §7.4; shared by playback (SE-024) and export (SE-051).

Acceptance
- Do/undo/redo symmetry test for every command, including tag commands, tag side effects and
  `activeFrameId`.
- Unit tests for `expandTag`: every direction on ranges of length 1, 2 and 5 (ping-pong of
  `a b c d e` is `a b c d e d c b`); repeat 0, 1, 3.
- A tag cannot be given a range outside the document's frames (typed error).
- Editing a linked cel changes all cels sharing the image; after unlink it changes one.
- Deleting frames never leaves a tag referencing a missing frame.
- Duration accepts 1–65535 and rejects other values with a typed error.

---

## SE-022 · Timeline panel

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-007, SE-011, SE-020, SE-021                           |
| Blocks       | SE-023, SE-024, SE-026, SE-045, SE-061                   |
| Blocked until | Gate G1 passed                                          |
| Spec         | DESIGN §5.6; SPEC §7.3, §7.4, §7.8                       |

Scope
- Layer column and frame grid per DESIGN §5.6: visibility, lock, rename in place, opacity
  (layer properties popover: name, opacity); cel states (empty, filled, linked); active cell,
  row and column highlighting.
- Selection: click, Shift-range, Ctrl-toggle for cels, frames (header) and layers (rows).
- Registry commands with the keys of SPEC §7.8: new frame, new empty frame, new layer, delete
  frame/layer, duplicate, frame navigation (canvas and timeline contexts), Tab toggle.
- Frame duration field for the selected frames.
- Switching the active frame or layer applies a floating selection first (SPEC §5.2) and
  refreshes the viewport from the frame cache.

Out of scope: drag interactions, context menus, virtualization (SE-026); tag bar (SE-023).

Acceptance
- E2E: add 3 layers and 4 frames with keys and buttons, undo all, and the model returns to the
  start state.
- Keyboard-only: create a layer, rename it, move to frame 3, add a frame — no pointer needed.
- Toggling a layer's visibility changes the viewport image within two animation frames.
- Setting duration with three frames selected changes exactly those three (one undo step).
- Layout matches DESIGN §5.6 metrics (24 px cells, 28 px rows, 200 px layer column).

---

## SE-023 · Tags UI

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-021, SE-022                                           |
| Blocks       | SE-024, SE-026, SE-070                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.4; DESIGN §2 (tag bar), §5.6, §7 (Tag)           |

Scope
- UI for the tag commands of SE-021: create from the selected frame range (registry command in
  the Frame menu), edit dialog (name, colour, range, direction, repeat), delete.
- Tag bar above the frame header: coloured spans with contrast-aware label colour, drag ends to
  resize, double-click to edit; overlapping tags stack in rows per DESIGN §2.
- Active-tag indication for the playhead frame (`activeTagAt`).

Acceptance
- E2E: select frames 2–5, create a tag, rename it, change direction to ping-pong, delete it;
  undo restores each step in reverse order.
- Resizing a tag by drag is one undo step and cannot extend past the first or last frame.
- Three overlapping tags render in three rows with no overlapping bounding boxes.
- The dialog rejects an empty name and a `from` after `to` with inline messages.
- Tag label contrast against its span colour is ≥ 4.5:1 for black, white and mid-grey spans.

---

## SE-024 · Editor playback

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-011, SE-022, SE-023                                   |
| Blocks       | SE-025                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.5, §6.4 (`ed:play`), §6.6; DESIGN §5.6           |

Scope
- Transport: first, previous, play/pause (Enter), next, last; speed 0.25×–4×.
- Playback clock driven by elapsed visible time (not callback counts), start-inclusive,
  end-exclusive intervals; pauses when the tab is hidden.
- Sequence: `expandTag` of the active tag at the playhead, otherwise all frames forward,
  looping; `repeat = n > 0` stops on the last entry after n passes.
- Display path per SPEC §6.4: blit the playing range into the `ed:play` grid image when it fits
  (local grid, no dependency on the export packer), otherwise step through the frame cache
  showing the newest ready frame.
- Starting playback applies a floating selection; any editing input stops playback first.

Acceptance
- Unit tests of the playback clock with a controlled time source: frame at time t for mixed
  durations, each direction, repeat counts, and after speed changes.
- E2E with a controlled clock: an 8-frame, 100 ms animation shows each frame for its interval
  and loops at 800 ms.
- Starting a stroke during playback stops playback on the displayed frame and paints there.
- Performance record: 64 frames at 256×256, 100 ms each, play from `ed:play` with no skipped
  frame on reference hardware.
- A range too large for `ed:play` still plays (frames may be skipped; none shown out of order).

---

## SE-025 · Onion skin

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-024                                                   |
| Blocks       | SE-070                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §7.5, §6.4, §5.1 (`DocSettings.onion`)              |

Scope
- Setters for `DocSettings.onion` (saved, not undoable); defaults for new documents from the
  preference store.
- Frame cache variants `before` and `after`: CPU-tinted composites (50% toward red / blue,
  alpha preserved) when tint is on; with tint off the `plain` slots are reused.
- Onion quads drawn by NGNE with `alpha` (base opacity × falloff per step) at layer 3 or 5.
- "Within tag" limits neighbours to the active tag's range.
- Hidden during playback.
- Toggle in the timeline transport (F3); settings popover per DESIGN §7.

Acceptance
- E2E readback: with one frame before at 50% and tint off, a known pixel shows the expected
  blend over the checkerboard within ±1 per channel.
- With tint on, a black pixel of the previous frame appears reddish (R > G and R > B in the
  readback), proving the tint is not a multiply.
- Frames outside the document range (or outside the tag with "within tag") are not drawn; no
  "texture not ready" diagnostics appear when toggling quickly or scrubbing frames.
- Editing frame N updates its ghost when viewing frame N+1.
- Onion skins are absent from `compositeFrame` output (unit test with onion enabled).

---

## SE-026 · Timeline editing interactions

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Ready                                                    |
| Depends on   | SE-022, SE-023                                           |
| Blocks       | —                                                        |
| Blocked until | —                                                       |
| Spec         | DESIGN §4 (Context menu), §5.6; SPEC §7.4                |

Scope
- Drag to reorder layers and frames; drag cels to move, Ctrl-drag to copy; drop indicators.
- Context menus for layers, frames, cels and tags generated from the command registry (link,
  unlink, clear, merge down, flatten, reverse frames, properties; new tag from selection, edit
  tag, delete tag).
- Virtualized rendering of rows and columns.

Acceptance
- E2E: reorder a layer and a frame by drag; move and Ctrl-copy a cel by drag; each is one undo
  step and the model matches the expected order.
- Every context menu item corresponds to a registry entry (test enumerates).
- With 200 frames × 30 layers, at most the visible cells plus one screen of overscan are in the
  DOM, and a scripted scroll averages ≥ 50 fps on reference hardware (recorded).
