# NGNE Sprite Editor — Specification

Status: **Ready for implementation — owner acknowledgements A1–A9 recorded** ([REVIEW.md](REVIEW.md)) · Spec version 1.0 · 2026-10-11

Related: [DESIGN.md](DESIGN.md) (interface) · [tickets/README.md](tickets/README.md) (implementation
breakdown) · [REVIEW.md](REVIEW.md) (review record, owner acknowledgements)

## 1. Summary

A browser-based pixel-art sprite editor in the Aseprite mould (layers, frames, tags, onion skin,
selection, palette) whose canvas and animation preview are rendered by the NGNE engine
(`@ngne/core`), and whose export is a bundle an NGNE game can consume without hand-editing.

Three owner constraints drive the design:

| ID  | Constraint                                                                 | Section |
| --- | -------------------------------------------------------------------------- | ------- |
| C1  | Save/export NGNE-ready assets                                              | §9, §10 |
| C2  | Import PNG files and quantize them into sprites at a specified size        | §8      |
| C3  | Show an imported PNG behind the canvas as a reference image to draw over   | §7.6    |

## 2. Scope

### 2.1 Goals (v1)

- Aseprite's core authoring loop: draw, layer, animate, tag, preview, export.
- The viewport and preview are rendered through NGNE's WebGPU renderer.
- Export output is consumed by NGNE unmodified: `ngne-preview` loads it and a scene draws it.
- Minimal, professional interface ([DESIGN.md](DESIGN.md)).

### 2.2 Non-goals (v1)

- Server, accounts, collaboration. The app is static and local-first.
- A fallback renderer. NGNE is WebGPU-only; the editor shows a blocking notice without it.
- Changes to the NGNE repository. Engine gaps are worked around in the editor (§6.8).
- Touch/pen-pressure workflows and mobile layouts.

### 2.3 Aseprite parity matrix

Full Aseprite parity is not a v1 deliverable. It is delivered in tiers: `M0`–`M7` are v1
milestones; **Later** is recorded backlog, not ticketed. This table is the complete cut list the
owner acknowledges under A1 (§12).

| Area       | Feature                                                              | Tier  |
| ---------- | -------------------------------------------------------------------- | ----- |
| Document   | New sprite, sprite properties (name, pivot, grid), RGBA colour mode, canvas up to 1024×1024 | M0 |
| Document   | Canvas size, sprite size (resample), crop, trim, rotate/flip canvas  | M3    |
| Document   | Multiple open documents (tabs)                                       | M4    |
| Document   | Indexed and grayscale colour modes, pixel aspect ratio, user data, multiple views of one document | Later |
| Document   | New sprite or layer from selection                                   | Later |
| Tools      | Pencil, eraser, eyedropper, bucket, line, rectangle, ellipse         | M1    |
| Tools      | Brush size/shape, pixel-perfect, ink: simple / alpha / lock-alpha    | M1    |
| Tools      | Hand, zoom                                                           | M1    |
| Tools      | Move; rect/ellipse marquee, lasso, polygon lasso, magic wand         | M3    |
| Tools      | Curve, contour, polygon, spray                                       | M6    |
| Tools      | Gradient, blur/jumble, text, custom brushes, shading ink, copy alpha+colour ink, slices | Later |
| Selection  | Add/subtract/intersect, all/none/invert, move, nudge                 | M3    |
| Selection  | Cut/copy/paste (internal + system clipboard), delete, fill           | M3    |
| Selection  | Flip, rotate 90/180, free scale/rotate (nearest)                     | M3    |
| Selection  | Colour range, border/expand/contract, RotSprite rotation, outline/stroke, shift/wrap | Later |
| Layers     | Add, delete, duplicate, rename, reorder, visible, lock, opacity      | M2    |
| Layers     | Merge down, flatten                                                  | M2    |
| Layers     | Reference layers (C3)                                                | M4    |
| Layers     | Blend modes (19 Aseprite modes), cel opacity                         | M6    |
| Layers     | Groups, tilemap layers, background layer, continuous layers, cel z-index | Later |
| Layers     | Cel position / off-canvas pixels (v1 clips cels to the canvas)       | Later |
| Animation  | Frames: add, delete, duplicate, reorder, reverse, per-frame duration | M2    |
| Animation  | Cels: clear, move, copy, linked cels                                 | M2    |
| Animation  | Tags: name, colour, direction (forward, reverse, ping-pong), repeat  | M2    |
| Animation  | Playback, onion skin                                                 | M2    |
| Animation  | In-engine preview panel                                              | M5    |
| Animation  | Ping-pong-reverse direction                                          | Later |
| Colour     | FG/BG, picker (HSV, RGB, hex, alpha)                                 | M1    |
| Colour     | Preset palettes (data), palette from quantized import                | M4    |
| Colour     | Palette panel, edit, palette from sprite                             | M6    |
| Colour     | Palette files (.gpl, .hex, .pal), replace colour, sort               | M6    |
| Colour     | Colour filters (hue/saturation, brightness/contrast, invert, curves, convolution, despeckle) | Later |
| View       | Zoom, pan, pixel grid, tile grid, fit, 100%                          | M1    |
| View       | Symmetry (H/V), tiled mode                                           | M6    |
| View       | Rulers, guides, snap to grid                                         | Later |
| File       | Project save/open, autosave, recovery                                | M4    |
| File       | PNG import with slicing and quantization (C2)                        | M4    |
| File       | NGNE bundle export (C1), Aseprite-format JSON, PNG, sprite sheet, PNG sequence | M5 |
| File       | Export subset: all frames or one tag                                 | M5    |
| File       | GIF export                                                           | M6    |
| File       | Export split by layer or tag; chosen-layer export                    | Later |
| File       | `.aseprite` import/export; open/save GIF, JPG, BMP, WebP             | Later |
| Edit       | Unlimited undo/redo within a memory budget                           | M0    |
| Edit       | Command palette, preferences, shortcut sheet                         | M6    |
| Edit       | History panel, customizable shortcuts                                | Later |
| Automation | Lua scripting, extensions, CLI                                       | Later |

Known deviation: Aseprite keeps cel pixels moved off-canvas; v1 clips them when a move is applied.

Palette (SE-060): the palette is document data (§5.1), saved with the document, and changes
only through commands (§5.2), each one undo step that touches no frame, layer or structure and
records nothing when it would change nothing: add a colour (not one the palette holds, nor a
257th), remove, move or edit a colour, load a preset (its name and colours), and palette from
sprite. Palette from sprite reads the composite of every frame (§5.3: what the sprite shows,
hidden and reference layers left out): every colour of a pixel whose alpha is above 0, by its
R, G and B, as an opaque colour, when there are at most 256; otherwise `buildPalette` (§8 step
7) reduces them to 256. Either way the colours go dark to light and the palette takes the
sprite's name; a sprite with no visible pixel gives an empty palette.

## 3. Platform and support envelope

- Desktop Chrome or Edge, current stable, on a secure origin (HTTPS or localhost), hardware
  acceleration on. This matches NGNE's documented envelope (Chrome on Windows 11); other
  browsers are unverified and not blocked beyond the WebGPU check.
- Required browser APIs: WebGPU, `createImageBitmap` with `premultiplyAlpha: "none"`,
  Pointer Events, `ResizeObserver` (`devicePixelContentBoxSize`), IndexedDB, Web Workers.
- Progressive: File System Access API (direct save, export to a folder). Fallback is download.
- Minimum window: 1280×720 CSS px (DESIGN §2 defines the layout at that size).
- Reference hardware for budgets and manual checks is NGNE's own validation envelope: Windows 11,
  Chrome, Intel UHD (gen-12) and an NVIDIA RTX 4060 laptop GPU (A9).

## 4. Stack

Runtime dependencies (the only ones allowed without a recorded decision):

| Concern    | Choice                                             | Reason                                                |
| ---------- | -------------------------------------------------- | ----------------------------------------------------- |
| Engine     | `@ngne/core` **0.2.1**, exact pin (npm registry)   | Owner requirement; experimental API, pin per README   |
| App        | `react`, `react-dom`                               | Owner's default stack                                 |
| UI state   | `zustand`                                          | Small, usable outside React for tool code             |
| Primitives | `radix-ui`                                         | Accessible menus, dialogs, popovers, sliders          |
| Icons      | `lucide-react`                                     | Consistent 16 px stroke set                           |
| PNG        | `fast-png` (encode); own decoder in `core/png`     | Lossless straight-alpha RGBA8 without Canvas2D        |
| Zip        | `fflate`                                           | Project container, zip downloads                      |
| GIF (M6)   | `gifenc`                                           | Small encoder; only for SE-063                        |

Development tooling (not restricted to this list): TypeScript (strict), Vite and its React
plugin, Vitest (Node environment), Playwright driving **installed Chrome** (`channel: "chrome"`,
new headless mode), ESLint, Prettier, axe, a property-testing library, a PWA build plugin.

Versions observed on npm on 2026-10-11 (pin exact at scaffold; verify compatibility in SE-001):
react 19.3.0, vite 8.3.4, typescript 7.0.2, vitest 5.0.3, @playwright/test 1.64.0,
zustand 5.0.15, radix-ui 1.7.0, fflate 0.8.3, fast-png 8.0.0, gifenc 1.0.3. Node ≥ 24.

TypeScript settings follow the NGNE guide for Vite consumers: `moduleResolution: "Bundler"`,
DOM libs, `types: []`, `skipLibCheck: false`, `build.target: "es2022"`. NGNE itself is built
with TypeScript 5.9; if its declarations fail under TypeScript 7, SE-001 pins 5.9.x.

