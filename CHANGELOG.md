# Changelog

## Unreleased

- `THIRD_PARTY_NOTICES.md` gives the upstream version of every ported part and adds Allegro's
  giftware licence, which covers the spline Aseprite's `algo_spline` adapts.
- The build fails when gifenc's colour quantizer is bundled again.
- The exported `<name>.sprites.ts` and `<name>.preview.config.mjs` carry the 0BSD licence in their
  head.

## 1.0.2 – 2026-11-13

- Open Recent keeps up to 5 project files (was 10). A longer list kept by an earlier version
  is cut to the 5 newest when it loads.
- The user guide places the shortcut sheet in the Edit menu (it said View).
- The build ships `licences.txt`: this project's licence, the third-party notices and the
  licence of every bundled npm package. View → Open Source Licences… shows it in a dialog, offline too.
- `THIRD_PARTY_NOTICES.md` adds the MIT notice of Alois Zingl's Bresenham algorithms (lines,
  ellipses, the circle brush, the elliptical marquee) and corrects how Aseprite's licences are
  described.
- The bundle no longer includes gifenc's colour quantizer, which the GIF export never used.

## 1.0.1 – 2026-11-06

### Engine: `@ngne/core` 0.3.0

- Pinned `@ngne/core` to 0.3.0 (was 0.2.1).
- Unused viewport slots and the preview atlas are released with `releaseTexture` instead of
  being replaced by 1×1 placeholder images.
- A viewport size change resizes the renderer in place and draws it in the same task, so no
  cleared canvas is shown. It no longer replaces the renderer after 120 ms of quiet. A renderer
  is replaced only when it failed or got stuck.
- Device loss and recovery come from NGNE's lifecycle events (`onLifecycle`, `ready`) in the
  viewport and the preview. The status timers, focus and visibility reads and sprite-counter
  checks are gone.
- A viewport's renderer creation is cancelled when the viewport is disposed. Creates are no
  longer serialized across the page.
- Frame slots keep whole-image `texture()` uploads. NGNE 0.3.0's editable textures
  (`updateTexture`) lose precision on translucent pixels under software 2D readback, which
  breaks the ±1 pixel contract (new test `se-011-translucency`).

## 1.0.0 – 2026-10-21

Release candidate. Checkpoint E passed with the qualifications below. Merging, tagging and
deployment remain the owner's actions.

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

### Known limitations

Known limitations at release:

- All seven SPEC §6.6 benchmarks meet their budgets on Intel UHD and RTX 4060
  ([reference measurements](docs/perf/checkpoint-e-2026-10-21.md)). Separately, the
  non-CI `@alone` E2E run passed 10/10 on Intel and 9/10 on RTX: cel opacity took three
  frames against two. This v1.0.0 performance exception is accepted and tracked in
  [issue #2](https://github.com/that-webdev-dude/ngne-sprite-editor/issues/2); its assertion
  is unchanged. Frame/time budgets remain report-only under CI.
- The native Chrome PWA install/standalone/shortcut check was explicitly **waived by the
  owner**, not passed. The owner will do it personally
  ([steps](docs/audit/pwa.md#manual-install-owner-to-do)).
- The update toast with Reload stays until dismissed; the DESIGN §4 amendment is accepted.
  Immediate interaction after a popover closes is retained.
- Changing the canvas dimensions during a reference drag now cancels it, preserving the
  sprite operation's geometry. At fractional zoom, a whole-pixel move can still change the
  rounded display width by one pixel and resample the reference; this display trade-off is
  accepted and does not change its source PNG or exports.
- A seeded soak once stalled after `view.fit`; it was not reproduced in 18 further runs
  or three additional checkpoint soaks. The watchdog and its control tests are retained;
  no cause is claimed fixed.
- SE-073 is Done. Checkpoint E passed with the exception and waiver above. The owner retains
  merging, tagging and deployment.
