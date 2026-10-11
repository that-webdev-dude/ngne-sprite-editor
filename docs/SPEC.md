# NGNE Sprite Editor — Specification

Status: **Draft — pending independent review** · Spec version 0.9 · 2026-10-11

Related: [DESIGN.md](DESIGN.md) (interface) · [tickets/README.md](tickets/README.md) (implementation breakdown)

## 1. Summary

A browser-based pixel-art sprite editor in the Aseprite mould (layers, frames, tags, onion skin,
selection, palette) whose canvas and animation preview are rendered by the NGNE engine
(`@ngne/core`), and whose export is a bundle an NGNE game can consume without hand-editing.

Three user constraints drive the design:

| ID  | Constraint                                                                 | Section |
| --- | -------------------------------------------------------------------------- | ------- |
| C1  | Save/export NGNE-ready assets                                              | §9      |
| C2  | Import PNG files and quantize them into sprites at a specified size        | §8      |
| C3  | Show an imported PNG behind the canvas as a reference image to draw over   | §7.6    |

## 2. Scope

### 2.1 Goals (v1)

- Aseprite's core authoring loop: draw, layer, animate, tag, preview, export.
- The viewport and preview are rendered through NGNE's WebGPU renderer.
- Export output is consumed by NGNE unmodified: `ngne-preview` accepts it and a scene can draw it.
- Minimal, professional interface ([DESIGN.md](DESIGN.md)).

### 2.2 Non-goals (v1)

- Server, accounts, collaboration. The app is static and local-first.
- A fallback renderer. NGNE is WebGPU-only; the editor shows a blocking notice without it.
- Changes to the NGNE repository. Engine gaps are worked around in the editor (§6.7).
- Touch/pen-pressure workflows and mobile layouts.

### 2.3 Aseprite parity matrix

"Same functionality as Aseprite" is delivered in tiers. `M1`–`M7` are v1 milestones; **Later** is
recorded backlog, not ticketed.

| Area       | Feature                                                              | Tier  |
| ---------- | -------------------------------------------------------------------- | ----- |
| Document   | New sprite, RGBA colour mode, canvas up to 1024×1024                 | M0–M1 |
| Document   | Canvas size, sprite size (resample), crop, trim, rotate/flip canvas  | M3    |
| Document   | Multiple open documents (tabs)                                       | M4    |
| Document   | Indexed and grayscale colour modes, pixel aspect ratio               | Later |
| Tools      | Pencil, eraser, eyedropper, bucket, line, rectangle, ellipse         | M1    |
| Tools      | Brush size/shape, pixel-perfect, ink: simple / alpha / lock-alpha    | M1    |
| Tools      | Hand, zoom, move                                                     | M1–M3 |
| Tools      | Rect/ellipse marquee, lasso, polygon lasso, magic wand               | M3    |
| Tools      | Curve, contour, polygon, spray                                       | M6    |
| Tools      | Gradient, blur/jumble, text, custom brushes, shading ink, slices     | Later |
| Selection  | Add/subtract/intersect, all/none/invert, move, nudge                 | M3    |
| Selection  | Cut/copy/paste (internal + system clipboard), delete, fill           | M3    |
| Selection  | Flip, rotate 90/180, free scale/rotate (nearest)                     | M3    |
| Selection  | RotSprite rotation, outline/stroke commands                          | Later |
| Layers     | Add, delete, duplicate, rename, reorder, visible, lock, opacity      | M2    |
| Layers     | Merge down, flatten                                                  | M2    |
| Layers     | Reference layers (C3)                                                | M4    |
| Layers     | Blend modes (19 Aseprite modes), cel opacity                         | M6    |
| Layers     | Groups, tilemap layers, background layer                             | Later |
| Animation  | Frames: add, delete, duplicate, reorder, per-frame duration          | M2    |
| Animation  | Cels: clear, move, copy, linked cels                                 | M2    |
| Animation  | Tags: name, colour, direction, repeat                                | M2    |
| Animation  | Playback, onion skin                                                 | M2    |
| Animation  | In-engine preview panel                                              | M5    |
| Colour     | FG/BG, picker (HSV, RGB, hex, alpha)                                 | M1    |
| Colour     | Palette panel, presets, import/export, palette from sprite, replace  | M6    |
| View       | Zoom, pan, pixel grid, tile grid, fit, 100%                          | M1    |
| View       | Symmetry (H/V), tiled mode                                           | M6    |
| View       | Rulers, guides                                                       | Later |
| File       | Project save/open, autosave, recovery                                | M4    |
| File       | PNG import with slicing and quantization (C2)                        | M4    |
| File       | NGNE bundle export (C1), PNG, sprite sheet, PNG sequence             | M5    |
| File       | Aseprite-format JSON export, GIF export                              | M6    |
| File       | `.aseprite` import/export                                            | Later |
| Edit       | Unlimited undo/redo within a memory budget                           | M0    |
| Edit       | History panel, customizable shortcuts                                | Later |
| Automation | Lua scripting, extensions, CLI                                       | Later |