Recorded by SE-001 (2026-10-11): TypeScript is pinned to **5.9.3**, not 7.0.2. The cause is the
lint toolchain, not NGNE: `typescript-eslint` 8.71.1 accepts TypeScript below 6.1 only, and
TypeScript 7 does not ship the JavaScript compiler API it parses with. NGNE's declarations pass
under 5.9.3 with `skipLibCheck: false`. That DOM library has no WebGPU types, so code reading
`navigator.gpu` declares the fields it uses. Other versions are as listed above, plus
lucide-react 1.55.0, eslint 10.12.0, prettier 3.9.10, fast-check 4.10.2 and
@axe-core/playwright 4.13.0.

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
- `app/` owns transient editor state (tool, tool options, colours, view, floating selection) and
  translates input into `core` commands.
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
    palette: { name: string; colors: number[] };   // 0xRRGGBBAA, at most 256
    pivot: { x: number; y: number };               // normalized 0..1, default 0.5,0.5
    settings: DocSettings;
    exportSettings: ExportSettings;
}
type Layer = PixelLayer | ReferenceLayer;
interface LayerBase { id: string; name: string; visible: boolean; locked: boolean; opacity: number } // 0..255
interface PixelLayer extends LayerBase { kind: "pixel"; blend: BlendMode }
interface ReferenceLayer extends LayerBase {
    kind: "reference";
    sourceId: string;             // original image bytes, stored in the project
    x: number; y: number;         // top-left in document pixels (fractional allowed)
    scale: number;                // document pixels per source pixel, > 0
    placement: "behind" | "front";
}
type BlendMode =
    | "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten"
    | "color-dodge" | "color-burn" | "hard-light" | "soft-light" | "difference" | "exclusion"
    | "hue" | "saturation" | "color" | "luminosity" | "addition" | "subtract" | "divide";
