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