## 3. Platform and support envelope

- Desktop Chrome or Edge, current stable, on a secure origin (HTTPS or localhost), hardware
  acceleration on. This matches NGNE's documented envelope (Chrome on Windows 11); other
  browsers are unverified and not blocked beyond the WebGPU check.
- Required browser APIs: WebGPU, `createImageBitmap` with `premultiplyAlpha: "none"`,
  Pointer Events, `ResizeObserver` (`devicePixelContentBoxSize`), IndexedDB.
- Progressive: File System Access API (direct save, export to a folder). Fallback is download.
- Minimum window: 1024×640 CSS px.

## 4. Stack

| Concern    | Choice                                             | Reason                                                |
| ---------- | -------------------------------------------------- | ----------------------------------------------------- |
| Engine     | `@ngne/core` **0.2.1**, exact pin (npm registry)   | C-level requirement; experimental API, pin per README |
| App        | React + TypeScript (strict) + Vite                 | Owner's default stack                                 |
| UI state   | `zustand`                                          | Small, works outside React for tool code              |
| Primitives | `radix-ui`                                         | Accessible menus, dialogs, popovers, sliders          |
| Icons      | `lucide-react`                                     | Consistent 16 px stroke set                           |
| PNG        | `fast-png`                                         | Lossless straight-alpha RGBA8 without Canvas2D        |
| Zip        | `fflate`                                           | Project container, zip downloads                      |
| GIF (M6)   | `gifenc`                                           | Small encoder; only for SE-063                        |
| Unit tests | Vitest (Node)                                      | `core/` is DOM-free                                   |
| E2E tests  | Playwright driving Chrome with WebGPU              | Screenshot-based pixel checks, as NGNE's own tooling  |

Versions observed on npm on 2026-10-11 (pin exact at scaffold; verify compatibility in SE-001):
react 19.3.0, vite 8.3.4, typescript 7.0.2, vitest 5.0.3, @playwright/test 1.64.0,
zustand 5.0.15, radix-ui 1.7.0, fflate 0.8.3, fast-png 8.0.0, gifenc 1.0.3. Node ≥ 24.

TypeScript settings follow the NGNE guide for Vite consumers: `moduleResolution: "Bundler"`,
DOM libs, `types: []`, `skipLibCheck: false`, `build.target: "es2022"`. NGNE itself is built
with TypeScript 5.9; if its declarations fail under TypeScript 7, SE-001 pins 5.9.x.

## 5. Architecture

```text
 ui/ (React)                 app/ (stores, tools, files)
 panels, dialogs, menus  --> commands, keymap, pointer pipeline
        |  subscribes               |  executes commands
        v                           v
 +--------------------------------------------------------------+
 | core/  (pure TS, no DOM): document model, undo, raster ops,  |
 | compositor, quantizer, packer, codecs. Source of truth.      |
 +--------------------------------------------------------------+
        |  composited RGBA buffers            |  packed atlas
        v                                     v
 engine/NgneViewport                    engine/NgnePreview
 WebGPURenderer + Frame                 BrowserGame + scene
 (edit canvas, on demand)               (fixed-step playback)
```

- `core/` imports nothing from the DOM, React, or NGNE. It runs under Vitest in Node. An import
  boundary lint enforces this.
- `engine/` is the only code that imports `@ngne/core`.
- `app/` owns editor state (active document, layer, frame, tool, colours, view) and translates
  input into `core` commands.
- `ui/` renders state and dispatches registered commands; it never mutates documents directly.

### 5.1 Document model

