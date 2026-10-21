# User guide

[README](../README.md) · [File formats](FORMAT.md) · [Specification](SPEC.md)

## Authoring loop

1. Choose **File → New Sprite…** (Ctrl+Alt+N), give it a name and a canvas size from 1 to
   1024 pixels per side, then Create. Start with 32 × 32 for a small sprite. Pick foreground
   and background colours in the dock; use the pencil, eraser, bucket, lines and shapes in
   the tool rail. Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes. Hold Space to pan; use the
   wheel to zoom about the pointer and Fit to see the whole sprite.
2. Use **Layer → New Layer** to separate parts of the drawing. The timeline shows layers
   and their cels (one layer's pixels at one frame). Select a layer to paint on it; use its
   visibility, lock, opacity and blend settings as needed. Reorder layers by dragging,
   or merge down and flatten through the Layer menu. At least one pixel layer stays.
3. Add frames through the Frame menu: a new frame duplicates the current one by default;
   an empty frame is also available. Select frames and edit the duration in milliseconds
   in the timeline. Linked cels share pixels: changing one changes every linked cel. Unlink
   before drawing an independent version. Timeline drag moves frames or cels; Ctrl at the
   release copies them, and Escape cancels the drag.
4. Select a frame range and choose **Frame → New Tag…**. Give it a name such as `walk`,
   a colour, direction (forward, reverse or ping-pong) and repeat count. Zero repeats loops
   forever; a positive count plays that many passes. **Tag Properties…** edits the range
   and can select overlapping tags. At a frame with several tags, playback uses the shortest
   range, with the latest-created tag winning ties.
5. Press Enter with the canvas or timeline focused, or use Play / Pause. Playback uses the
   active tag or all frames when no tag covers the playhead. **Frame → Playback Speed**
   offers 0.25×–4×. A hidden browser tab pauses the clock; editing stops playback on the
   frame last drawn. The dock's Preview runs the generated animation through NGNE and
   excludes reference images and editing overlays.
6. Use F3 or **View → Show/Hide Onion Skin** while drawing between frames. Its settings let
   you show up to three neighbours on either side, change opacity and falloff, tint earlier
   frames red and later ones blue, choose front/behind placement, and limit ghosts to the
   active tag. Onion skins hide during playback and are never exported.
7. **File → Save** (Ctrl+S) writes a `.ngsprite` project, including the layer/frame structure,
   palette, tags and original reference PNGs. **Save As…** chooses another file. With File
   System Access the editor remembers the file handle and asks for write permission when
   needed; otherwise it downloads a project. A cancelled browser download cannot be detected
   by the page, so check that your file was written. A star on the tab marks unsaved work.
8. Autosave keeps each dirty document in IndexedDB two seconds after its last change,
   rewriting only changed image buffers. At the next launch, choose Recover or Discard for
   offered snapshots. Autosave is local to this browser profile and origin; it is not a
   replacement for saving a project file. Preferences can disable it. The browser asks
   before leaving unsaved work. An edit within the two-second delay may not yet be in the
   recovery snapshot when a PWA update is reloaded.

Multiple documents live in tabs, each with its own undo history and view. Open Recent lists
up to ten project handles when File System Access is available. Ctrl+K opens the command
palette; the shortcut sheet is in View. See [the shortcut specification](SPEC.md#78-keyboard)
for the complete map.

## Import and quantize

1. Choose **File → Import PNG…**, drop PNG files into the window, or paste an image when no
   document is open. A single dropped PNG offers import or reference placement. Several files
   become one frame each in natural filename order; a single sheet can be split into a grid.
2. Choose the whole image or a crop, then Single sprite or Grid. Set cell width/height or
   columns/rows, offsets, spacing and whether to skip empty cells. Cells are read row by row.
3. Set the **target sprite size** (for example 32 × 32). Every cell becomes exactly this size.
   Contain preserves its aspect ratio with transparent margins; Cover crops to fill; Stretch
   fills both dimensions independently. Importing into an existing document requires its size.
4. Choose Nearest to keep existing pixel edges, Area average for a photographic source, or
   Dominant colour per block for a block-based result. Equal-size cells skip resampling.
5. Choose Keep alpha or a binary threshold from 1–255. An optional colour key with tolerance
   removes a background before resampling; thresholding happens afterward. Smart defaults keep
   binary alpha only when no resampling is needed; otherwise the default threshold is 128.
6. Choose Keep colours, Reduce to 2–256, or Map to the document/preset palette. For a larger
   source reduced to a small sprite the smart default is Reduce to 16. Reduction builds one
   palette across all cells using OKLab colour distance. Try None, Ordered (Bayer 4 × 4), or
   Floyd–Steinberg dithering in the live preview. Identical inputs and settings give identical
   output. Replace, append to, or leave the document palette; append stops at 256 colours.
7. Choose New document, New frames or New layer. New frames append to the active pixel layer;
   New layer begins at the active frame and extends the timeline if necessary. In an existing
   document the whole import is one undo step. For a single sprite, **Keep source as reference**
   also places the original over the fitted region for comparison (with Stretch and unequal
   aspect ratios, the reference uses Contain). Wait for the preview to finish before Import.

Source PNGs are limited to 8192 × 8192 per file, 1024 resulting frames and 256 MB of resulting
pixels. The dialog names unreadable files and refuses invalid settings without changing the
document. See [SPEC §8](SPEC.md#8-png-import-and-quantization-c2) for the exact pipeline.

## Reference images

Choose **Layer → New Reference Layer from File…**, drop a PNG and choose Add as reference,
or keep the source during single-sprite import. A new reference starts fitted and centred,
behind all pixel layers, at 50% opacity. Up to four references are allowed; each source file
must be at most 64 MiB. The project keeps its original PNG bytes.

Select the reference's timeline row and open Layer Properties to change X/Y, uniform scale,
opacity, visibility, lock and behind/front placement. With Move selected, drag the image to
move it by whole document pixels or drag a corner to scale it uniformly about the opposite
corner. Escape cancels; release records one undo step. Reset Reference to Fit centres it again.
Unlock before moving, scaling or changing placement. Changing the canvas dimensions during
a drag cancels it and preserves the size operation's reference geometry.

A reference sits behind or in front of **all** pixel layers, never between them. It cannot be
painted on and appears in neither the CPU composite, the preview panel nor any export. The
display source is limited to 4096 pixels per side and resampled after zoom settles, with a
16 MP total display budget; enlarging beyond the display source uses nearest sampling.
Moving at a fractional zoom can change its rounded display width by a pixel and resample it
after 100 ms; this accepted display trade-off changes neither the source PNG nor exports (F75).
See [SPEC §7.6](SPEC.md#76-reference-layers-c3).

## Export

Choose **File → Export…** (Ctrl+E). The dialog shows the files and final IDs before writing.
Choose all frames or a tag, grid/row/column layout, padding (0–8), extrusion (0–2), trimming
and duplicate merging. Set the pivot in Sprite Properties; draw helpers place that point on
the game coordinate you give them.

The NGNE bundle contains:

| File | Contents |
| ---- | -------- |
| `<name>.png` | Straight-alpha RGBA8 atlas, sRGB, with transparent RGB normalized to zero |
| `<name>.atlas.json` | Frozen `ngne-sprite-atlas` v1 frame rectangles, source sizes, offsets, pivots and animations |
| `<name>.sprites.ts` | Optional (on by default) typed image asset, draw helpers and animation lookups |
| `<name>.preview.config.mjs` | Optional (on by default) ready-to-run `ngne-preview` configuration |
| `<name>.aseprite.json` | Optional Aseprite JSON, array or hash, for the same PNG |

`<name>` is the document name converted to a safe lowercase file slug. Frame IDs are
`<name>-<index>` with a zero-based document index; choosing one tag keeps those indices.
Tags become animations, with suffixes for duplicate slugs. A multi-frame sprite without tags
gets one looping animation. Finite repeats and ping-pong sequences are written out in the
animation entries. Rectangles are never rotated and get transparent right/bottom padding to
even dimensions for NGNE centre snapping. Trim offsets and the source-frame pivot preserve
placement; drawing uses those values rather than the atlas cell corner.

Pick an output folder when File System Access is available; the handle is remembered per
document. The first write asks before replacing bundle files already there. **Export Again**
(Ctrl+Shift+E) rewrites the bundle; Export on Save does so after a successful project save
when a folder and permission are already available. Without File System Access the bundle
downloads as a zip. An export writes its selected files and removes none: switching a file
off leaves any older copy in the folder. Check an error toast for the files written before
a failed write. An atlas cannot exceed 8192 pixels per side or 65 536 animation entries.

Other File menu exports are current-frame PNG (1–16×, up to 8192 pixels per side), sheet PNG,
PNG sequence zip and GIF (1–8×). GIF thresholds alpha at 128, reduces to at most 256 colours
per frame (255 with transparency), and rounds durations to 10 ms with a 20 ms minimum.
References, onion skins, grids, symmetry guides and tiled copies are excluded from exports.
See [SPEC §9](SPEC.md#9-ngne-asset-export-c1) and [FORMAT §2](FORMAT.md#2-sprite-atlas-ngne-sprite-atlas-version-1).

## Use the bundle in an NGNE game

Keep the exported PNG beside its generated module in an NGNE consumer project using
`@ngne/core` 0.2.1. A module for `hero` exports `heroImage` (an `imageAsset` using a URL relative
to the module), `heroAtlas` (inlined atlas data), `HeroFrameId`, `HeroAnimationId`,
`drawHero`, `drawHeroTopLeft`, `heroAnimationFrame` and `heroAnimationDone`.
Names with several words use camelCase (`hero-walk` → `heroWalkImage`, `drawHeroWalk`);
a name beginning with a digit gets a `sprite` prefix.

- `drawHero(frame, id, x, y, options?)` anchors the source-frame pivot at `(x, y)`.
- `drawHeroTopLeft` places the source frame's top-left corner there instead.
- Draw options include rotation (radians), uniform scale, flips, layer, depth, alpha, colour
  (`color`) and `screen`. Trim offsets, even padding and quarter-turn rounding are handled
  by the helpers.
- `heroAnimationFrame(animation, ageMs)` returns the current frame ID. `heroAnimationDone`
  is true at and after a finite animation's end; a loop never finishes. Advance ages in
  milliseconds from the game's simulation time.

For a quick exported-sheet inspection, with the `ngne-preview` binary from the installed
`@ngne/core` on PATH, run in the bundle folder:

```sh
ngne-preview ./<name>.preview.config.mjs
```

Replace `<name>` with the exported slug. In an npm project, `npx --no-install ngne-preview
./hero.preview.config.mjs` uses the local binary. The preview centres a trimmed rectangle;
use the helpers in a game when the source-frame pivot matters.

The complete scene below is the SE-053 consumer fixture, copied without edits from
[`tests/fixtures/ngne-consumer/game.ts`](../tests/fixtures/ngne-consumer/game.ts). Save it
as `game.ts`. The equality test `se-073-guide.test.ts` keeps this block identical to the
tested fixture, including its trailing newline.

<!-- guide-example:start -->

```ts
import { BrowserGame } from "@ngne/core";
import type { Frame, FrameScheduler, ImageAsset, SceneDefinition, Stats } from "@ngne/core";

// SE-053: the consumer fixture of SPEC §9.7, condition 3. A minimal NGNE game as a user of
// an exported sprite writes it: one scene that lists the sheet's image in `assets`, draws
// with the functions of the generated `<name>.sprites.ts`, and resolves an animation with
// them. It uses nothing but `@ngne/core` and what the generated module exports, and it
// leaves the scene's camera as NGNE makes it (`pixelSnap` on).
//
// The page tests/e2e/harness/se-053-consumer.ts loads a generated module, hands its exports
// to this game as a `Sheet`, and reads the canvas back in `afterFrame`.

/** The draw options of a generated module the game sets. */
export interface SheetDrawOptions {
    rotation?: number;
    scale?: number;
    flipX?: boolean;
    flipY?: boolean;
}

/** What the game uses of a generated `<name>.sprites.ts`: its exports, under plain names. */
export interface Sheet {
    /** `<name>Image`: the atlas image as an NGNE asset. */
    image: ImageAsset;
    /** `draw<Name>`: a frame with its pivot on (`x`, `y`). */
    draw(frame: Frame, id: string, x: number, y: number, options?: SheetDrawOptions): void;
    /** `draw<Name>TopLeft`: a frame with the corner of its source frame on (`x`, `y`). */
    drawTopLeft(frame: Frame, id: string, x: number, y: number, options?: SheetDrawOptions): void;
    /** `<name>AnimationFrame`: the frame an animation shows at an age. */
    animationFrame(animation: string, ageMs: number): string;
    /** `<name>AnimationDone`: whether a "once" animation has reached its end. */
    animationDone(animation: string, ageMs: number): boolean;
}

/** One frame of the sheet on the stage. */
export interface StageSprite {
    frame: string;
    x: number;
    y: number;
    /** Placed by the corner of its source frame instead of its pivot. */
    topLeft?: boolean;
    options?: SheetDrawOptions;
}

/** What the scene shows. The host changes it between two frames of the game. */
export interface Stage {
    /** Frames drawn every frame, in this order. */
    sprites: StageSprite[];
    /** An animation of the sheet playing at a point, or none. */
    animation: { id: string; x: number; y: number } | null;
    /** Age of that animation in milliseconds. The scene's system advances it every tick. */
    ageMs: number;
    /** What the last render drew of the animation: its frame, and whether it had ended. */
    shown: { frame: string; done: boolean } | null;
    /** Ticks the scene's system has run. */
    ticks: number;
    /** `pixelSnap` of the scene's camera as the scene found it. */
    pixelSnap: boolean | null;
}

export interface ConsumerOptions {
    canvas: HTMLCanvasElement;
    /** Logical size of the game, in pixels. */
    width: number;
    height: number;
    /** Clear colour, 0xRRGGBB. */
    clear: number;
    sheet: Sheet;
    /** Seconds per tick; NGNE's default (1/60) when left out. */
    dt?: number;
    /** Most ticks in one frame; NGNE's default (5) when left out. */
    maxTicks?: number;
    /** Runs the frames; `requestAnimationFrame` when left out. */
    scheduler?: FrameScheduler;
    diagnostic: (error: unknown) => void;
    afterFrame?: (stats: Readonly<Stats>) => void;
}

export interface ConsumerGame {
    app: BrowserGame<Record<string, never>, never>;
    stage: Stage;
    /** Loads the image, mounts the scene and starts the loop. */
    start(): Promise<void>;
}

export function createConsumerGame(options: ConsumerOptions): ConsumerGame {
    const { sheet } = options;
    const stage: Stage = {
        sprites: [],
        animation: null,
        ageMs: 0,
        shown: null,
        ticks: 0,
        pixelSnap: null,
    };

    const scene: SceneDefinition<Record<string, never>, never> = {
        id: "ngne-consumer",
        // NGNE loads the image and uploads it before the scene is mounted; its ID is the
        // texture the generated draw functions name.
        assets: [sheet.image],
        setup(scene) {
            stage.pixelSnap = scene.camera.pixelSnap;
            scene.system(({ dt }) => {
                stage.ticks++;
                if (stage.animation) stage.ageMs += dt * 1000;
            });
            scene.render((frame) => {
                for (const sprite of stage.sprites) {
                    const draw = sprite.topLeft ? sheet.drawTopLeft : sheet.draw;
                    draw(frame, sprite.frame, sprite.x, sprite.y, sprite.options);
                }
                stage.shown = null;
                if (stage.animation) {
                    const { id, x, y } = stage.animation;
                    const shown = sheet.animationFrame(id, stage.ageMs);
                    sheet.draw(frame, shown, x, y);
                    stage.shown = { frame: shown, done: sheet.animationDone(id, stage.ageMs) };
                }
            });
        },
    };

    const app = new BrowserGame<Record<string, never>, never>({
        canvas: options.canvas,
        width: options.width,
        height: options.height,
        clear: options.clear,
        seed: "ngne-consumer",
        state: {},
        transition: (state) => state,
        diagnostic: options.diagnostic,
        ...(options.dt === undefined ? {} : { dt: options.dt }),
        ...(options.maxTicks === undefined ? {} : { maxTicks: options.maxTicks }),
        ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
        ...(options.afterFrame === undefined ? {} : { afterFrame: options.afterFrame }),
    });

    return {
        app,
        stage,
        start: async () => app.start(await app.game.prepare(scene, { key: "stage" })),
    };
}
```

<!-- guide-example:end -->

Connect a `hero` export to that scene in the consumer's browser entry point. This example
assumes the bundle is in `./assets/`, has a frame `hero-0` and a tag `walk`; use the actual
IDs shown in your export dialog. The HTML page supplies a `<canvas id="game"></canvas>`.

```ts
import { createConsumerGame } from "./game";
import {
    heroImage,
    drawHero,
    drawHeroTopLeft,
    heroAnimationFrame,
    heroAnimationDone,
} from "./assets/hero.sprites";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("Missing #game canvas");

const game = createConsumerGame({
    canvas,
    width: 320,
    height: 180,
    clear: 0x202020,
    sheet: {
        image: heroImage,
        draw: (frame, id, x, y, options) =>
            drawHero(frame, id as Parameters<typeof drawHero>[1], x, y, options),
        drawTopLeft: (frame, id, x, y, options) =>
            drawHeroTopLeft(frame, id as Parameters<typeof drawHeroTopLeft>[1], x, y, options),
        animationFrame: (id, ageMs) =>
            heroAnimationFrame(id as Parameters<typeof heroAnimationFrame>[0], ageMs),
        animationDone: (id, ageMs) =>
            heroAnimationDone(id as Parameters<typeof heroAnimationDone>[0], ageMs),
    },
    diagnostic: (error) => console.error(error),
});
game.stage.sprites.push({ frame: "hero-0", x: 40, y: 90 });
game.stage.animation = { id: "walk", x: 160, y: 90 };
await game.start();
```

The fixture accepts plain string IDs so the same scene can exercise any generated sheet.
The adapter above narrows them at that boundary; your game can use the exported ID types
directly. The scene lists the image in `assets`, so NGNE loads it before drawing. It keeps
the default camera snapping and advances animation age in its system's `dt` seconds.

For offline installation and updates see the [PWA audit](audit/pwa.md); for remaining release
checks and trade-offs see [REVIEW H25](REVIEW.md#stop-checkpoint-e) and the
[known limitations](../CHANGELOG.md#known-limitations).
