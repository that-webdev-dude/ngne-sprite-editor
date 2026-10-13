import type { FrameScheduler, ImageAsset } from "@ngne/core";
import { readCanvas } from "../../../src/engine/testing/readCanvas";
import { createConsumerGame } from "../../fixtures/ngne-consumer/game";
import type { Sheet, StageSprite } from "../../fixtures/ngne-consumer/game";
import { toBase64 } from "../se-053-documents";
import { CANVAS, CLEAR } from "../se-053-expected";
import type { AnimationReadback, CanvasReadback, DrawCommand } from "../se-053-expected";

// SE-053 consumer page: imports one generated `<name>.sprites.ts` by its URL from the dev
// server, which compiles it as it does for a game that imports it, hands its exports to the
// consumer fixture (tests/fixtures/ngne-consumer) and lets a spec drive the game and read its
// canvas. The module finds its image beside it, by its own `import.meta.url`.
//
// Query: `module` is the URL of the generated module, `camel` and `pascal` the two forms of
// its name (SPEC §9.5), `scheduler` is `manual` (the default) or `raf`.
// - `manual`: the game's frames are run by the spec, one per call, on a clock the spec moves.
//   A tick is `TICK_MS` milliseconds, so an age is a whole number of them.
// - `raf`: the game runs on `requestAnimationFrame` with NGNE's own settings.
// The canvas is read back in `afterFrame`, in the task of the render (SPEC §6.7).

/**
 * Milliseconds of game time per tick under the manual scheduler: one, the unit of an entry's
 * duration, so the game can stand on the last millisecond before a boundary and on the
 * boundary itself. `dt` is then 0.001 s, and `dt × 1000` is exactly 1.
 */
const TICK_MS = 1;

/**
 * A scheduler in the place of `requestAnimationFrame`: it keeps the callback the game asks
 * for and runs it when told, at a time that is told. NGNE's `BrowserGame` takes a timestamp
 * of 0 for "no frame yet", so the clock starts above it.
 */
class ManualScheduler implements FrameScheduler {
    private pending: FrameRequestCallback | undefined;
    private id = 0;
    private now = 1000;

    request(callback: FrameRequestCallback): number {
        this.pending = callback;
        return ++this.id;
    }

    cancel(id: number): void {
        if (id === this.id) this.pending = undefined;
    }

    /** Runs the frame the game has asked for, `ms` milliseconds after the one before. */
    run(ms: number): void {
        const callback = this.pending;
        if (!callback) throw new Error("The game has asked for no frame.");
        this.pending = undefined;
        this.now += ms;
        callback(this.now);
    }
}

/** The exports of a generated module the game uses, each checked to be there. */
function sheetOf(module: Record<string, unknown>, camel: string, pascal: string): Sheet {
    const exported = <T>(name: string, type: "function" | "object"): T => {
        const value = module[name];
        if (typeof value !== type || value === null) {
            throw new Error(`The generated module does not export ${name}.`);
        }
        return value as T;
    };
    return {
        image: exported<ImageAsset>(`${camel}Image`, "object"),
        draw: exported<Sheet["draw"]>(`draw${pascal}`, "function"),
        drawTopLeft: exported<Sheet["drawTopLeft"]>(`draw${pascal}TopLeft`, "function"),
        animationFrame: exported<Sheet["animationFrame"]>(`${camel}AnimationFrame`, "function"),
        animationDone: exported<Sheet["animationDone"]>(`${camel}AnimationDone`, "function"),
    };
}

function spriteOf(command: DrawCommand): StageSprite {
    const sprite: StageSprite = { frame: command.frame, x: command.x, y: command.y };
    if (command.topLeft) sprite.topLeft = true;
    const options: NonNullable<StageSprite["options"]> = {};
    if (command.quarters) options.rotation = (command.quarters * Math.PI) / 2;
    if (command.scale !== undefined) options.scale = command.scale;
    if (command.flipX) options.flipX = true;
    if (command.flipY) options.flipY = true;
    // A plain draw passes no options at all, as most calls of a game do.
    if (Object.keys(options).length > 0) sprite.options = options;
    return sprite;
}