```ts
interface SpriteDoc {
    id: string;
    name: string;                 // also the export base name
    width: number;                // integer 1..1024
    height: number;               // integer 1..1024
    colorMode: "rgba";
    layers: Layer[];              // bottom to top
    frames: FrameInfo[];          // in playback order
    cels: Map<string, Cel>;       // key `${layerId}:${frameId}`; absent = empty cel
    images: Map<string, PixelBuffer>;
    tags: Tag[];
    palette: { name: string; colors: number[] };   // 0xRRGGBBAA
    pivot: { x: number; y: number };               // normalized 0..1, default 0.5,0.5
    grid: { width: number; height: number; offsetX: number; offsetY: number };
    exportSettings: ExportSettings;                // §9.6
}
type Layer = PixelLayer | ReferenceLayer;
interface LayerBase { id: string; name: string; visible: boolean; locked: boolean; opacity: number } // 0..255
interface PixelLayer extends LayerBase { kind: "pixel"; blend: BlendMode }
interface ReferenceLayer extends LayerBase {
    kind: "reference";
    sourceId: string;             // original image bytes, stored in the project
    x: number; y: number;         // top-left in document pixels (fractional allowed)
    scale: number;                // document pixels per source pixel
    placement: "behind" | "front";
}
interface FrameInfo { id: string; durationMs: number }          // integer >= 1, default 100
interface Cel { imageId: string; opacity: number }              // linked cels share imageId
interface PixelBuffer { width: number; height: number; data: Uint8ClampedArray } // straight RGBA8
interface Tag {
    id: string; name: string; color: number;
    fromFrameId: string; toFrameId: string;
    direction: "forward" | "reverse" | "pingpong";
    repeat: number;               // 0 = infinite
}
```

Invariants (asserted in tests and after every command in development builds):

- At least one pixel layer and one frame.
- Every cel's image exists and has the document's dimensions.
- An image with no referencing cel is removed by the command that orphans it.
- Tag endpoints reference existing frames with `from` not after `to`.
- IDs are unique; layer, frame and tag names need not be.

Cel images are full-canvas buffers. With the 1024×1024 cap a cel costs at most 4 MB; the app
warns when a document's pixel memory exceeds 512 MB. Trimmed cel storage is a Later optimization.

### 5.2 Commands and undo

- Every mutation is a `Command { do(doc), undo(doc), bytes }` executed through one history per
  document. UI state that Aseprite also undoes (selection, active frame after structural edits)
  is part of the command.
- Pixel commands store before/after patches for the dirty rectangle only.
- A tool stroke is one transaction: begin on pointer down, commit on pointer up, abort on Escape
  or pointer cancel (document returns to its pre-stroke state).
- History budget is 256 MB per document; the oldest entries are dropped first. Redo is cleared
  by a new command.

### 5.3 Compositing

The CPU compositor in `core/` is the single source of truth for pixels: the viewport, the
preview, thumbnails, the eyedropper and every export read its output. It:

- Composites visible pixel layers bottom to top with layer opacity × cel opacity and the layer's
  blend mode (M1: normal; M6: all modes) in straight-alpha sRGB space with integer math matching
  Aseprite's formulas.
- Recomposites only a dirty rectangle during strokes.
- Caches one composite per frame, invalidated by commands that touch that frame; cache budget
  128 MB, least recently used.

Reference layers are never part of this composite (§7.6).

## 6. NGNE integration

Facts below were read from `@ngne/core` 0.2.1 source and contracts. SE-002 verifies the ones
marked ⚠ empirically before any ticket builds on them.

### 6.1 Engine surface used

| API                                                   | Use                                        |
| ----------------------------------------------------- | ------------------------------------------ |
| `WebGPURenderer.create(canvas, w, h, onError)`        | Editing viewport                           |
| `renderer.texture(id, ImageBitmap, signal?)`          | Upload CPU buffers into fixed texture slots |
| `Frame`, `frame.scene(camera, 1)`, `frame.sprite()`   | Build the viewport's quad list             |
| `renderer.render(frame, clear)`, `renderer.status`    | Draw on demand, observe recovery           |
| `BrowserGame`, `SceneDefinition`, `scene.system/render` | Preview panel with fixed-step playback   |
| `Camera`                                              | Pan offset; `pixelSnap = false`            |