interface FrameInfo { id: string; durationMs: number }          // integer 1..65535, default 100
interface Cel { imageId: string; opacity: number }              // 0..255, default 255; linked cels share imageId
interface PixelBuffer { width: number; height: number; data: Uint8ClampedArray } // straight RGBA8
interface Tag {
    id: string; name: string; color: number;
    fromFrameId: string; toFrameId: string;
    direction: "forward" | "reverse" | "pingpong";
    repeat: number;               // integer 0..255; 0 = infinite
}
interface DocSettings {
    grid: { width: number; height: number; offsetX: number; offsetY: number; visible: boolean };
    pixelGrid: boolean;
    onion: {
        enabled: boolean; before: number; after: number;      // 0..3 each
        opacity: number; falloff: number;                     // 0..255, 0..1
        tint: boolean; placement: "behind" | "front"; withinTag: boolean;
    };
    symmetry: { mode: "none" | "x" | "y" | "both"; axisX: number; axisY: number }; // half-pixel units
    tiled: "none" | "x" | "y" | "both";
}
interface ExportSettings {
    layout: "grid" | "row" | "column";
    padding: number;              // 0..8, default 1
    extrude: number;              // 0..2, default 0
    trim: boolean;                // default false
    mergeDuplicates: boolean;     // default true
    frames: "all" | { tagId: string };
    files: { spritesTs: boolean; previewConfig: boolean; asepriteJson: "none" | "array" | "hash" };
    exportOnSave: boolean;
}
```

Every field above is persisted in the project file (§10). `BlendMode` values other than
`normal`, `Cel.opacity` below 255, `symmetry`, `tiled` and `onion` exist in the model from M0 and
gain behaviour in their tickets; until then they keep their defaults.

Invariants (asserted in tests and after every command in development builds):

- At least one pixel layer and one frame; at most four reference layers.
- Every cel's image exists and has the document's dimensions.
- An image with no referencing cel is removed by the command that orphans it.
- Tag endpoints reference existing frames with `from` not after `to`.
- `exportSettings.frames` references an existing tag or is `"all"`; deleting that tag resets
  it to `"all"` (restored by undo).
- IDs are unique; layer, frame and tag names need not be.

Cel images are full-canvas buffers, clipped to the canvas. With the 1024×1024 cap a cel costs at
most 4 MB; the app warns when a document's pixel memory exceeds 512 MB and refuses operations
that would exceed 1 GB (typed error, document unchanged).

### 5.2 Sessions, commands and undo

```ts
interface DocSession {            // in core; one per open document
    doc: SpriteDoc;
    selection: Selection | null;  // 1-bit mask + bounds; not persisted
    activeLayerId: string;
    activeFrameId: string;
}
interface Command {
    label: string;
    do(session: DocSession): void;
    undo(session: DocSession): void;
    bytes: number;                // retained memory, for the budget
    touched: { frameIds: string[]; layerIds: string[]; structure: boolean };
}
```

- Every mutation of a `DocSession` is a command executed through one history per document.
  Selection, active layer and active frame are session state, so commands can restore them the
  way Aseprite does without `core` importing `app`.
- Pixel commands store before/after patches for the dirty rectangle only.
- A tool stroke is one transaction: `begin({ layerId, frameId })` snapshots the target image
  (creating the image and cel when the cel is empty), the tool writes pixels directly, `commit`
  produces one command, `abort` restores the snapshot (and removes a cel it created). Escape and
  pointer cancel abort.
- History budget is 256 MB per document; oldest entries are dropped first; the newest command is
  always retained even when it alone exceeds the budget. Redo is cleared by a new command.
- A command that cannot allocate memory aborts cleanly: document unchanged, typed error, toast.
- `touched` drives compositor cache invalidation and viewport refresh (§5.3, §6.4).
  `frameIds` and `layerIds` name every frame and layer whose composite can differ after the
  command, including a cel the command creates or removes. `structure` is true when the list
  of layers, frames or tags changes (an entry added, removed or reordered) or the document's
  size changes; a command that only changes pixels or cels reports `structure: false`.
  Document properties outside the composite (name, pivot) are not part of `touched`.
- `DocSettings` and `ExportSettings` are the exception: they are view and output preferences,
  changed by plain setters that create no history entry (as in Aseprite, toggling the grid or
  onion skin is not undoable). Both are written whenever the document is saved or autosaved.
- A document is **dirty** when its history position differs from the saved position, or its
  `ExportSettings` changed since the last save. `DocSettings` changes alone do not make it
  dirty, so a view toggle never triggers the unsaved marker or the close confirmation.

Floating selection (pixels lifted for move/transform/paste) is transient `app` state inside an
open transaction. It is applied automatically before: frame or layer switch, tool change to a
non-move tool, save, export, playback start, any sprite-wide command. Undo while floating
cancels the float. Selection masks survive frame and layer switches and are not saved.

### 5.3 Compositing

The CPU compositor in `core/` is the single source of truth for pixels: the viewport, the
preview, thumbnails, the eyedropper and every export read its output. It:

- Composites visible pixel layers bottom to top with layer opacity × cel opacity and the layer's
  blend mode (M1: normal; M6: all modes) in straight-alpha sRGB space with integer math matching
  Aseprite's formulas. A result pixel with alpha 0 is always `0,0,0,0`: colour stored under
  alpha 0 never reaches the composite (Aseprite's blend function keeps it).
- Recomposites only a dirty rectangle during strokes.
- Caches one composite per frame, invalidated from `Command.touched`; cache budget 128 MB per
  document, least recently used. Only the active document keeps composites: a document that
  stops being active has its cache cleared (SE-047).
- The cache of the active document belongs to `app` (`app/state/composites`), not to the
  viewport. Every reader takes composites from it and hears of changes from it, after it has
  been brought up to date for a history step, so no reader is served a composite from before
  the step.
- A stroke composites its frame once at the press and hands the buffer to the cache
  (`CompositeCache.adopt`, kept only while the frame's layer stack is the one it was composited
  from). The stroke then rewrites that buffer by dirty rectangles and adopts it again at each
  animation frame and at the commit, so the frame is not composited again in full. This is the
  one buffer the cache hands out that is rewritten. Readers therefore: learn that a composite
  changed from the cache's notifications, never from the buffer's identity; copy a buffer they
  keep across an `await`, or wait while a transaction is open; and do not call `get` for the
  stroked frame synchronously inside a notification (the viewport defers to a microtask), or
  the frame is composited in full before the stroke's buffer is adopted again.
- A stroke that changes nothing (§7.1) hands its buffer back to the cache in the same way and
  tells the viewport. It is composited in full only when the cache refuses the buffer, as when
  the commit removes a cel the stroke created.

Reference layers, onion skins, symmetry axes and tiled copies are never part of this composite.

## 6. NGNE integration

Facts below were read from `@ngne/core` 0.2.1 source and contracts and confirmed by the
technical review (REVIEW.md). SE-002 measures the ones marked ⚠ before any ticket builds on them.

### 6.1 Engine surface used

All symbols are exported from the package root.

| API                                                   | Use                                        |
| ----------------------------------------------------- | ------------------------------------------ |
| `WebGPURenderer.create(canvas, w, h, onError)`        | Editing viewport                           |
| `renderer.texture(id, ImageBitmap, signal?)`          | Upload CPU buffers into fixed texture slots |
| `Frame`, `frame.scene(camera, 1)`, `frame.sprite()`   | Build the viewport's quad list             |
| `renderer.render(frame, clear)`, `renderer.status`, `renderer.inspect()` | Draw on demand, observe recovery and memory |
| `BrowserGame`, `SceneDefinition`, `scene.system/render` | Preview panel with fixed-step playback   |
| `Camera`                                              | `pixelSnap = false`                        |

### 6.2 Engine behaviours that shape the design

| #  | Behaviour                                                                 | Consequence                                                        |
| -- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1  | Renderer logical size is fixed at creation; callers own canvas backing size | Recreate the renderer on viewport size change, or use a fixed oversized canvas (SE-002 decides) |
| 2  | `texture()` uploads a whole image asynchronously (bitmap snapshot, new GPU texture, validated copy) | At most one upload per changed slot per animation frame ⚠ latency |
| 3  | A second `texture()` call for an ID rejects the first as superseded       | Single-flight, latest-wins upload queue per slot                   |
| 4  | Manually registered textures cannot be released, only replaced; NGNE retains a bitmap copy per slot | Fixed, bounded slot IDs; unused slots are replaced by a 1×1 image |
| 5  | A frame referencing a texture that is not ready is skipped entirely and reported | Frame builders reference only slots whose first upload resolved |
| 6  | Sampler is nearest, clamp-to-edge; one blend (premultiplied source-over); tint is a multiply | Blend modes, onion tint and smooth reference scaling happen on the CPU |
| 7  | `Frame` rounds sprite **centres** when `camera.pixelSnap` is true (the default) | Viewport and preview disable snapping and place quads from an integer top-left; exported rects are even-sized (§9.2) ⚠ |
| 8  | Clear colour is opaque                                                    | Checkerboard and preview backgrounds are drawn as sprites/rects    |
| 9  | Images are straight alpha, sRGB, decoded without conversion               | Build bitmaps from `ImageData` with `premultiplyAlpha: "none"`     |
| 10 | No texture readback API                                                   | Exports come from the CPU compositor; tests read the canvas back in-page right after a render |
| 11 | `maxTextureDimension2D` is the WebGPU default (8192)                      | Atlas textures are capped at 8192 per side                         |
| 12 | All renderers on one canvas share its WebGPU context; `dispose()` unconfigures it; `create` has no public abort | One canvas element per renderer instance; lifecycle operations are serialized |
| 13 | `render()` is a silent no-op while `status` is `recovering`; NGNE restores manual slots after device loss | Keep the dirty flag until a draw happens with `status === "ready"` |
| 14 | `BrowserGame`: `renderer` is undefined until `start()` resolves; scenes cannot reach the renderer; `start`/`stop` reject while another is pending; `start` attaches input listeners to the canvas; a throw in tick/render fails the game | Host-side upload after start, gated render callback, serialized lifecycle, `pointer-events: none` on the preview canvas, rebuild on failure |

### 6.3 Division of rendering

- **NGNE draws image content**: checkerboard, reference images, composited frames, onion skins,
  tiled-mode copies, and everything in the preview panel.
- **A Canvas2D overlay draws editor chrome**: pixel/tile grid lines, selection marching ants,
  transform handles, brush cursor outline, symmetry axes. It is stacked above the NGNE canvas at
  the same device-pixel size and receives all pointer input.
- The overlay canvas is the second child of the viewport element, a sibling of the element NGNE
  owns. It stops no event and cancels no default; a pointer down with any button but the middle
  one focuses the viewport element.
- Its backing size and box are those of the NGNE canvas on screen, also while NGNE stretches
  its old canvas after a resize (§6.4). It then draws with the mapping NGNE drew with (the
  view, in that canvas's pixels) and maps the pointer through the stretch.
- Draw layers register from their own module (`*.overlay.ts`, found by a glob) with an order:
  stroke echo 50 (§6.6), outline 100, pixel grid 200, tile grid 300, brush cursor 900. A layer
  asks for a redraw through its `watch`.
  The overlay redraws only when the active document, its size or view, the canvas size or the
  theme changes, when the cursor moves to another device pixel or enters or leaves the
  viewport, or when a layer asks; at most once per animation frame.
- A grid line is the first device pixel of every texel (pixel grid) and of every tile (tile
  grid), texel 0 included; the outline is 1 px outside the bounds. Where a tile line runs it
  alone shows. The tile grid is drawn on an axis while a tile is at least 4 device pixels.
- View menu: Show/Hide Grid and Show/Hide Pixel Grid, titled by what choosing them does. They
  change `DocSettings` with no history entry and do not set the dirty flag; no key is bound.

### 6.4 Viewport (`NgneViewport`)

Lifecycle
- Each renderer instance gets its own `<canvas>` element. Creates are serialized (one in
  flight). Replacement order: create on a new canvas, upload every slot, draw once, swap the
  canvases, then dispose the old instance — so the viewport is never blank. A new instance
  whose renderer is not `ready` at the swap is not swapped in: while it is `recovering` the old
  canvas stays until it can draw; when it has `failed` it is disposed and the replacement is
  made again.
- The viewport and its renderer exist only while a document is open; closing the last document
  disposes them. Dispose can therefore come at any moment of a create, an upload or a
  replacement, and ends all three.
- Sizing (decided by SE-002 question 4): canvas backing size = the viewport element's size in
  device pixels (`devicePixelContentBoxSize`); a size or DPR change replaces the renderer
  after 120 ms of quiet, with the old canvas CSS-stretched until the swap. The fixed
  oversized canvas was evaluated and not adopted.
- Rendering is on demand: a dirty flag schedules one `requestAnimationFrame`; an idle editor
  submits no frames. If `renderer.status` is not `ready` at draw time the dirty flag is kept and
  the draw is retried next animation frame. Because NGNE signals neither loss nor recovery, status is also
  read on window focus, on `visibilitychange` and by a 1 s timer while the page is visible
  (reading status submits no frame). Recovery usually completes between two reads (SE-002
  question 8), so each read also compares `renderer.sprites` with the last draw: NGNE zeroes
  it when the device is lost. A transition back to `ready`, or `renderer.sprites === 0` after
  a draw that submitted sprites, marks the view dirty.
  `failed` (also delivered through `onError`) triggers a fresh renderer.

View
- Zoom is the number of device pixels per sprite pixel: 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24,
  32, 48, 64. At these steps texels are square and aligned to device pixels at any DPR. Steps
  1/2, 1/4 and 1/8 exist for overview only; they use nearest minification and are not pixel-exact.
- "100%" means 1 device pixel per sprite pixel.
- View state per document: `scale`, integer `originX`/`originY` (device pixels). The document
  rectangle is `[originX, originY, width × scale, height × scale]`.
- A document whose view was never set is fitted (the largest zoom step at which it lies inside
  the viewport) and centred, in the step that opens it: the viewport region is measured while
  the shell is on the page. Without a size the fit waits for the first one. A view that was
  set is never fitted again.
- Panning and zooming keep `min(32, document side on screen, viewport side)` device pixels of
  the document visible on each axis. A change of the viewport's size and a document becoming
  the active one move the view back inside that limit; they never fit.
- A zoom keeps the document pixel under its anchor: the cursor for the wheel, the centre of
  the viewport for keys and commands. The pan limit wins over the anchor. The wheel zooms one
  step per 50 CSS px of travel, at most one per event; travel short of a step is kept until
  the wheel turns the other way.

Texture slots (IDs are fixed for the life of a renderer)

| Slot             | Content                                              | Uploaded when                      |
| ---------------- | ---------------------------------------------------- | ---------------------------------- |
| `ed:checker`     | Checkerboard at document resolution                  | Size or checker setting changes    |
| `ed:f:0..7`      | Frame cache: composites keyed by `frameId:variant`   | A needed key is absent or stale    |
| `ed:play`        | Atlas of the playing range (editor playback)         | Playback starts                    |
| `ed:ref:0..3`    | Reference images, pre-scaled on the CPU (§7.6)       | Zoom settles, reference changes    |

- The frame cache is LRU. `variant` is `plain`, `before` or `after`; the tinted onion variants
  are tinted on the CPU. The current frame (including a live stroke) and its onion neighbours
  are drawn from whichever slots hold them, so switching to a frame already in the cache needs
  no upload.
- A history step uploads the keys on screen again into their slots, which show the previous
  pixels until then. Every other cached key the step touches is given up and its slot replaced
  by the 1×1 image; a step that changes the structure gives up all of them. While a wanted key
  loads, the frame drawn last stays on screen.
- Editor playback blits the playing range's composites into one grid image for `ed:play` (a
  plain grid local to the viewport, no padding; not the exporter's packer) when it fits
  8192×8192 and 64 MB, and draws UV sub-rectangles; otherwise it steps through the frame
  cache and shows the newest ready frame (frames may be skipped, never queued).

Quad order (NGNE `layer` value): 0 workspace colour · 1 checkerboard · 2 references placed
behind · 3 onion skins behind · 4 current frame · 5 onion skins in front · 6 references placed
in front. Tiled mode draws the current frame slot nine times. The workspace colour is a rect
over the whole canvas, so every frame submits at least one sprite and the `sprites` check of
the lifecycle can always tell a lost device from an empty frame.

Upload queue (one per renderer instance)
- One in-flight upload per slot; a newer request replaces the queued one. An upload starts no
  earlier than the microtask after its request: of several requests made in one task only the
  last is built, and it reads the CPU state after every listener of the change has run.
- The source `ImageBitmap` is closed when its upload settles.
- Rejections with "superseded", an abort, or from a disposed renderer instance are ignored. Any
  other rejection is reported once; the slot is retried only on a fresh renderer. A frame slot
  that failed is left out and its frame moves to another slot; a failed slot with no other to
  move to (`ed:checker`) asks for that fresh renderer, once.
- An image that could not be built (the composite or the bitmap) is reported once and does not
  close the slot: the key is asked for again when it is next needed.
- A disposed queue is not busy and publishes nothing; uploads already in flight settle in the
  background and their bitmaps are still closed.
- Slots that become unused (onion off, reference removed, playback stopped) are replaced by a
  1×1 transparent image.
- A slot keeps showing its previous texture until a replacement is published. Therefore a
  slot's key and the size of its image (and, for `ed:play` and `pv:atlas`, the UV metadata used
  for drawing) change only when the matching upload resolves; frame builders never pair new
  metadata with an old texture. A slot is drawn over the rectangle of the image it holds, so a
  change of the document's size never stretches an old texture.
- Versions (SE-015, for the stroke echo of §6.6): a `ViewportDocument` may give `version(key)`,
  read in the same task as the key's pixels; the version travels with the upload into the slot
  and is reported, with the frame key, for every frame NGNE submits (`NgneViewport` option
  `onDrawn`; `drawnFrame()`, which knows the frame slot's quad only). The app's link
  (`app/viewport/viewportLink`) hands out versions (`nextVersion`, one counter for the page),
  relays `onDrawn`, and holds the checkerboard the viewport was last given
  (`ViewportSources.checker`), so the echo draws the same one.

### 6.5 Preview panel (`NgnePreview`)

- A second canvas owned by a `BrowserGame` (required options `seed`, `state: {}`, identity
  `transition`, `diagnostic`). Logical size = document size. CSS size = `k × size / DPR` with
  integer `k`, so texels map to whole device pixels; `image-rendering: pixelated`;
  `pointer-events: none` so NGNE's input listeners never capture pointer or wheel events.
- Input is **the exporter's own output held in memory**: packed atlas pixels and atlas metadata
  from §9. After `await app.start(prepared)` the host uploads the atlas with
  `app.renderer.texture("pv:atlas", bitmap)` through a single-flight queue. The scene's render
  callback draws nothing until the first upload has resolved.
- The scene sets `scene.camera.pixelSnap = false`. A system advances `ageMs` by
  `dt × 1000 × speed`; the frame is resolved and drawn by the same runtime source that is
  emitted into the generated helper module (§9.5), using its top-left placement
  (`centre = (X + offsetX + w/2, Y + offsetY + h/2)` with `X = Y = 0`), so the source frame's
  top-left is at the canvas origin for odd and even sizes. The preview background is a rect.
- Edits repack in a worker and re-upload after 150 ms of quiet. The worker receives frame
  composites (changed frames only after the first pack) and runs packing and metadata only, not
  the file writers. If the full atlas would exceed
  8192×8192 or 64 MB, only the selected animation is packed; if that also fails the panel shows
  "Too large to preview".
- Lifecycle calls (`start`, `stop`, `dispose`, recreate on document size change) run through one
  serialized queue. The game is stopped while the panel is collapsed, the tab is hidden or no
  document is open. A failed game is disposed and rebuilt on a new canvas.

### 6.6 Performance budgets

Reference hardware: §3. Document 256×256, 8 layers.

| Metric                                                                 | Budget          |
| ---------------------------------------------------------------------- | --------------- |
| Stroke: pointer event to the frame containing it being submitted, p95  | ≤ 33 ms         |
| Dirty-rectangle recomposite for a 16 px brush dab                      | ≤ 2 ms          |
| Frame switch to a frame already in the slot cache: submitted           | next animation frame |
| Frame switch needing an upload: submitted, p95                         | ≤ 50 ms         |
| Editor playback from `ed:play`, 64 frames, 100 ms each                 | no skipped frames |
| Idle editor: frames submitted per second                               | 0               |
| Cold load to interactive (production build, local)                     | ≤ 2 s           |

If the stroke budget is unreachable (SE-002 question 1, or SE-015's measurement), SE-015
implements the fallback: the in-progress stroke is echoed immediately on the Canvas2D overlay
and cleared when the matching upload resolves. SE-002 question 2 recorded isolated pauses
between publishes of 55–110 ms on Intel UHD during a continuous stream of replacements (about
one per second, in the pattern of garbage collection), so SE-015's measurement covers one
continuous stroke of at least 5 s and reports the longest gap beside the p95.

SE-015's measurement missed the budget on RTX 4060 (34.1 ms; Intel UHD 26.2 ms), so the echo is
implemented (`docs/perf`, records `se-015-stroke-latency-*`). It is the draw layer `stroke-echo`,
order 50, under every other layer; its state is in `app/tools/strokeEcho.ts`, fed by the live
composite:

- It draws the live composite's pixels for each region the stroke has composited, over the
  viewport's checkerboard, opaque, nearest-neighbour at the overlay's mapping, in the overlay's
  next redraw after the sample. Opaque and transparent pixels equal NGNE's; a translucent one
  may differ from NGNE's blend by 1 per channel.
- Each composited rectangle is stamped with a version (`viewportLink.nextVersion()`, one counter
  for the page). The viewport reads the version with the pixels of each upload and reports it
  with every frame it submits (`NgneViewport` option `onDrawn`). A region is cleared once a
  frame of its key drawn from that version or a later one has been submitted, which is later
  than "the upload resolved" and never shows the echo and NGNE out of step.
- It is drawn only while NGNE shows the stroke's frame, and not below 1×. Above 16 regions they
  are merged into one. A cancel or an abort clears it at once; after the stroke, any change of
  its frame, another active document or a closed one clears it at once.
- It hides whatever NGNE draws over the composite's place: references and onion skins (quad
  layers 2, 3, 5, 6). SE-025 and SE-045 decide how it gives way to them.
- Development builds switch it with `window.__ngneTest.strokeEcho.enabled`; the benchmark
  measures both ways on one build (`PERF_ECHO=off`). With the echo, a sample's frame is the
  earlier of NGNE's submit and the end of the overlay draw that showed it.

### 6.7 Tests against WebGPU canvases

- Image-content assertions read the canvas back in the page (`drawImage(canvas)` to a 2D canvas
  and `getImageData`, in the same task as the render; for `BrowserGame`, in `afterFrame`), as
  NGNE's own tests do. This is backing-resolution and independent of DPR and colour profile.
- Screenshots are used only where overlay and NGNE canvas alignment matters.
- Chrome is launched with NGNE's SwiftShader flags in CI and `--force-color-profile=srgb`.
- A test at a device pixel ratio other than 1 starts Chrome with
  `--force-device-scale-factor=<ratio>` and sets the context's `deviceScaleFactor`;
  `devicePixelContentBoxSize` follows the browser's own scale (SE-002 finding 7.1). Launch
  options belong to the worker, so such tests have their own spec file.
- A test that counts animation frames has `@alone` in its title: it runs after every other
  test has finished, because beside other workers its frames come late and the count is wrong.
- Pointer tests run at the ratios 1, 1.1, 1.25 and 1.5: at 1.25 Chrome reports a mouse
  position just short of its device pixel, and at 1.1 the viewport element starts between
  two device pixels.

### 6.8 Engine gaps and workarounds

Recorded for the engine owner; none is required for v1.

| Gap in NGNE 0.2.1                           | Workaround here                             |
| ------------------------------------------- | ------------------------------------------- |
| No release for manual textures              | Fixed slot pool, 1×1 placeholders           |
| No partial or synchronous texture update    | Whole-slot upload, single-flight queue      |
| No blend modes or non-multiply tint         | CPU compositor, CPU onion tint              |
| Fixed renderer size, no public create abort | Recreate on a new canvas, serialized        |
| No repeat addressing, no linear filtering   | Checker texture; CPU pre-scaled references  |
| No camera zoom                              | Scale sprite sizes when building frames     |
| No readback                                 | CPU export; in-page canvas readback in tests |
| Centre snapping misaligns odd-sized sprites | Even-sized export rects; snap off in editor |
| No recovery event                           | Poll `status` on draw, focus, visibility and the `sprites` counter |

## 7. Editor behaviour

### 7.1 Tools

Shared options: brush size 1–64, brush shape (square, circle), pixel-perfect, ink (simple,
alpha compositing, lock alpha), opacity. Left button paints foreground, right button background;
the canvas has no context menu. Strokes interpolate between pointer samples (coalesced events)
with Bresenham lines.

| Tool            | Behaviour                                                              |
| --------------- | ---------------------------------------------------------------------- |
| Pencil          | Freehand; pixel-perfect removes L-shaped corners                       |
| Eraser          | Writes transparent; right button erases to background colour           |
| Eyedropper      | Samples composite or active layer; left sets FG, right sets BG         |
| Paint bucket    | Flood fill; contiguous toggle; tolerance 0–255; samples layer or composite |
| Line            | Shift constrains to 45° steps                                          |
| Rectangle       | Outline or filled; Shift = square; Ctrl = from centre                  |
| Ellipse         | Outline or filled; Shift = circle; Ctrl = from centre                  |
| Rect / ellipse marquee | Shift add, Alt subtract, Shift+Alt intersect                    |
| Lasso           | Freehand selection                                                     |
| Polygon lasso   | Click vertices; Enter or double-click closes                           |
| Magic wand      | Tolerance, contiguous                                                  |
| Move            | Moves selection content or, with no selection, the active cel          |
| Hand            | Pan                                                                    |
| Zoom            | Click in, Alt-click out                                                |

A locked or hidden layer, or a reference layer, rejects paint with a status-bar message.
Paint is clipped to the selection when one exists. Keys are in §7.8.

Tool framework (SE-014):

- A tool is a module `*.tools.ts`, found by a glob. The 13 rail slots of DESIGN §5.1 are
  planned with their key and icon; a registered tool with a slot's id takes the slot, and an
  unclaimed slot is a disabled button. Each tool gets a key command `tool.<id>` in the `canvas`
  context and, when it can be held, `tool.<id>.hold`.
- Paint tools do not paint below 1× (the overview steps of §6.4): the press is refused with
  "Zoom in to 1× or more to paint", because NGNE's sampling decides which texel a device pixel
  shows there. A stroke under way is not cut off by a zoom. Other tools work at every step.
- During NGNE's resize quiet (§6.4) a stroke uses the texel shown under the pointer, which the
  overlay's mapping names (§6.3); the status-bar readout may name its neighbour for that time.
- One stroke at a time; left paints the foreground, right the background; the middle button is
  navigation's. The overlay captures the pointer and passes every coalesced sample. A stroke
  ends at the release, or at a move whose buttons no longer include its button. It is cancelled
  by `pointercancel`, a lost capture, Escape, the active document closing or changing, or a
  tool that throws; a cancelled stroke restores the pixels and records nothing. A stroke that
  changes nothing records nothing. The tool chosen at the press keeps the stroke.
- Holding a key (Space → Hand) changes the active tool, not the selected one, and returns to it
  on release. A held key acts where the keymap gives it to the `canvas` context: a key that
  controls consume natively (Space) only while the viewport element has the focus, so the
  palette lists its hold disabled; any other (Alt) whatever control has the focus (SE-016). The
  palette lists such a hold enabled and runs it with its release at once, which leaves the
  active tool as it was; hold commands stay in the palette and on the shortcut sheet.
- Tool options are stored per tool id; an invalid stored value reads as the nearest valid one or
  the default. The context bar shows the active tool's name and its options in order.
- Refusal messages ("Layer is locked", "Layer is hidden", "Reference layers cannot be painted
  on", the zoom message above) clear at the next press or after 4 s, and never clear a message
  set by someone else.
- A tool may have `onCommit(context, recorded)`, called once a stroke it ended at the release
  is kept: committed (`recorded`) or with no change. Not after a cancel or an abort (SE-015).
- A stroke's history entry keeps the bounding rectangle of the pixels whose bytes differ from
  the stroke's start (from transparent for a cel the stroke created). When none differs, for
  example a pixel-perfect corner taken back or a Shift line dragged back over itself, the
  stroke records nothing and a cel it created is not kept.

Pencil and eraser (SE-015):

- Brush size, shape, pixel-perfect, ink and opacity are one set of option specs
  (`app/tools/brush/brushOptions.ts`) that every brush tool lists, the shape tools included.
  Their values are stored per tool id, as in Aseprite (the eraser keeps its own size). Defaults:
  size 1, circle, pixel-perfect off, simple ink, opacity 255 (range 0–255). The eraser has no
  ink option.
- A brush is placed at −⌊size/2⌋ from the texel under the pointer, so an even brush has that
  texel at the lower right of its centre. The circle brush is the filled ellipse (Zingl's
  algorithm) that fits the size × size square, as Aseprite draws it.
- Inks compute each pixel from its value at the stroke's start, so a stroke never builds up
  over itself. Simple replaces the pixel with the colour, its alpha multiplied by the opacity
  (at opacity 0 it writes transparent). Alpha compositing is the compositor's normal blend at
  the opacity. Lock alpha is that blend with the pixel's own alpha kept; a transparent pixel
  stays as it was. A result with alpha 0 is written as 0,0,0,0.
- Eraser: the left button lowers alpha by alpha × opacity, so 255 clears; the right button
  composites the background colour at the opacity (a transparent background changes nothing).
- Pixel-perfect is Aseprite's rule applied as the stroke goes: the newest pixel shows at once
  and is taken back when the next one makes it a corner; a pixel another stamp still covers
  stays.
- Shift at the press draws a straight line that follows the pointer until the release, from the
  end of the last pencil or eraser stroke kept on that document (`onCommit`), or from the press
  point when there is none. Shift pressed during a stroke does nothing.
- The brush cursor is the overlay draw layer `brush-cursor` (order 900): a two-tone outline of
  the footprint, 1 device pixel black just outside it and 1 device pixel white outside that,
  with the footprint left clear (DESIGN §6). A paint tool that draws a brush outline hides the
  system cursor over the document only; elsewhere over the viewport the cursor is a crosshair.
- Pencil and eraser show the hint "Shift: straight line from the end of the last stroke" in
  the status bar.

Colours and eyedropper (SE-016):

- The foreground and background are RGBA colours of the editor state, opaque black and opaque
  white at start and after "Reset Colours" (a command with no key, and the button beside the
  rail's chips). X swaps them in the `canvas` context. For each colour the editor also keeps
  the HSV the colour panel edits: its RGB is always the colour's, and it keeps the hue of a
  grey and the hue and saturation of black, so dragging to the edge of the saturation/value
  field and back does not lose the hue. A colour set as RGB (eyedropper, palette, hex or RGB
  fields) takes its HSV from the RGB with what the RGB leaves open kept.
- `core/color` converts sRGB8 ↔ HSV (hue 0–360°, saturation and value 0–1, exact inverses on
  8-bit values) and hex text ↔ 0xRRGGBBAA (3, 4, 6 or 8 digits, `#` optional; without alpha
  digits the colour is opaque; written "#RRGGBB" when opaque, "#RRGGBBAA" otherwise).
