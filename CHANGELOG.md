# Changelog

## Unreleased

### Interface: `@ngne/editor-ui` 0.1.0

- The editor's shell and shared interface now come from `@ngne/editor-ui` 0.1.0, the NGNE editor
  suite's package, pinned exactly: the menu bar and its menus, the document tab strip, the tool
  rail, the context bar, the dock, the status bar, toasts, the command palette and shortcut
  sheet, the update notice and the About and Open Source Licences dialogs. Themes, layout,
  recent commands and the offline cache carry over from earlier versions.
- The tool rail runs the full height of the window, down to the status bar, and the timeline
  sits beside it, under the viewport and the dock, as in the suite's layout. With that height
  the rail keeps its tools and colour chips in one column at the smallest window, 1280×720.
- Help → Keyboard Shortcuts… (still on `?`) and Help → About NGNE Sprite Editor… are the
  package's: Keyboard Shortcuts… first, About last in a group of its own.
- View → Open Source Licences… is the package's command and dialog, the last item of the View
  menu.
- The close control of a document tab has no tooltip; a focused tab still closes with Delete.
- The context bar, menus and toasts are drawn by the package, in the suite's look.

## 1.1.1 – 2026-11-21

- The exported `<name>.sprites.ts` and `<name>.preview.config.mjs` name their copyright holder
  in the 0BSD licence at their head ("Copyright (C) Fabio Barracano").
- `THIRD_PARTY_NOTICES.md` gives pixman's `COPYING` in full, its opening lines included, names
  Allegro's `_soft_spline` as the source of the curve's sample count, lists the compositor's
  cel opacity under Aseprite's render library, and links to the provenance record instead of
  naming a file the app does not ship.
- The build checks the service worker too: it fails when the worker bundles code of a package
  that `licences.txt` does not list. A licence expression with nested parentheses is read
  correctly, and one that is not well formed is refused.

### Engine: `@ngne/core` 0.4.0

- Pinned `@ngne/core` to 0.4.0 (was 0.3.0). The editor draws the same pixels as before.
- The viewport's transparency checkerboard is one small repeating texture, using 0.4.0's
  repeat sampling, instead of an image the size of the document: resizing the document or
  changing the checker setting no longer uploads a new checkerboard
  ([issue #13](https://github.com/that-webdev-dude/ngne-sprite-editor/issues/13)).
- The exported `<name>.sprites.ts` works in games on `@ngne/core` 0.3.0 or 0.4.0. Sprites drawn
  unrotated, at quarter turns or at whole-number scales land on the same pixels on both; with
  pixel snapping on, other rotations and fractional scales can land up to one pixel apart.

## 1.1.0 – 2026-11-17

- Closing the layer or cel properties popover does less work in the step that applies it,
  so the viewport shows the change about a millisecond sooner
  ([issue #2](https://github.com/that-webdev-dude/ngne-sprite-editor/issues/2)). Keys and
  presses still act on the page at once after the close.
- An edit, an undo or a redo reaches the canvas sooner: the status bar, the palette header and
  the Commands button are no longer drawn again after every change of the document, only when
  what they show changes, and the preview panel no longer after every repack.
- A document opened while the app starts, from a file launch for example, starts centred in
  the viewport. It could start a few pixels to the right of centre when it opened before the
  tool rail had switched to two columns.
- The app icon shows a pixel-art sprite, a creature with two eyes and two legs, instead of an
  "N". It keeps the same colours and frame, and matches the NGNE Tilemap Editor's tile-grid
  icon.
- A document tab shows its project file's name, without `.ngsprite`, once the document has a
  file, so Save As renames the tab. A document never saved keeps its sprite name. The tab's
  tooltip names the file and the sprite; the overflow menu uses the same labels. The sprite
  name and exports are unchanged.
- A Help menu with About NGNE Sprite Editor…: the app's and `@ngne/core`'s versions, taken from
  `package.json` at build time, the licence, links to the repository and the changelog, and Copy
  version info, which copies one line for a bug report.
- Keyboard Shortcuts… moves from the Edit menu to the Help menu, above About. It opens the same
  shortcut sheet, still on `?`.
- `THIRD_PARTY_NOTICES.md` gives the upstream version of every ported part and adds Allegro's
  giftware licence, which covers the spline Aseprite's `algo_spline` adapts.
- `THIRD_PARTY_NOTICES.md` lists the curve tool's sample count (Aseprite's document library
  and Allegro) and the line helpers of two E2E tests (Alois Zingl's Bresenham algorithms).
- `THIRD_PARTY_NOTICES.md` adds the MIT notice of gif.js, which the GIF encoder bundled through
  `gifenc` credits.
- `THIRD_PARTY_NOTICES.md` adds the notices of gif-codec, which `gifenc` also credits, of
  Aseprite's render library, of Björn Ottosson's Oklab conversions (the colour distance of the
  PNG import) and of Tommy Ettinger's mulberry32 (the spray's generator), and lists the flood
  fill's colour-match rule (Aseprite's document library).
- `THIRD_PARTY_NOTICES.md` adds the notices of the Graphics Gems seed fill (the flood fill's
  stack of row spans) and of github-slugger (the heading slugs of the documentation link
  check). `licences.txt` lists Rolldown, whose runtime helpers the build writes into the bundle,
  with the third-party notices Rolldown ships; the build no longer adds Vite's module-preload
  polyfill.
- The README notes which earlier files named parts of Aseprite's application source.
- The pixel-perfect filter of the pencil and eraser is rewritten from a description of its
  behaviour; strokes keep exactly the same pixels.
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
  ([reference measurements](https://github.com/that-webdev-dude/ngne-sprite-editor/blob/v1.0.0/docs/perf/checkpoint-e-2026-10-21.md)). Separately, the
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