### 6.2 Engine behaviours that shape the design

| # | Behaviour                                                                 | Consequence                                                        |
| - | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1 | Renderer logical size is fixed at creation                                | Recreate the renderer on viewport resize or DPR change (debounced) |
| 2 | `texture()` uploads a whole image asynchronously                          | One upload per changed slot per animation frame at most ⚠ latency  |
| 3 | A second `texture()` call for an ID rejects the first as superseded       | Single-flight, latest-wins upload queue per slot                   |
| 4 | Manually registered textures cannot be released, only replaced            | Fixed, bounded set of slot IDs; never one ID per cel               |
| 5 | A frame referencing a texture that is not ready is skipped entirely       | Frame builder references only slots whose first upload resolved    |
| 6 | Sampler is nearest, clamp-to-edge; one blend (premultiplied source-over)  | Blend modes and smooth reference scaling happen on the CPU         |
| 7 | `Frame` rounds sprite centres unless `camera.pixelSnap` is false          | Disable snapping; compute integer top-left and size ourselves ⚠    |
| 8 | Clear colour is opaque                                                    | Transparency checkerboard is drawn by NGNE as a sprite             |
| 9 | Images are straight alpha, sRGB, decoded without conversion               | Build bitmaps from `ImageData` with `premultiplyAlpha: "none"`     |
| 10 | No texture readback API                                                  | Exports come from the CPU compositor; tests compare screenshots    |
| 11 | `maxTextureDimension2D` is the WebGPU default (8192)                     | Atlas and reference textures are capped at 8192 per side           |

### 6.3 Division of rendering

- **NGNE draws image content**: checkerboard, reference images, the composited frame, onion
  skins, tiled-mode copies, and everything in the preview panel.
- **A Canvas2D overlay draws editor chrome**: pixel/tile grid lines, selection marching ants,
  transform handles, brush cursor outline, symmetry axes. It is stacked above the NGNE canvas at
  the same device-pixel size and receives all pointer input.

### 6.4 Viewport (`NgneViewport`)

- Canvas backing size = the viewport element's size in device pixels
  (`devicePixelContentBoxSize`). Resize or DPR change recreates the renderer after 120 ms of
  quiet; until then the old canvas is CSS-stretched. All slots are re-uploaded from CPU buffers.
- Zoom is an integer number of device pixels per sprite pixel (1, 2, 3, 4, 5, 6, 8, 10, 12, 16,
  20, 24, 32, 48, 64) plus 1/2, 1/4 and 1/8 for large canvases. Texels are always square and
  aligned to device pixels at fractional DPR.
- View state per document: `scale`, integer `originX`/`originY` (device pixels). The document
  rectangle is `[originX, originY, width × scale, height × scale]`.
- Rendering is on demand: a dirty flag schedules one `requestAnimationFrame`; an idle editor
  submits no frames.
- `renderer.status` is polled on each draw; `failed` triggers a fresh renderer and re-upload.

Texture slots (IDs are fixed for the life of a renderer):

| Slot             | Content                                              | Uploaded when                      |
| ---------------- | ---------------------------------------------------- | ---------------------------------- |
| `ed:checker`     | Checkerboard at document resolution                  | Size or checker setting changes    |
| `ed:frame`       | Composite of the current frame (incl. live stroke)   | Any visible pixel change           |
| `ed:onion:0..5`  | Composites of neighbouring frames                    | Frame switch or neighbour edited   |
| `ed:ref:0..3`    | Reference images, pre-scaled on the CPU (§7.6)       | Zoom settles, reference changes    |

Quad order (NGNE `layer` value): 1 checkerboard · 2 references placed behind · 3 onion skins
behind · 4 current frame · 5 onion skins in front · 6 references placed in front. Tiled mode
draws the frame slot nine times.

Upload queue rules: one in-flight upload per slot; a newer request replaces the queued one;
rejections with "superseded" or abort are ignored; any other rejection is reported and retried
once after `renderer.status` returns to `ready`.

### 6.5 Preview panel (`NgnePreview`)

- A second canvas owned by a `BrowserGame` with one scene. Its logical size is the document
  size; CSS scales it with `image-rendering: pixelated` (the same approach as `ngne-preview`).
