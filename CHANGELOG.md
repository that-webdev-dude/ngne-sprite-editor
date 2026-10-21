# Changelog

## 1.0.0 – 2026-10-21

Release candidate. Publication and deployment await the owner's written approval in
[REVIEW.md](docs/REVIEW.md#run-5-decisions).

### M0 — Foundation

- Local sprite documents with undo/redo and transactional edits, lossless PNG support,
  dark/light themes, resizable workspace regions, menus and keyboard commands.
- New sprite and sprite properties dialogs, configurable palette/preferences and a WebGPU
  support notice. Uses the pinned NGNE 0.2.1 engine.

### M1 — Viewport and drawing

- NGNE viewport with pan, zoom, fit, pixel/tile grids and a live cursor.
- Pencil, eraser, eyedropper, colour picker, bucket, line, rectangle and ellipse tools,
  with responsive stroke feedback and undoable drawing.

### M2 — Layers and timeline

- Layers, cels, linked cels, frame durations and a scrollable timeline with selection,
  reordering, moving and copying.
- Named animation tags, forward/reverse/ping-pong playback, repeat counts, playback speeds
  and configurable onion skinning.

### M3 — Selection and transform

- Rectangular, elliptical, lasso, polygon and wand selections, marching ants, floating pixels,
  clipboard operations, move, scale, rotate and flip.
- Canvas and sprite sizing, crop, trim, canvas flip/rotate and undoable sprite operations.

### M4 — Persistence and import

- `.ngsprite` project save/open, Save As, revert, file drop, document tabs and recent files.
- IndexedDB autosave with crash recovery.
- PNG import with cropping, sheet slicing, target sizing, resampling, alpha handling,
  deterministic palette reduction/mapping and dithering.
- Reference images behind/in front of the pixel layers, with opacity, move and uniform scale.

### M5 — NGNE export

- Deterministic atlas packing with padding, extrusion, trim and duplicate merging.
- PNG/atlas bundles with typed TypeScript draw/animation helpers, `ngne-preview`
  configuration and optional Aseprite JSON; folder delivery, zip fallback and Export Again.
- Frame PNG, sheet PNG and PNG-sequence export, plus a live NGNE game preview panel.
- Export conformance checked against the engine, including trimmed and odd-sized frames.

### M6 — Palette and parity extras

- Palette editing, presets and palette files, replace colour and sorting.
- Layer blend modes and cel opacity, symmetry, tiled mode, curve/contour/polygon/spray tools.
- GIF export, Preferences, command palette and shortcut sheet.

### M7 — Hardening and release

- Golden-path regression, viewport baselines, seeded soak and separate performance records.
- Accessibility and interface audits, keyboard/focus improvements and storage error notices.
- Installable production PWA, offline authoring, project launch queue and update/recovery flow.
- User guide, frozen v1 file formats, documentation checks and a tag/manual Pages workflow.

Milestone scope: [ticket index](docs/tickets/README.md).

### Known limitations

The open items from [REVIEW H25](docs/REVIEW.md#stop-checkpoint-e) remain open:

- Reference-hardware performance acceptance is incomplete (H11/H12). The frame switch with
  an upload took 80.8 ms p95 against 50 ms on cloud SwiftShader; this is not a reference GPU
  measurement. Intel UHD and RTX 4060 results are still required. Frame/time budgets are
  report-only in CI; the `@alone` tests still need a reference run without `CI` (H15).
- A person must install the PWA in Chrome on Windows 11 and record standalone launch and
  browser-reserved shortcut behaviour (H18, [steps](docs/audit/pwa.md#manual-install-owner-to-do)).
- The update toast with Reload stays until dismissed; the DESIGN §4 amendment remains for
  the owner to accept or refuse (H16).
- A proposed change to keep the page modal until a closing opacity popover's pixels are
  drawn is unmerged. Its interaction trade-off remains for the owner (H23).
- Reference dragging has unresolved interactions with sprite operations; at fractional
  zoom a whole-pixel move can change rounded display width by one pixel and resample the
  reference (F75).
- A seeded soak once stalled after `view.fit`; it was not reproduced in 18 further runs.
  The watchdog captures the stack if it recurs; no cause is claimed fixed (H8).
- SE-073 remains In progress pending release-commit CI evidence. Checkpoint E is pending;
  the release tag, deployment and release approval remain the owner's steps.