function describeError(error: unknown): string {
    if (error instanceof AggregateError) {
        return [error.message, ...error.errors.map(describeError)].join("; ");
    }
    if (error instanceof Error) return error.stack ?? error.message;
    return typeof error === "object" ? JSON.stringify(error) : String(error);
}

/** NGNE reports dropped ticks through `diagnostic`; they are notices, not errors. */
function isOverloadNotice(value: unknown): boolean {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as { type?: unknown }).type === "overload"
    );
}

// The DOM library of the pinned TypeScript has no WebGPU types; only these fields are read.
interface GpuLike {
    requestAdapter(): Promise<{ info: { vendor: string; architecture: string } } | null>;
}

async function adapterName(): Promise<string> {
    const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
    const adapter = await gpu?.requestAdapter();
    return adapter ? `${adapter.info.vendor} ${adapter.info.architecture}`.trim() : "none";
}

async function run(): Promise<void> {
    const query = new URLSearchParams(location.search);
    const moduleUrl = query.get("module");
    const camel = query.get("camel");
    const pascal = query.get("pascal");
    if (!moduleUrl || !camel || !pascal) throw new Error("Missing module, camel or pascal.");
    const manual = query.get("scheduler") !== "raf";
    const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
    if (!canvas) throw new Error("Missing canvas");

    const module = (await import(/* @vite-ignore */ moduleUrl)) as Record<string, unknown>;
    const sheet = sheetOf(module, camel, pascal);

    const diagnostics: string[] = [];
    const scheduler = manual ? new ManualScheduler() : undefined;
    let frames = 0;
    let last: CanvasReadback | null = null;
    const game = createConsumerGame({
        canvas,
        width: CANVAS.width,
        height: CANVAS.height,
        clear: CLEAR,
        sheet,
        ...(scheduler ? { scheduler, dt: TICK_MS / 1000, maxTicks: 100_000 } : {}),
        diagnostic(error) {
            if (!isOverloadNotice(error)) diagnostics.push(describeError(error));
        },
        afterFrame() {
            const image = readCanvas(canvas);
            last = { width: image.width, height: image.height, data: toBase64(image.data) };
            frames++;
        },
    });
    const { stage } = game;
    await game.start();

    /** Runs one frame of the game `ms` later and returns what it drew. */
    const frame = (ms: number): CanvasReadback => {
        if (!scheduler) throw new Error("The game runs on requestAnimationFrame.");
        const before = frames;
        scheduler.run(ms);
        if (frames !== before + 1 || !last) {
            throw new Error(`The game drew no frame: ${diagnostics.join(" | ") || "no report"}`);
        }
        return last;
    };
    const animationFrame = (ms: number): AnimationReadback => {
        const canvasImage = frame(ms);
        if (!stage.shown) throw new Error("The game plays no animation.");
        return { ...canvasImage, ageMs: stage.ageMs, ...stage.shown };
    };

    window.__se053 = {
        draw(commands) {
            stage.animation = null;
            stage.sprites = commands.map(spriteOf);
            return frame(0);
        },
        play(animation, x, y) {
            stage.sprites = [];
            stage.animation = { id: animation, x, y };
            stage.ageMs = 0;
            return animationFrame(0);
        },
        advance: animationFrame,
        resolve: (animation, ages) =>
            ages.map((age) => ({
                frame: sheet.animationFrame(animation, age),
                done: sheet.animationDone(animation, age),
            })),
        atlas: module[`${camel}Atlas`],
        show(commands) {
            stage.animation = null;
            stage.sprites = commands.map(spriteOf);
            return frames;
        },
        frames: () => frames,
        last: () => last,
        diagnostics: () => [...diagnostics],
        tickMs: TICK_MS,
        ticks: () => stage.ticks,
        adapter: await adapterName(),
        pixelSnap: stage.pixelSnap,
        lifecycle: () => game.app.game.lifecycle,
    };
}

const status = document.querySelector("#status");
run().then(
    () => {
        if (status) status.textContent = "ready";
    },
    (error: unknown) => {
        if (status) status.textContent = `failed: ${describeError(error)}`;
    },
);
