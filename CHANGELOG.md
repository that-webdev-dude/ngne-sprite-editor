# Changelog

## 1.0.0 – 2026-10-21

Release candidate. Checkpoint E passed under delegated owner authority, with the qualifications
below. Merging, tagging and deployment remain the owner's actions; see
[REVIEW.md](docs/REVIEW.md#checkpoint-e-delegated-owner-resolution-2026-10-21).

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

Disposition of [REVIEW H25](docs/REVIEW.md#stop-checkpoint-e), recorded at
[checkpoint E](docs/audit/checkpoint-e-2026-10-21.md):

- All seven SPEC §6.6 benchmarks meet their budgets on Intel UHD and RTX 4060
  ([reference measurements](docs/perf/checkpoint-e-2026-10-21.md), H11/H12). Separately, the
  non-CI `@alone` E2E run passed 10/10 on Intel and 9/10 on RTX: cel opacity took three
  frames against two. This v1.0.0 performance exception is accepted and tracked in
  [issue #2](https://github.com/that-webdev-dude/ngne-sprite-editor/issues/2); its assertion
  is unchanged. Frame/time budgets remain report-only under CI (H15).
- The native Chrome PWA install/standalone/shortcut check was explicitly **waived by the
  owner**, not passed. The owner will do it personally
  ([steps](docs/audit/pwa.md#manual-install-owner-to-do), H18).
- The update toast with Reload stays until dismissed; the DESIGN §4 amendment is accepted
  (H16). Immediate interaction after a popover closes is retained (H23).
- Changing the canvas dimensions during a reference drag now cancels it, preserving the
  sprite operation's geometry. At fractional zoom, a whole-pixel move can still change the
  rounded display width by one pixel and resample the reference; this display trade-off is
  accepted and does not change its source PNG or exports (F75).
- A seeded soak once stalled after `view.fit`; it was not reproduced in 18 further runs
  or three additional checkpoint soaks. The watchdog and its control tests are retained;
  no cause is claimed fixed (H8).
- SE-073 is Done. Checkpoint E passed with the exception and waiver above. The owner retains
  merging, tagging and deployment.