- Eyedropper: the press and every sample of the drag that follows take the colour of the
  document pixel under the pointer, exactly as stored: left into the foreground, right into
  the background; outside the document nothing changes. Option Sample: Composite (default) is
  the active frame as the composite cache holds it (visible pixel layers blended; reference
  layers and onion skin are not in it); Active layer is the active layer's cel as stored (cel
  and layer opacity not applied; an empty cel is transparent, 0,0,0,0; a reference layer gives
  nothing). It writes no pixels and records nothing, so it works at every zoom step. Below 1×
  it takes the texel the pointer names (`clientToDoc`, the first texel of the device pixel at
  a whole device position), which may be a neighbour of the texel NGNE shows there, never a
  blend.
- Alt holds the eyedropper while the selected tool paints (`paints`); from other tools Alt
  keeps its own meaning (the zoom tool's Alt-click).
- The colour panel and the palette grid take the right button as the background: held in the
  panel's field or strips it edits the background, and the panel shows the background until
  the release; a right press on a swatch sets it. The context menu that follows such a press
  is cancelled wherever it comes up, as for a right-button stroke.

Shape tools and paint bucket (SE-017):

- Line, rectangle and ellipse are rubber bands drawn into the stroke's transaction
  (`core/raster/shapeStroke.ts`). The press fixes the first point and keeps a copy of the image;
  every pointer sample, and every press or release of Shift or Ctrl while the button is held,
  draws the whole shape again: the pixels the previous shape covered and the new one does not
  get their value at the press back, and are reported dirty with the new ones, so the live
  composite and the stroke echo clear them. Each covered pixel is inked once, from its value at
  the press. The release keeps the shape drawn last: the preview is the result. Escape takes it
  back; a shape that changes nothing (over pixels of its own colour, or off the document) records
  nothing.
- The brush (size and shape, placed as for the pencil) is stamped at every pixel of the outline:
  the Bresenham line, the four sides of the rectangle (both corners included), the ellipse's
  outline. Filled covers every pixel inside the outline as well, the outline still stamped, so a
  filled shape covers what its outline does and its inside.
- The ellipse fits the rectangle of its corners exactly, odd and even sides alike: Zingl's
  `plotEllipseRect` with the tips finished while y0 − y1 ≤ b, a midpoint algorithm on the
  corners (`core/raster/ellipse.ts`). Its filled form is the selection's ellipse mask of §7.2,
  so the ellipse tool and the elliptical marquee cover one shape; for a square it is the circle
  brush. Aseprite's ellipse is the same algorithm with extra straight pixels for some sizes,
  which this editor does not add.
- Shift: a line's end snaps to the nearest of the eight 45° directions (an axis when the drag
  lies within 22.5° of it, otherwise the diagonal as long as the drag's larger side); a
  rectangle or an ellipse becomes a square or a circle as large as the drag's larger side,
  towards the pointer. Ctrl: from the centre — the press is the shape's centre, which reaches as
  far on its other side (odd sides only); a line extends as far the other way. Both may change
  while the button is held. The hints: "Shift: 45° steps · Ctrl: from the centre", "Shift:
  square · …", "Shift: circle · …".
- Options, values per tool id as for the brush tools: line — size, shape, ink, opacity;
  rectangle and ellipse — size, shape, Filled (off by default), ink, opacity. No pixel-perfect.
  Listing size and shape gives them the brush cursor.
- Paint bucket: the press fills the area of the pixel under the pointer with the button's
  colour in the chosen ink and opacity; the drag after it does nothing more, and a press outside
  the document fills nothing. Options in order: Contiguous (on), Sample (Active layer by default,
  or Composite), Tolerance (0–255, 0 by default), ink, opacity. Active layer samples the active
  cel as the stroke found it (an empty cel is transparent); Composite samples the frame's
  composite as the cache holds it. The bucket draws no brush outline: its cursor is a crosshair
  over the whole viewport, the document included.
- Flood fill (`core/raster/flood.ts`) returns a 1-bit mask of the source's size, which the magic
  wand makes a selection (§7.2). A pixel matches the seed when both are transparent (alpha 0,
  whatever their RGB) or when each of the four channels differs by at most the tolerance: 0 is
  the exact colour, 255 every pixel (Aseprite's `color_equal_32`, checked against its source).
  Contiguous takes the matching pixels joined to the seed by their edges (4-connected), by a
  scanline fill with an explicit stack of spans, never recursion; otherwise every matching
  pixel. With a selection the fill neither takes nor crosses an unselected pixel, as Aseprite's
  contiguous fill does; the transaction's clip keeps every other pixel.

### 7.2 Selection

- A selection is a 1-bit mask plus bounds in the `DocSession`. Changing it is undoable.
- Moving or transforming selected pixels lifts them into a floating selection (§5.2); Enter or a
  click outside applies, Escape cancels.
- Clipboard: internal buffer always; system clipboard `image/png` when permitted. Paste creates
  a floating selection at the viewport centre.
- Transforms use nearest-neighbour sampling. Pixels moved off the canvas are clipped on apply.

Selection model (SE-030):

- `core/selection` holds the masks and the operations set (replace), add, subtract,
  intersect, invert, all and none. A selection is a value: an operation or a command puts a
  new `Selection` in the session and never changes the one there, so a transaction's clip and
  undo keep the very mask they were given. An operation that leaves no pixel selected gives no
  selection (`null`), never an empty mask.
- Selection changes are commands labelled with their menu titles ("Select All", "Deselect",
  "Invert Selection"; a tool gives its own label). They touch no composite (`touched` is
  empty). A change that would leave the same pixels selected makes no command and records
  nothing, as a stroke that changes nothing (§7.1). While a transaction is open they are
  disabled, as undo and redo are.
- A selection change is a history step like any other: it moves the history position, so it
  makes the document dirty (§5.2), and the close confirmation and autosave treat it as a
  change.
- Invert with no selection selects every pixel; inverting a selection of every pixel leaves
  none.
- Shape masks, clipped to the canvas: a rectangle; the filled ellipse that fits a rectangle
  (after Zingl's `plotEllipseRect`, with the tips finished while y0 − y1 ≤ b, which for a
  square gives the circle brush of §7.1); a polygon as its outline (the Bresenham line of each
  side, the last vertex joined to the first; only the part on the canvas is walked) and the
  pixels whose centres lie inside it by the even-odd rule; fewer than 3 vertices enclose
  nothing, and a vertex must be a whole number within 2^24 of 0. A flood mask, or any mask of
  the document's size, becomes a selection with its bounds as it is.
- The boundary for drawing is a list of axis-aligned edge segments on the document's grid
  lines, each a maximal run with the selected side on one hand, and the outer corners (grid
  points with exactly one of their four pixels selected); the canvas edge counts as boundary.
  The ants are drawn from it (DESIGN §6).
- Paint is clipped where the pointer pipeline begins a paint stroke: the selection's mask is
  the transaction's clip (§5.2), so a pixel outside it gets its value at `begin` back at each
  report, before the live composite and the stroke echo read it. Of each reported rectangle
  only the part within the selection's bounds is composited and echoed: outside them nothing
  changed, and the opaque echo would hide onion skins and references there.

### 7.3 Layers

Add, delete, duplicate, rename, reorder (drag), visibility, lock, opacity, merge down, flatten.
The last pixel layer cannot be deleted. Merge down and flatten bake opacity and blend mode.

### 7.4 Frames, cels and tags

- New frame: empty or a duplicate of the current frame (Aseprite default: duplicate).
- Linked cels share one image; editing either edits both. "Unlink" copies the image.
- Durations are per frame, 1–65535 ms, editable for a multi-frame selection.
- Tag expansion (used by editor playback and export): for frames `a b c d`, forward is
  `a b c d`, reverse is `d c b a`, ping-pong is `a b c d c b` (for one frame: `a`; for two:
  `a b`). `repeat = n > 0` writes the sequence n times; `repeat = 0` loops forever.
- Tags may overlap. The **active tag** at a frame is the tag with the shortest range containing
  that frame; ties go to the tag created last.

### 7.5 Playback and onion skin

- Editor playback steps the active frame in the viewport by elapsed visible time. It plays the
  active tag at the playhead, or all frames forward when there is none. A tag with
  `repeat = n > 0` plays n times and stops on its last entry; otherwise playback loops. Speed
  0.25×–4×. Onion skin is hidden while playing.
- Onion skin: 0–3 frames before and after, base opacity with per-step falloff, optional tint
  (red before, blue after; 50% blend toward the tint colour, done on the CPU), placement behind
  or in front, optionally limited to the active tag's range.

### 7.6 Reference layers (C3)

- Created by Layer → New Reference Layer from File, by dropping a PNG and choosing "Add as
  reference", or by "keep source as reference" in a single-sprite quantize import (§8).
- Default placement **behind** all pixel layers; fitted and centred to the canvas; opacity 50%.
- Editable properties: position, uniform scale, opacity, visibility, lock, placement
  (behind/front). Never painted on, never exported, never part of the CPU composite. Every
  change is undoable.
- Decoding uses the same lossless PNG path as import (§8), so colours match. For display the
  decoded source is first limited to 4096 px per side (one-off high-quality downscale); the
  original bytes are kept in the project file.
- Display quality: NGNE samples nearest, so 100 ms after zoom settles the editor resamples the
  display source on the CPU to its on-screen device-pixel size (`createImageBitmap` with
  `resizeQuality: "high"`, `premultiplyAlpha: "premultiply"`, `colorSpaceConversion: "none"`).
  When that size exceeds the display source, the display source is uploaded as is and NGNE
  magnifies it with nearest sampling. Total reference texels across the four slots are limited
  to 16 MP; larger requests are scaled down proportionally.
- Sprite operations: canvas size, crop, trim and sprite size adjust `x`, `y` and `scale` so the
  reference stays over the same content. Flip and rotate canvas leave reference layers untouched.

### 7.7 Sprite operations

Canvas size (anchor), sprite size (nearest or area average; all cels), crop to selection, trim,
rotate canvas 90/180, flip canvas. Each is one undoable command over every cel and clears the
selection. Sprite properties (name, pivot, grid) are edited in one dialog; pivot has a 3×3
preset grid and numeric fields.

### 7.8 Keyboard

Contexts, highest priority first. A key is resolved in the first context that both applies and
binds it.

| Context    | Applies when                                              |
| ---------- | --------------------------------------------------------- |
| `text`     | A text or number field has focus. The field handles typing, Enter, Escape, arrows, Tab and Ctrl+Z/Y/A/X/C/V; of the bindings below only the Ctrl/Alt/F-key chords marked † still act |
| `gesture`  | A multi-click tool gesture is in progress (polygon lasso, curve) |
| `floating` | A floating selection exists                               |
| `timeline` | Focus is inside the timeline panel (a click in the timeline keeps focus there) |
| `canvas`   | Focus is on the viewport or on any non-text control, with no menu, dialog or popover open. Inside the timeline it is the fallback for keys `timeline` does not bind, so tool keys keep working |
| `global`   | Always, except while a menu, dialog or popover is open (those handle their own keys) |

Focus rules that make `canvas` the normal state:

- Activating a non-text control outside the timeline with the pointer (tool button, swatch,
  toggle, splitter) returns focus to the viewport afterwards. Keyboard activation leaves focus
  where it is.
- Keys a focused control consumes natively (Enter, Space, arrows, Home, End, Tab, Escape, and
  letters for typeahead in a select) go to that control first; in the timeline a focused button
  takes Enter and Space, a focused cell leaves Enter to play/pause.
- Bound chords that do not act in the current context (for example Ctrl+D or F3 while a text
  field has focus) still have their browser default suppressed. The `canvas` bindings for those keys therefore act only while the viewport
  itself is focused; letter, digit and modified chords act throughout the `canvas` context.
- Wheel and middle-drag bindings apply by pointer location (over the viewport), not by focus.

| Key                         | Context    | Action                                             |
| --------------------------- | ---------- | -------------------------------------------------- |
| B, E, I, G                  | canvas     | Pencil, eraser, eyedropper, bucket                 |
| L, U, Shift+U               | canvas     | Line, rectangle, ellipse                           |
| M, Shift+M, Q, Shift+Q, W   | canvas     | Rect marquee, ellipse marquee, lasso, polygon lasso, wand |
| V, H, Z                     | canvas     | Move, hand, zoom                                   |
| Shift+L, D, Shift+D, Shift+B | canvas    | Curve, contour, polygon, spray (SE-065)            |
| Alt (hold)                  | canvas     | Temporary eyedropper while a paint tool is active  |
| Space (hold)                | canvas     | Temporary hand                                     |
| X                           | canvas     | Swap FG/BG                                         |
| Wheel                       | pointer over viewport | Zoom about the cursor (Ctrl+wheel the same) |
| Shift+wheel                 | pointer over viewport | Pan horizontally                        |
| Middle-drag                 | pointer over viewport | Pan                                     |
| 1, 2, 3, 4, 5, 6            | canvas     | Zoom 1×, 2×, 4×, 8×, 16×, 32×                      |
| 0                           | canvas     | Fit and centre                                     |
| Enter                       | gesture    | Close the gesture                                  |
| Enter / Escape              | floating   | Apply / cancel the floating selection              |
| Arrows, Shift+arrows        | floating   | Nudge 1 px / 8 px                                  |
| Arrows, Shift+arrows        | canvas, with a selection | Lift and nudge 1 px / 8 px           |
| ← →                         | canvas (viewport focused), no selection | Previous / next frame |
| ← → ↑ ↓, Home, End          | timeline   | Move the active cell; first / last frame           |
| Enter                       | canvas, timeline | Play / pause                                 |
| Escape                      | canvas     | Cancel the stroke or gesture                       |
| Tab                         | canvas (viewport focused) | Toggle the timeline (elsewhere Tab moves focus) |
| F6 / Shift+F6 †             | global     | Move focus to the next / previous region           |
| Alt+N, Alt+B                | global     | New frame (duplicate), new empty frame             |
| Shift+N                     | global     | New layer                                          |
| F3                          | global     | Toggle onion skin                                  |
| Ctrl+Z; Ctrl+Y, Ctrl+Shift+Z | global    | Undo; redo                                         |
| Ctrl+A, Ctrl+D, Ctrl+I      | global     | Select all, deselect, invert selection             |
| Ctrl+X, Ctrl+C, Ctrl+V, Delete | global  | Cut, copy, paste, delete selection content         |
| Ctrl+S †, Ctrl+Shift+S †, Ctrl+O † | global | Save, save as, open                             |
| Ctrl+Alt+N †, Alt+W †       | global     | New sprite, close document (Ctrl+N and Ctrl+W are browser-reserved) |
| Ctrl+E †, Ctrl+Shift+E †    | global     | Export dialog, export again                        |
| Ctrl+K †                    | global     | Command palette                                    |
| ?                           | canvas     | Shortcut sheet                                     |

- † also acts while a text field has focus.
- Differences from Aseprite forced by the browser: invert selection is Ctrl+I (Ctrl+Shift+I
  opens DevTools); new sprite and close use the alternates above; D is the contour tool, so
  reset colours has no default key.
- SE-007 verifies in Chrome that every chord above reaches the page; any that cannot be
  intercepted gets an alternate recorded here.

## 8. PNG import and quantization (C2)

Entry points: File → Import PNG, drag-and-drop onto the window, and paste while no document is
open (with a document open, paste creates a floating selection, §7.2). One dialog, live
before/after preview, deterministic output for identical inputs and settings.

Pipeline, in order:

| Step        | Options                                                                                   | Default            |
| ----------- | ----------------------------------------------------------------------------------------- | ------------------ |
| 1 Decode    | PNG to straight RGBA8 with the `core/png` decoder (asynchronous, no premultiplication)    | —                  |
| 2 Region    | Whole image or crop rectangle                                                             | Whole image        |
| 3 Cells     | Single sprite; grid (cell W×H or columns×rows, offset, spacing, skip empty); one cell per file | Single sprite |
| 4 Size      | **Target sprite size W×H**; fit: stretch, contain, cover                                  | Document size or 32×32; contain |
| 5 Resample  | Nearest, area average, dominant colour per block                                          | Area average       |
| 6 Alpha     | Keep, or threshold 1–255 to binary; optional colour key with tolerance                    | Smart (below)      |
| 7 Colours   | Keep; reduce to N (2–256); map to the document palette or a preset palette                | Smart (below)      |
| 8 Dither    | None, ordered (Bayer 4×4), Floyd–Steinberg                                                | None               |
| 9 Place     | New document; new frames in current document; new layer; plus "keep source as reference"  | New document       |

Rules:

- Several PNG files may be selected or dropped at once: each file is one cell, ordered by
  natural filename order; grid slicing then does not apply, and a crop rectangle applies to
  every file.
- Step 3 yields N cells in row-major order; each becomes one frame.
- Step 4 is the "specified size": every cell is resampled to exactly W×H. When a cell already
  has that size, step 5 is skipped.
- The colour key of step 6 is applied to each cell before step 5, so the key colour is never
  averaged into the pixels beside it; the threshold of step 6 is applied after step 5.
- Smart defaults: if the cells already have binary alpha and no resampling is needed, step 6
  defaults to Keep, otherwise threshold 128 (averaging makes hard edges soft). If the cells use
  at most 256 distinct colours and no resampling is needed, step 7 defaults to Keep, otherwise
  Reduce to 16.
- Step 7 "reduce" builds **one palette across all cells** (median cut, then 8 fixed k-means
  iterations seeded from the median-cut result). Colour distance is OKLab. The resulting palette
  can replace, extend or leave the document palette. With "keep" that palette is the frames' own
  colours (reduced to 256 when there are more, the frames unchanged); with "map" it is the
  palette mapped to.
- Placing into an existing document requires the target size to equal the document size.
- "Keep source as reference" is available for single-sprite imports only. It adds a reference
  layer positioned and scaled so the cropped region overlays the pixels it was fitted to (the
  whole canvas when the aspect ratios match). A reference layer has one scale for both axes, so
  with fit "stretch" and a different aspect ratio it is placed as "contain" places it.
- Limits: source up to 8192×8192 per file (the decoder refuses a larger image before
  allocating it: `PngError` code `size`); at most 1024 resulting frames; resulting pixel data
  (frames × W × H × 4) at most 256 MB; clear typed error otherwise.
- Decoder (SE-005): `fast-png` 8.0.0 cannot read interlaced images below 8 bits per sample and
  returns a zero-padded buffer for image data cut short, so `decodePng` is the project's own
  decoder over `DecompressionStream` and returns a promise. `encodePng` uses `fast-png`.

## 9. NGNE asset export (C1)

NGNE defines no engine-level asset format; consumers own theirs (three sibling games use three
shapes). "NGNE-ready" therefore means the bundle below, which uses only NGNE's public API and
the `ngne-preview` adapter schema, plus an optional Aseprite-format JSON for pipelines that
already read that shape.

### 9.1 Bundle

| File                         | Purpose                                                            | Optional |
| ---------------------------- | ------------------------------------------------------------------ | -------- |
| `<name>.png`                 | Atlas: RGBA8, straight alpha, sRGB, no colour-profile chunks       | no       |
| `<name>.atlas.json`          | Frames and animations (§9.2), engine-agnostic data                 | no       |
| `<name>.sprites.ts`          | Typed helper: `imageAsset` definition, draw and animation lookup   | yes, default on |
| `<name>.preview.config.mjs`  | Ready for `ngne-preview ./<name>.preview.config.mjs`               | yes, default on |
| `<name>.aseprite.json`       | Aseprite sprite-sheet JSON (array or hash) for the same PNG (§9.5) | yes, default off |

`<name>` is the document name slugified to `[a-z0-9][a-z0-9-]*` (other characters become `-`,
runs collapse, edges trimmed). An empty result becomes `sprite`. Only the letters A–Z are
lowercased (no Unicode case mapping), the slug is cut to 64 characters, and a slug that is a
device name of Windows (`con`, `nul`, `com1`, …) gets `-sprite` appended, since no file can
have such a name there.

### 9.2 `ngne-sprite-atlas` version 1

```json
{
    "format": "ngne-sprite-atlas",
    "version": 1,
    "generator": "ngne-sprite-editor 1.0.0",
    "image": "hero.png",
    "width": 67,
    "height": 67,
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
            "durationMs": 400,
            "entries": [{ "frame": "hero-0", "ms": 100 }]
        }
    }
}
```

- `x, y, w, h`: atlas rectangle in pixels, top-left origin, never rotated. **`w` and `h` are
  always even**: odd rectangles are padded with one transparent column/row on the right/bottom.
  This keeps quads pixel-aligned under NGNE's default centre snapping (§6.2 #7).
- `sourceW, sourceH`: untrimmed frame size (the document size, may be odd).
  `offsetX, offsetY`: where the rectangle's top-left sits inside the source frame. Because of
  the even padding a rectangle may extend one pixel past the source frame
  (`offsetX + w = sourceW + 1`); the content size is `min(w, sourceW − offsetX)` by
  `min(h, sourceH − offsetY)`. Extrusion does not apply to a padded side.
- `pivot`: normalized within the **source** frame.
- `animations[*].playback` is `"loop"` or `"once"`; `entries[*].ms` is a positive integer;
  `durationMs` is the sum of entry durations.
- Frame and animation IDs match `[a-z0-9][a-z0-9_-]*`, are at most 80 characters long and are
  unique case-insensitively.
- Fully transparent pixels are written as `0,0,0,0`. Output is byte-deterministic.
- Limits: 65 536 frames; 65 536 animation entries in all; `ms` at most 65 535.
- [FORMAT.md](FORMAT.md) §2 specifies the file: every member with its range, what a reader
  may rely on and what only this writer guarantees. A reader ignores members it does not know,
  as NGNE's readers do. `validateAtlas` is that reader.

Drawing a frame at anchor `A` with rotation `θ`, uniform scale `s` and flips `fx, fy ∈ {1, −1}`:

```text
d      = (offsetX + w/2 − pivot[0]·sourceW,  offsetY + h/2 − pivot[1]·sourceH)
centre = A + R(θ) · (fx·s·d.x, fy·s·d.y)
size   = (fx·s·w, fy·s·h)          // NGNE mirrors a quad with negative size
uv     = (x/width, y/height, w/width, h/height)
```

For `θ = 0` and integer `s`, the helper rounds `s·d` to integers (before applying the flip
sign), so a quad at an integer anchor has integer edges under both snapping modes. Rounding
applies only at exactly `θ = 0`; rotated sprites use the unrounded value (a difference of at
most half a pixel). A quarter turn is exact: a `sin θ` or `cos θ` less than 1e-12 from 0 is
taken as 0 and the other as ±1. `Math.sin(Math.PI)` is 1.2e-16, and what it adds to a centre
ending in .5 has the sign of the frame's offset, so NGNE's centre snapping would round the
frames of one trimmed sheet apart. For an untrimmed frame of even size this is the maths in
NGNE's `demo/sprites.ts`, equal to the last bit for a centre pivot. The runtime also offers
top-left placement
(`centre = (X + offsetX + w/2, Y + offsetY + h/2)`) for callers that position by the source
frame's corner.

### 9.3 Mapping from the document

- Frame IDs: `<name>-<index>`, zero-based, in frame order.
- Each tag becomes an animation named by the slugified tag name, expanded per §7.4.
  `repeat = 0` → `"loop"`; `repeat = n` → `"once"` with the sequence written n times: NGNE's
  animation data is a list of entries that loops or plays once, without a repeat count. An
  export whose animations would hold more than 65 536 entries together is refused with a typed
  error that names the count, before any entry is written out.
- Frames outside every tag are still exported as frames. A multi-frame document with no tags
  gets one `"loop"` animation named `<name>` covering all frames.
- Duplicate tag slugs get `-2`, `-3` suffixes; the dialog shows the final IDs. A tag whose name
  leaves an empty slug is named `tag`.
- `exportSettings.frames = { tagId }` exports only that tag's frames and animation; frame IDs
  keep their document indices, and the animation keeps the ID it has in the full export.

### 9.4 Packing

- Layout: uniform grid, near-square by default (`⌈√r⌉` columns for `r` rectangles); or single
  row / single column. Rectangles fill the grid row by row in frame order. Cell size is the
  largest rectangle; a smaller one sits at the top-left of its cell. Atlas side =
  `n × (cell + padding + 2·extrude) + padding`; the rectangle of cell `i` starts at
  `padding + extrude + i × (cell + padding + 2·extrude)`.
- Options: padding 0–8 px (default 1), extrude 0–2 px (default 0), trim transparent borders
  (default off; a fully transparent frame keeps a 2×2 rectangle at offset 0,0), merge identical
  frames (default on; merged IDs share one rectangle).
- Atlas side limit 8192 px. With padding 1 that is 49 frames at 1024², 961 at 256², 15 876 at
  64². Exceeding it is an export error naming the limit and the required size.
- Packing is deterministic for identical documents and settings.

### 9.5 Generated modules

Identifiers derive from `<name>`: camelCase of the slug, prefixed with `sprite` when it starts
with a digit (`hero-walk` → `heroWalk`, `2d-hero` → `sprite2dHero`); `<Name>` is its PascalCase.

`<name>.sprites.ts` is self-contained (atlas data inlined `as const`; only `@ngne/core`
imported) and exports:

- `<name>Image`: `imageAsset("<name>", new URL("./<name>.png", import.meta.url).href)`.
- `<name>Atlas`: the content of `<name>.atlas.json`, and the types `<Name>FrameId` and
  `<Name>AnimationId` of its IDs.
- `draw<Name>(frame, id, x, y, options?)`: applies §9.2 and calls `frame.sprite`. Options:
  `rotation`, `scale`, `flipX`, `flipY`, `layer`, `depth`, `alpha`, `color`, `screen`.
- `draw<Name>TopLeft(frame, id, x, y, options?)`: the top-left placement of §9.2; the options
  work about that corner.
- `<name>AnimationFrame(animation, ageMs)`: the frame ID at that age; start-inclusive,
  end-exclusive intervals; for `"once"` the last entry after the end.
- `<name>AnimationDone(animation, ageMs)`: true for `"once"` animations at or after `durationMs`.

The runtime part of that module lives in one source file in this repository. It is imported as
code by the preview panel and tests and as raw text (`?raw`) by the generator; it is never
produced with `Function#toString()`. It is written against a structural "sprite sink" type
(anything with NGNE's `sprite()` method) so it stays inside `core/` without importing the
engine; the generator adds the `@ngne/core` import lines to the emitted file. The generated file compiles under the NGNE consumer
settings plus `strict`, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUnusedLocals`
and `noUnusedParameters`.

`<name>.preview.config.mjs` default-exports the `ngne-preview` adapter object:

```js
export default {
    images: [{ id: "hero", src: new URL("./hero.png", import.meta.url) }],
    frames: [{ id: "hero-0", image: "hero", x: 1, y: 1, width: 32, height: 32,
               destinationWidth: 32, destinationHeight: 32 }],
    animations: [{ id: "walk", playback: "loop", entries: [{ frame: "hero-0", ms: 100 }] }],
    display: { density: 1, scale: 1, pixelSnap: true },
};
```

`images[].src` must be a `file:` URL object (relative strings are rejected by `ngne-preview`);
`frames` and `animations` are arrays; even rectangles keep the preview stage pixel-aligned.
A frame's `width`, `height` and destination size are the even `w` and `h` of its rectangle.
The adapter has no offset, so `ngne-preview` centres a trimmed frame on its rectangle.

`<name>.aseprite.json` follows Aseprite's sprite-sheet data: per frame `filename` (the frame
ID; in the hash form the member name), `frame` (atlas `x, y` and the content size of §9.2),
`rotated: false`, `trimmed`, `spriteSourceSize` (`offsetX, offsetY` and the content size),
`sourceSize` (`sourceW, sourceH`) and `duration`; `meta` holds `app`, `version`, `image`,
`format`, `size`, `scale` and `frameTags` (name, from, to, direction, repeat, color). A frame
tag is named by its animation ID; `from` and `to` are positions in the file's frame list; as in
Aseprite, `repeat` is a string and is left out for a tag that plays without end. The
even-size padding of §9.2 is not visible in this file where it lies past the source frame: a
33×17 frame is 33×17. A trimmed rectangle of odd content that ends inside the frame keeps its
even size, because its last column or row is a transparent one of the frame.

### 9.6 Delivery and other exports

- With the File System Access API the user picks a folder once per document; the handle is
  remembered. "Export again" rewrites the bundle without a dialog. `exportOnSave` does the same
  on save.
- Without that API the bundle downloads as `<name>.zip`.
- Other exports: current frame PNG (scale 1–16×), sprite sheet PNG alone, PNG sequence (zip);
  M6 adds GIF.

### 9.7 Conformance

Export is accepted only when all three hold (SE-053):

1. `<name>.atlas.json` validates against the schema and its rectangles lie inside the PNG.
2. The installed `ngne-preview` (`node node_modules/@ngne/core/dist/preview/cli.js <config>`)
   starts, and its page, opened in the foreground of the test browser, reports a status
   beginning with `Ready` with no error text, for every frame selected in turn (waiting for the
   page's details to name the selected frame).
3. A fixture NGNE game importing `<name>.sprites.ts` draws every frame; in-page readback of its
   canvas matches the CPU composite: opaque pixels exact; pixels of alpha 0 show the colour
   beneath exactly; others within 1 per channel of the blend over the colour beneath, rounded to
   8 bits. Fixtures include odd document sizes, trimmed frames, merged duplicates, an
   off-centre pivot, rotation by 90°, 180° and 270° near the view origin as well as away from
   it, `flipX` and `scale: 2`.

## 10. Project file and persistence

- `.ngsprite` is a zip (fixed entry timestamps; PNG entries stored, not deflated):
  `manifest.json` (`format: "ngne-sprite-project"`, `version: 1`, app version), `doc.json` (the
  model of §5.1 without pixels), `images/<imageId>.png` (lossless RGBA8),
  `refs/<sourceId>.png` (original bytes), `thumb.png` (composite of frame 1, at most 128 px).
- Loading validates the manifest, runs version migrations, then checks model invariants. An
  unknown newer version is refused with a message; corrupt entries name the failing file.
- [FORMAT.md](FORMAT.md) specifies the file: every field of `doc.json` with its range, the form
  of an ID (1–64 characters of `A–Z a–z 0–9 _ -`, since IDs name entries) and the limits
  (FORMAT §1.8): 1024 layers, 65 535 frames, 1024 tags, 131 072 cels on 65 527 images, names of
  255 UTF-16 code units, 64 MiB per reference source, 1 GiB of pixel data. They hold together:
  a document at every count limit at once is saved inside every size limit. Saving refuses a
  document outside them with a typed error, so a file that was written can be read.
- Save/Save As use the File System Access API when present, otherwise download. Open also
  accepts drag-and-drop.
- Autosave: each dirty document is snapshotted to IndexedDB 2 s after its last change
  (`doc.json` plus raw image buffers keyed by image ID; only changed images are rewritten). On
  launch, unsaved snapshots are offered for recovery. Closing a tab with unsaved changes
  triggers the browser's unload confirmation.
- Both formats (`.ngsprite` v1, `ngne-sprite-atlas` v1) may still change until release gate G3;
  from the v1.0.0 release any change needs a version bump and a migration.

## 11. Quality

| Layer       | What is tested                                                                        |
| ----------- | ------------------------------------------------------------------------------------- |
| Unit (Node) | Model invariants, every command's do/undo symmetry, raster algorithms against golden buffers, compositor, quantizer determinism, packer, codecs (round trip, pixel-exact PNG) |
| E2E         | Draw-undo-redo, layer/frame/tag flows, selection and transform, import, save/open round trip, export conformance (§9.7), viewport readback and overlay screenshots at DPR 1 and 1.5 |
| Performance | §6.6 budgets measured by a scripted benchmark page; recorded, not asserted in CI      |
| Manual      | Interface review against DESIGN.md on reference hardware                              |

Definition of done for every ticket: acceptance criteria met; unit tests for `core/` changes;
E2E for user-visible flows; typecheck, lint and format clean; no new runtime dependency beyond
§4 without a recorded decision.

## 12. Assumptions and owner acknowledgements

These defaults keep the plan unblocked. Each needs the owner's acknowledgement (or a different
decision) recorded in [REVIEW.md](REVIEW.md) before the listed ticket starts; changing one after
that point is a change request.

| ID | Assumption                                                                                           | Needed before |
| -- | ---------------------------------------------------------------------------------------------------- | ------------- |
| A1 | v1 scope is the M0–M7 tier of §2.3; every "Later" row is out of v1; effort is roughly 145–215 developer-days | SE-001 |
| A2 | "NGNE-ready" is the bundle and schema of §9, with Aseprite-format JSON as an optional extra file      | SE-050        |
| A3 | "Quantize into sprites at the specified size" is cells → resample to W×H → reduce colours (§8)       | SE-043        |
| A4 | The editor consumes the published `@ngne/core` 0.2.1 and does not modify the engine                   | SE-001        |
| A5 | Runtime dependencies in §4 are approved                                                               | SE-001        |
| A6 | Desktop Chrome/Edge only; no fallback renderer; minimum window 1280×720                               | SE-001        |
| A7 | Reference images render behind or in front of all pixel layers, not at arbitrary stack positions      | SE-003        |
| A8 | Repository on GitHub, CI on GitHub Actions, deploy to GitHub Pages, MIT licence (as NGNE)             | SE-001        |
| A9 | Reference hardware of §3 is available for SE-002 and performance records                              | SE-002        |

## 13. Risks

| Risk                                                        | Likelihood | Mitigation                                               |
| ----------------------------------------------------------- | ---------- | -------------------------------------------------------- |
| Async whole-texture upload makes strokes feel laggy         | Medium     | SE-002 measures; overlay stroke echo fallback (§6.6)     |
| Pixel misalignment at fractional DPR or odd sizes           | Medium     | Integer device-pixel zoom, snap off, even export rects, readback tests |
| NGNE 0.x API changes                                        | Medium     | Exact pin; all engine use isolated in `engine/`          |
| Two WebGPU devices (viewport + preview) on weak GPUs        | Low        | SE-002 verifies; preview stops when hidden               |
| Slot memory (NGNE keeps a bitmap per slot)                  | Medium     | Reference texel budget, 1×1 placeholders, `renderer.inspect()` checks |
| Scope creep toward full Aseprite parity                     | High       | §2.3 tiers; Later items need a new spec revision         |
| Browser-reserved shortcuts break Aseprite muscle memory     | Certain    | §7.8 alternates, command palette, PWA window (SE-072)    |