- Input to the scene is **the exporter's own output held in memory**: the packed atlas pixels
  and atlas metadata from §9. The scene uploads the atlas to slot `pv:atlas` and draws
  `frame.sprite({ texture, u, v, uw, vh })`.
- A scene system advances `ageMs` by `dt × 1000 × speed` and resolves the entry with the same
  function the generated helper module exports. Preview therefore equals what a game draws.
- Edits repack and re-upload after 150 ms of quiet. A document size change recreates the
  `BrowserGame`. A hidden panel or tab stops it (`app.stop()`).

### 6.6 Performance budgets

Reference hardware: Intel UHD (gen-12), Chrome, Windows 11. Document 256×256, 8 layers.

| Metric                                                   | Budget          |
| -------------------------------------------------------- | --------------- |
| Pointer event to uploaded `ed:frame` texture, p95        | ≤ 33 ms         |
| Dirty-rectangle recomposite for a 16 px brush dab        | ≤ 2 ms          |
| Frame switch (cached composite) to presented frame       | ≤ 16 ms         |
| Idle editor: frames submitted per second                 | 0               |
| Cold load to interactive (production build, local)       | ≤ 2 s           |

If SE-002 measures the first budget as unreachable, the fallback is an immediate stroke echo on
the Canvas2D overlay that is cleared when the matching upload resolves. The spec is amended and
re-reviewed before SE-011 starts.

### 6.7 Engine gaps and workarounds

Recorded for the engine owner; none is required for v1.

| Gap in NGNE 0.2.1                         | Workaround here                          |
| ----------------------------------------- | ---------------------------------------- |
| No release for manual textures            | Fixed slot pool                          |
| No partial or synchronous texture update  | Whole-slot upload, single-flight queue   |
| No blend modes beyond source-over         | CPU compositor                           |
| Fixed renderer size                       | Recreate on resize                       |
| No repeat addressing, no linear filtering | Checker texture; CPU pre-scaled references |
| No camera zoom                            | Scale sprite sizes when building frames  |
| No readback                               | CPU export; screenshot-based tests       |

## 7. Editor behaviour

### 7.1 Tools

Shared options: brush size 1–64, brush shape (square, circle), pixel-perfect, ink (simple,
alpha compositing, lock alpha), opacity. Left button paints foreground, right button background.
Strokes interpolate between pointer samples (coalesced events) with Bresenham lines.

| Tool           | Key       | Behaviour                                                              |
| -------------- | --------- | ---------------------------------------------------------------------- |
| Pencil         | B         | Freehand; pixel-perfect removes L-shaped corners                       |
| Eraser         | E         | Writes transparent; right button erases to background colour           |
| Eyedropper     | I (Alt)   | Samples composite or active layer; left sets FG, right sets BG         |
| Paint bucket   | G         | Flood fill; contiguous toggle; tolerance 0–255; samples layer or composite |
| Line           | L         | Shift constrains to 45° steps                                          |
| Rectangle      | U         | Outline or filled; Shift = square; Ctrl = from centre                  |
| Ellipse        | Shift+U   | Outline or filled; Shift = circle; Ctrl = from centre                  |
| Rect marquee   | M         | Shift add, Alt subtract, Shift+Alt intersect                           |
| Ellipse marquee| Shift+M   | Same modifiers                                                         |
| Lasso          | Q         | Freehand selection                                                     |
| Polygon lasso  | Shift+Q   | Click vertices; Enter or double-click closes                           |
| Magic wand     | W         | Tolerance, contiguous                                                  |
| Move           | V         | Moves selection content or, with no selection, the active cel          |
| Hand           | H (Space) | Pan                                                                    |
| Zoom           | Z         | Click in, Alt-click out; wheel zooms about the cursor                  |

A locked or hidden layer, or a reference layer, rejects paint with a status-bar message.
Paint is clipped to the selection when one exists.

### 7.2 Selection

- A selection is a per-document 1-bit mask plus bounds. Changing it is undoable.
- Moving or transforming selected pixels lifts them into a floating selection composited above
  the active cel; Enter/click-outside applies, Escape cancels.
- Clipboard: internal buffer always; system clipboard `image/png` when permitted. Paste creates
  a floating selection at the viewport centre.
- Transforms use nearest-neighbour sampling. Arrow keys nudge 1 px, Shift+arrow 8 px.

### 7.3 Layers

Add, delete, duplicate, rename, reorder (drag), visibility, lock, opacity, merge down, flatten.
The last pixel layer cannot be deleted. Merge down and flatten bake opacity and blend mode.

### 7.4 Frames, cels and tags

- New frame: empty or a duplicate of the current frame (Aseprite default: duplicate).
- Linked cels share one image; editing either edits both. "Unlink" copies the image.
- Tag direction and repeat affect editor playback and export expansion (§9.3).
- Durations are per frame, 1–65535 ms, editable for a multi-frame selection.

### 7.5 Playback and onion skin

- Editor playback steps the active frame in the viewport by elapsed visible time. It plays the
  tag under the playhead, or all frames. Speed 0.25×–4×. Onion skin is hidden while playing.
- Onion skin: 0–3 frames before and after, base opacity with per-step falloff, optional red/blue
  tint (NGNE `color` multiply), placement behind or in front.

### 7.6 Reference layers (C3)

- Created by "Import → as reference", by drag-and-drop with the reference option, or by "keep
  source as reference" in the quantize import (§8).
- Default placement **behind** all pixel layers; fitted and centred to the canvas; opacity 50%.
- Editable properties: position, uniform scale, opacity, visibility, lock, placement
  (behind/front). Never painted on, never exported, never part of the CPU composite.
- Display quality: NGNE samples nearest, so the editor resamples the source on the CPU to its
  on-screen device-pixel size (`createImageBitmap` with `resizeQuality: "high"`), capped at the
  source resolution and at 4096 px per side, 100 ms after zoom settles. It is then drawn 1:1.
- Up to four reference layers per document. The original bytes are stored in the project file.

### 7.7 Sprite operations

Canvas size (anchor), sprite size (nearest or area average; all cels), crop to selection, trim,
rotate canvas 90/180, flip canvas. Each is one undoable command over every cel.

### 7.8 Keyboard

Aseprite's defaults where the browser allows. Browser-reserved chords (Ctrl+N, Ctrl+T, Ctrl+W)
get alternates and are always reachable through the menu and command palette (Ctrl+K). The full
map lives in the command registry and is listed in the in-app shortcut sheet.

## 8. PNG import and quantization (C2)

Entry points: File → Import, drag-and-drop onto the window, paste. One dialog, live
before/after preview, deterministic output for identical inputs and settings.

Pipeline, in order:

| Step        | Options                                                                                   | Default            |
| ----------- | ----------------------------------------------------------------------------------------- | ------------------ |
| 1 Decode    | PNG to straight RGBA8 with `fast-png` (no premultiplication)                              | —                  |
| 2 Region    | Whole image or crop rectangle                                                             | Whole image        |
| 3 Slice     | Single sprite, or grid: cell W×H or columns×rows, offset, spacing; skip empty cells       | Single sprite      |
| 4 Size      | **Target sprite size W×H**; fit: stretch, contain, cover                                  | Document size or 32×32 |
| 5 Resample  | Nearest, area average, dominant colour per block                                          | Area average       |
| 6 Alpha     | Keep, or threshold 1–255 to binary; optional colour key with tolerance                    | Threshold 128      |
| 7 Colours   | Keep; reduce to N (2–256); map to current or preset palette                               | Reduce to 16       |
| 8 Dither    | None, ordered (Bayer 4×4), Floyd–Steinberg                                                | None               |
| 9 Place     | New document; new frames in current document; new layer; plus "keep source as reference"  | New document       |

Rules:

- Step 3 yields N cells in row-major order; each becomes one frame.
- Step 4 is the "specified size": every cell is resampled to exactly W×H.
- Step 7 "reduce" builds **one palette across all cells** (median cut, then 8 fixed k-means
  iterations seeded from the median-cut result). Colour distance is OKLab. The resulting palette
  can replace or extend the document palette.
- Placing into an existing document requires the target size to equal the document size.
- "Keep source as reference" adds a reference layer positioned and scaled so that the cropped
  region overlays the canvas exactly.
- Limits: source up to 8192×8192; at most 1024 resulting frames; clear error otherwise.

## 9. NGNE asset export (C1)

NGNE defines no engine-level asset format; consumers own theirs. "NGNE-ready" therefore means
the four files below, which use only NGNE's public API and the `ngne-preview` adapter schema.

### 9.1 Bundle

| File                         | Purpose                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `<name>.png`                 | Atlas: RGBA8, straight alpha, sRGB, no colour-profile chunks       |
| `<name>.atlas.json`          | Frames and animations (§9.2), engine-agnostic data                 |
| `<name>.sprites.ts`          | Typed helper: `imageAsset` definition, draw and animation lookup   |
| `<name>.preview.config.mjs`  | Ready for `ngne-preview ./<name>.preview.config.mjs`               |

`<name>` is the document name slugified to `[a-z0-9][a-z0-9-]*`.

### 9.2 `ngne-sprite-atlas` version 1

```json
{
    "format": "ngne-sprite-atlas",
    "version": 1,
    "generator": "ngne-sprite-editor 1.0.0",
    "image": "hero.png",
    "width": 128,
    "height": 64,
    "frames": {
        "hero-0": {
            "x": 1, "y": 1, "w": 32, "h": 32,
            "sourceW": 32, "sourceH": 32, "offsetX": 0, "offsetY": 0,
            "pivot": [0.5, 0.5]
        }
    },
    "animations": {
        "walk": {
            "playback": "loop",
            "entries": [{ "frame": "hero-0", "ms": 100 }]
        }
    }
}
```

- `x, y, w, h`: atlas rectangle in pixels, top-left origin, never rotated.
- `sourceW, sourceH`: untrimmed frame size (the document size). `offsetX, offsetY`: where the
  rectangle sits inside the source frame. Without trimming these are `w, h, 0, 0`.
- `pivot`: normalized within the **source** frame. Draw centre for an anchor at `(px, py)`:
  `px + offsetX + w/2 − pivot[0]·sourceW`, likewise for y.
- `animations[*].playback` is `"loop"` or `"once"`; `entries[*].ms` is a positive integer.
  This is the `ngne-preview` animation shape.
- Frame and animation IDs match `[a-z0-9][a-z0-9_-]*` and are unique case-insensitively.
- Fully transparent pixels are written as `0,0,0,0`. Output is byte-deterministic.

### 9.3 Mapping from the document

- Frame IDs: `<name>-<index>`, zero-based, in frame order.
- Each tag becomes an animation named by the slugified tag name. `reverse` and `pingpong` are
  expanded into explicit entries (ping-pong does not repeat the end frames). `repeat = 0` →
  `"loop"`; `repeat = n` → `"once"` with the sequence written n times.
- Frames outside every tag are still exported as frames. A multi-frame document with no tags
  gets one `"loop"` animation named `<name>` covering all frames.
- Duplicate tag slugs get `-2`, `-3` suffixes; the dialog shows the final IDs.

### 9.4 Packing

- Layout: uniform grid, near-square by default; or single row / single column.
- Options: padding 0–8 px (default 1), extrude 0–2 px (default 0), trim transparent borders
  (default off), merge identical frames (default on; merged IDs share one rectangle).
- Atlas side limit 8192 px; exceeding it is an export error naming the limit.
- Packing is deterministic for identical documents and settings.

### 9.5 Generated modules

`<name>.sprites.ts` is self-contained (atlas data inlined `as const`; only `@ngne/core`
imported) and exports:

- `<name>Image`: `imageAsset("<name>", new URL("./<name>.png", import.meta.url).href)`.
- `draw<Name>(frame, id, x, y, options?)`: computes UVs and the pivot-corrected centre, then
  calls `frame.sprite`. Options: `rotation`, `layer`, `depth`, `alpha`, `color`, `scale`,
  `flipX`, `flipY`.
- `<name>AnimationFrame(animation, ageMs)`: returns the frame ID at that age; for `"once"`
  returns the last entry after the end. Start-inclusive, end-exclusive intervals.

`<name>.preview.config.mjs` default-exports `{ images, frames, animations, display }` per the
`ngne-preview` schema: frame `x/y/width/height` from the atlas, `destinationWidth/Height` equal
to `w/h`, `display: { density: 1, scale: 1, pixelSnap: true }`.

### 9.6 Delivery and other exports

- With the File System Access API the user picks a folder once per document; the handle is
  remembered. "Export again" (Ctrl+Shift+E) rewrites the bundle without a dialog. An optional
  "export on save" setting does the same on Ctrl+S.
- Without that API the bundle downloads as `<name>.zip`.
- Other exports: current frame PNG (scale 1–16×), sprite sheet PNG alone, PNG sequence (zip);
  M6 adds Aseprite-format JSON and GIF.

### 9.7 Conformance

Export is accepted only when all three hold (SE-053):

1. `<name>.atlas.json` validates against the schema and its rectangles lie inside the PNG.
2. The installed `ngne-preview` binary starts on `<name>.preview.config.mjs` without a
   startup diagnostic.
3. A fixture NGNE scene importing `<name>.sprites.ts` draws every frame, and a screenshot of
   each matches the CPU composite (exact for opaque pixels, ±1 per channel elsewhere).

## 10. Project file and persistence

- `.ngsprite` is a zip: `manifest.json` (`format: "ngne-sprite-project"`, `version: 1`, app
  version), `doc.json` (the model without pixels), `images/<imageId>.png` (lossless RGBA8),
  `refs/<sourceId>.png` (original bytes), `thumb.png`.
- Loading validates the manifest, runs version migrations, then checks model invariants. An
  unknown newer version is refused with a message; corrupt entries name the failing file.
- Save/Save As use the File System Access API when present, otherwise download. Open also
  accepts drag-and-drop.
- Autosave: each open document is snapshotted to IndexedDB 2 s after its last change. On
  launch, unsaved snapshots are offered for recovery. Closing a tab with unsaved changes
  triggers the browser's unload confirmation.

## 11. Quality

| Layer       | What is tested                                                                        |
| ----------- | ------------------------------------------------------------------------------------- |
| Unit (Node) | Model invariants, every command's do/undo symmetry, raster algorithms against golden buffers, compositor, quantizer determinism, packer, codecs (round trip, byte-exact PNG) |
| E2E         | Draw-undo-redo, layer/frame/tag flows, selection and transform, import, save/open round trip, export conformance (§9.7), viewport screenshots at DPR 1 and 1.5 |
| Performance | §6.6 budgets measured by a scripted benchmark page; recorded, not asserted in CI      |
| Manual      | Interface review against DESIGN.md on reference hardware                              |

Definition of done for every ticket: acceptance criteria met; unit tests for `core/` changes;
E2E for user-visible flows; typecheck, lint and format clean; no new dependency beyond §4
without a recorded decision.

## 12. Assumptions adopted

These were decided to keep the plan unblocked. Each can be overridden before the listed ticket
starts; changing one after that point is a change request.

| ID | Assumption                                                                                           | Override before |
| -- | ---------------------------------------------------------------------------------------------------- | --------------- |
| A1 | v1 scope is the M1–M7 tier of §2.3; "Later" items are out                                            | SE-001          |
| A2 | "NGNE-ready" is the four-file bundle and schema of §9                                                 | SE-051          |
| A3 | "Quantize into sprites at the specified size" is slice → resample to W×H → reduce colours (§8)       | SE-043          |
| A4 | The editor consumes the published `@ngne/core` 0.2.1 and does not modify the engine                   | SE-001          |
| A5 | Dependencies in §4 are approved                                                                       | SE-001          |
| A6 | Desktop Chrome/Edge only; no fallback renderer                                                        | SE-001          |
| A7 | Reference images render behind or in front of all pixel layers, not at arbitrary stack positions      | SE-045          |

## 13. Risks

| Risk                                                        | Likelihood | Mitigation                                               |
| ----------------------------------------------------------- | ---------- | -------------------------------------------------------- |
| Async whole-texture upload makes strokes feel laggy         | Medium     | SE-002 measures; overlay stroke echo fallback (§6.6)     |
| Pixel misalignment at fractional DPR                        | Medium     | Integer device-pixel zoom, snap off, screenshot tests    |
| NGNE 0.x API changes                                        | Medium     | Exact pin; all engine use isolated in `engine/`          |
| Two WebGPU devices (viewport + preview) on weak GPUs        | Low        | SE-002 verifies; preview stops when hidden               |
| Scope creep toward full Aseprite parity                     | High       | §2.3 tiers; Later items need a new spec revision         |
| Browser-reserved shortcuts break Aseprite muscle memory     | Certain    | Alternates, command palette, PWA window (SE-072)         |
