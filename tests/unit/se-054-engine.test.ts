import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpriteAtlas } from "../../src/core/export";
import { TICK_MS } from "../../src/engine/preview/demandScheduler";
import type { FrameSchedulerLike } from "../../src/engine/preview/demandScheduler";

// SE-054: `engine/NgnePreview` against a stand-in `BrowserGame` (SPEC §6.2 #14, §6.5): lifecycle
// calls serialized for the page, the atlas uploaded by the host after `start()` resolved, nothing
// drawn from it before the first upload resolved, metadata taken from the upload's tag, the
// queue disposed before the game, a game rebuilt on a new canvas for a new size or a failure,
// and which diagnostics are reported.

interface Deferred {
    promise: Promise<void>;
    resolve(): void;
    reject(error: unknown): void;
}
function deferred(): Deferred {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Every lifecycle call of every fake game, and how many ran at once at most. */
const lifecycle = { log: [] as string[], running: 0, most: 0 };

class FakeRenderer {
    status = "ready";
    uploads: { id: string; signal: AbortSignal | undefined; done: Deferred }[] = [];
    texture(id: string, _source: unknown, signal?: AbortSignal): Promise<void> {
        const done = deferred();
        this.uploads.push({ id, signal, done });
        return done.promise;
    }
}

interface FakeSetup {
    camera: { pixelSnap: boolean };
    system(update: (context: { dt: number }) => void): void;
    render(prepare: (frame: unknown) => void): void;
}

class FakeGame {
    static games: FakeGame[] = [];
    readonly options: {
        canvas: unknown;
        width: number;
        height: number;
        diagnostic(error: unknown): void;
        afterFrame?(stats: { sprites: number }): void;
    };
    renderer?: FakeRenderer;
    systems: ((context: { dt: number }) => void)[] = [];
    renders: ((frame: unknown) => void)[] = [];
    camera = { pixelSnap: true };
    disposedWhileUploadOpen: boolean | null = null;
    game: {
        lifecycle: string;
        prepare(scene: { setup(setup: FakeSetup): void }): Promise<unknown>;
    };
    readonly index: number;

    constructor(options: FakeGame["options"]) {
        this.options = options;
        this.index = FakeGame.games.length;
        FakeGame.games.push(this);
        this.game = {
            lifecycle: "Stopped",
            prepare: async (scene) => {
                scene.setup({
                    camera: this.camera,
                    system: (update) => this.systems.push(update),
                    render: (prepare) => this.renders.push(prepare),
                });
                return { release() {} };
            },
        };
    }

    async #op(name: string, body: () => void): Promise<void> {
        lifecycle.log.push(`${name} ${this.index}`);
        lifecycle.running++;
        lifecycle.most = Math.max(lifecycle.most, lifecycle.running);
        try {
            await new Promise((resolve) => setTimeout(resolve, 1));
            body();
        } finally {
            lifecycle.running--;
        }
    }

    start(): Promise<void> {
        return this.#op("start", () => {
            this.renderer ??= new FakeRenderer();
            this.game.lifecycle = "Running";
        });
    }
    stop(): Promise<void> {
        return this.#op("stop", () => {
            this.game.lifecycle = "Stopped";
        });
    }
    dispose(): Promise<void> {
        // Whether the upload queue had been ended (its abort signal) when the game was.
        const open = this.renderer?.uploads.find(
            (upload) => upload.signal && !upload.signal.aborted,
        );
        this.disposedWhileUploadOpen = open !== undefined;
        return this.#op("dispose", () => {
            this.game.lifecycle = "Disposed";
        });
    }

    /** One frame: a tick of `dt` seconds, the render, `afterFrame`. Returns what was drawn. */
    frame(dt = 1 / 60): unknown[] {
        for (const system of this.systems) system({ dt });
        const drawn: unknown[] = [];
        const frame = {
            rect: (...args: unknown[]) => drawn.push(["rect", ...args]),
            sprite: (sprite: unknown) => drawn.push(sprite),
        };
        for (const render of this.renders) render(frame);
        this.options.afterFrame?.({ sprites: drawn.length });
        return drawn;
    }
}

vi.mock("@ngne/core", () => ({ BrowserGame: FakeGame }));
vi.mock("../../src/engine/bitmaps", () => ({
    bitmapFromPixels: async () => ({ close() {} }),
}));

class FakeCanvas {
    style: Record<string, string> = {};
    className = "";
    width = 0;
    height = 0;
    removed = false;
    remove() {
        this.removed = true;
    }
}

const host = {
    children: [] as FakeCanvas[],
    append(canvas: FakeCanvas) {
        this.children.push(canvas);
    },
};

beforeEach(() => {
    vi.stubGlobal("document", { createElement: () => new FakeCanvas() });
    FakeGame.games = [];
    lifecycle.log = [];
    lifecycle.running = 0;
    lifecycle.most = 0;
    host.children = [];
});

afterEach(() => {
    vi.unstubAllGlobals();
});

async function preview(options: { onDiagnostic?(message: string): void } = {}) {
    const { NgnePreview } = await import("../../src/engine/NgnePreview");
    return new NgnePreview(host as unknown as HTMLElement, options);
}

/** A sheet with one frame `f` at (x, 0) and an animation `a` that shows it. */
function sheet(x: number, width = 64): SpriteAtlas {
    return {
        width,
        height: 8,
        frames: {
            f: {
                x,
                y: 0,
                w: 4,
                h: 4,
                sourceW: 4,
                sourceH: 4,
                offsetX: 0,
                offsetY: 0,
                pivot: [0.5, 0.5],
            },
        },
        animations: {
            a: { playback: "loop", durationMs: 100, entries: [{ frame: "f", ms: 100 }] },
        },
    };
}
const atlas = (x: number, width = 64) => ({
    pixels: { width, height: 8, data: new Uint8ClampedArray(width * 32) },
    sheet: sheet(x, width),
});

/** The sprites a frame drew, without the background rect. */
const sprites = (drawn: unknown[]) =>
    drawn.filter((entry) => !Array.isArray(entry)) as { u: number; texture: string }[];

describe("NgnePreview", () => {
    it("starts a game for the document's size with snapping off, and uploads the atlas only after start() resolved", async () => {
        const p = await preview();
        p.setAtlas(atlas(0));
        p.setAnimation("a");
        p.setSize({ width: 4, height: 4 });
        expect(FakeGame.games).toHaveLength(0);
        p.setRunning(true);
        await flush();
        const [game] = FakeGame.games;
        expect(game!.options).toMatchObject({ width: 4, height: 4 });
        expect(game!.camera.pixelSnap).toBe(false);
        expect(lifecycle.log).toEqual(["start 0"]);
        await flush();
        expect(game!.renderer!.uploads.map((upload) => upload.id)).toEqual(["pv:atlas"]);
        await p.dispose();
    });

    it("draws nothing from the atlas before its first upload resolved; new metadata only with its upload", async () => {
        const p = await preview();
        p.setAnimation("a");
        p.setSize({ width: 4, height: 4 });
        p.setRunning(true);
        p.setAtlas(atlas(0));
        await flush();
        await flush();
        const game = FakeGame.games[0]!;
        // The background rect alone while the upload is in flight.
        expect(sprites(game.frame())).toEqual([]);
        expect(game.frame()).toHaveLength(1);
        game.renderer!.uploads[0]!.done.resolve();
        await flush();
        expect(sprites(game.frame())).toMatchObject([{ texture: "pv:atlas", u: 0 }]);

        // A repack moves the frame: the old rectangle until the new texture is in.
        p.setAtlas(atlas(32));
        await flush();
        expect(game.renderer!.uploads).toHaveLength(2);
        expect(sprites(game.frame())).toMatchObject([{ u: 0 }]);
        game.renderer!.uploads[1]!.done.resolve();
        await flush();
        expect(sprites(game.frame())).toMatchObject([{ u: 0.5 }]);

        // No atlas (another document): nothing of the old one is drawn, nor of the next one
        // before its upload.
        p.setAtlas(null);
        expect(sprites(game.frame())).toEqual([]);
        p.setAtlas(atlas(0));
        await flush();
        expect(sprites(game.frame())).toEqual([]);
        game.renderer!.uploads[2]!.done.resolve();
        await flush();
        expect(sprites(game.frame())).toMatchObject([{ u: 0 }]);
        await p.dispose();
    });

    it("runs lifecycle calls one at a time for the whole page", async () => {
        const first = await preview();
        const second = await preview();
        for (const p of [first, second]) {
            p.setSize({ width: 4, height: 4 });
            p.setRunning(true);
        }
        // New sizes for both, while their games are being made and started.
        for (let index = 1; index <= 6; index++) {
            first.setSize({ width: 4 + (index % 2), height: 4 });
            second.setSize({ width: 5 - (index % 2), height: 4 });
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
        await flush();
        await Promise.all([first.dispose(), second.dispose()]);
        expect(lifecycle.most).toBe(1);
        expect(lifecycle.log.filter((entry) => entry.startsWith("start")).length).toBeGreaterThan(
            3,
        );
        // Every game made was disposed.
        expect(FakeGame.games.every((game) => game.game.lifecycle === "Disposed")).toBe(true);
    });

    it("disposes the upload queue before the game", async () => {
        const p = await preview();
        p.setSize({ width: 4, height: 4 });
        p.setRunning(true);
        p.setAtlas(atlas(0));
        await flush();
        await flush();
        const game = FakeGame.games[0]!;
        expect(game.renderer!.uploads).toHaveLength(1);
        await p.dispose();
        expect(game.disposedWhileUploadOpen).toBe(false);
        expect(game.renderer!.uploads[0]!.signal!.aborted).toBe(true);
    });

    it("stops the game while it should not run, and has none without a document", async () => {
        const p = await preview();
        p.setSize({ width: 4, height: 4 });
        p.setRunning(true);
        await flush();
        p.setRunning(false);
        await flush();
        expect(lifecycle.log).toEqual(["start 0", "stop 0"]);
        expect(p.probe.liveGames).toBe(1);
        p.setRunning(true);
        await flush();
        expect(lifecycle.log).toEqual(["start 0", "stop 0", "start 0"]);
        p.setSize(null);
        await flush();
        expect(lifecycle.log[lifecycle.log.length - 1]).toBe("dispose 0");
        expect(p.probe.liveGames).toBe(0);
        await p.dispose();
    });

    it("makes a new game on a new canvas when the document's size changes", async () => {
        const p = await preview();
        p.setSize({ width: 4, height: 4 });
        p.setRunning(true);
        await flush();
        p.setSize({ width: 6, height: 2 });
        await flush();
        await flush();
        expect(lifecycle.log).toEqual(["start 0", "dispose 0", "start 1"]);
        expect(FakeGame.games[1]!.options).toMatchObject({ width: 6, height: 2 });
        expect(FakeGame.games[1]!.options.canvas).not.toBe(FakeGame.games[0]!.options.canvas);
        expect((FakeGame.games[0]!.options.canvas as FakeCanvas).removed).toBe(true);
        expect(p.probe.liveGames).toBe(1);
        await p.dispose();
        expect(p.probe.liveGames).toBe(0);
    });

    it("rebuilds a failed game; reports diagnostics once per message, never dropped ticks", async () => {
        const messages: string[] = [];
        const p = await preview({ onDiagnostic: (message) => messages.push(message) });
        p.setSize({ width: 4, height: 4 });
        p.setRunning(true);
        await flush();
        const game = FakeGame.games[0]!;
        game.options.diagnostic({ type: "overload", droppedTicks: 3 });
        game.options.diagnostic(new Error("Texture is not ready: x"));
        game.options.diagnostic(new Error("Texture is not ready: x"));
        await flush();
        expect(messages).toEqual(["Texture is not ready: x"]);
        expect(FakeGame.games).toHaveLength(1);

        // A throw in tick or render fails the game: it is disposed and made again.
        game.game.lifecycle = "Failed";
        game.options.diagnostic(new Error("render threw"));
        await flush();
        await flush();
        expect(messages).toEqual(["Texture is not ready: x", "render threw"]);
        expect(FakeGame.games).toHaveLength(2);
        expect(lifecycle.log).toEqual(["start 0", "dispose 0", "start 1"]);
        await p.dispose();
    });

    it("an upload that fails for good asks for a fresh renderer: a new game", async () => {
        const messages: string[] = [];
        const p = await preview({ onDiagnostic: (message) => messages.push(message) });
        p.setSize({ width: 4, height: 4 });
        p.setRunning(true);
        p.setAtlas(atlas(0));
        await flush();
        await flush();
        FakeGame.games[0]!.renderer!.uploads[0]!.done.reject(new Error("validation failed"));
        await flush();
        await flush();
        expect(messages).toEqual(["validation failed"]);
        expect(FakeGame.games).toHaveLength(2);
        await flush();
        expect(FakeGame.games[1]!.renderer!.uploads.map((upload) => upload.id)).toEqual([
            "pv:atlas",
        ]);
        await p.dispose();
    });

    it("keeps drawing the animation drawn last while the published sheet lacks the one set, until the new atlas is uploaded", async () => {
        const p = await preview();
        p.setAnimation("a");
        p.setSize({ width: 4, height: 4 });
        p.setRunning(true);
        p.setAtlas(atlas(0));
        await flush();
        await flush();
        const game = FakeGame.games[0]!;
        game.renderer!.uploads[0]!.done.resolve();
        await flush();
        expect(sprites(game.frame())).toMatchObject([{ u: 0 }]);

        // A tag just made (or renamed): the repack that has it is not uploaded yet.
        p.setAnimation("b");
        expect(sprites(game.frame())).toMatchObject([{ u: 0 }]);
        const base = atlas(0);
        const next = {
            pixels: base.pixels,
            sheet: {
                ...base.sheet,
                frames: { ...base.sheet.frames, g: { ...base.sheet.frames.f!, x: 32 } },
                animations: {
                    ...base.sheet.animations,
                    b: {
                        playback: "loop" as const,
                        durationMs: 100,
                        entries: [{ frame: "g", ms: 100 }],
                    },
                },
            },
        };
        p.setAtlas(next);
        await flush();
        expect(sprites(game.frame())).toMatchObject([{ u: 0 }]);
        game.renderer!.uploads[1]!.done.resolve();
        await flush();
        expect(sprites(game.frame())).toMatchObject([{ u: 0.5 }]);
        await p.dispose();
    });

    it("draws the options' fallback animation when the sheet has neither the one set nor one drawn before", async () => {
        const { NgnePreview } = await import("../../src/engine/NgnePreview");
        const p = new NgnePreview(host as unknown as HTMLElement, { fallbackAnimation: "a" });
        p.setAnimation("renamed");
        p.setSize({ width: 4, height: 4 });
        p.setRunning(true);
        p.setAtlas(atlas(0));
        await flush();
        await flush();
        const game = FakeGame.games[0]!;
        game.renderer!.uploads[0]!.done.resolve();
        await flush();
        expect(sprites(game.frame())).toMatchObject([{ u: 0 }]);
        await p.dispose();
    });

    describe("the game's clock after a still spell", () => {
        let now = 0;
        let rafs: FrameRequestCallback[] = [];
        beforeEach(() => {
            now = 1000;
            rafs = [];
            vi.spyOn(performance, "now").mockImplementation(() => now);
            vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
                rafs.push(callback);
                return rafs.length;
            });
            vi.stubGlobal("cancelAnimationFrame", () => undefined);
        });
        afterEach(() => {
            vi.restoreAllMocks();
        });

        /**
         * Runs the game's frames as NGNE's fixed step does on the scheduler it was given: the
         * ticks of each frame are the time since the one before, in 1/60 s.
         */
        function drive(game: FakeGame) {
            const scheduler = (game.options as unknown as { scheduler: FrameSchedulerLike })
                .scheduler;
            const ticks: number[] = [];
            let last = 0;
            const loop = (time: number) => {
                const elapsed = last ? time - last : 0;
                last = time;
                ticks.push(Math.floor(elapsed / TICK_MS + 1e-9));
                scheduler.request(loop);
            };
            scheduler.request(loop);
            /** Runs the animation frames asked for, at `now` + `late` ms. */
            const run = (late = 0) => {
                for (const callback of rafs.splice(0)) callback(now + late);
            };
            return { ticks, run };
        }

        it("a frame asked for after minutes of nothing to draw runs a tick or so, not all of them", async () => {
            const p = await preview();
            p.setAnimation("a");
            p.setSize({ width: 4, height: 4 });
            p.setRunning(true);
            await flush();
            const { ticks, run } = drive(FakeGame.games[0]!);
            run();
            expect(ticks).toEqual([0]);
            // Ten minutes later something drawn changes.
            now += 600_000;
            p.setBackground(0xffffff);
            run(16);
            expect(ticks).toHaveLength(2);
            expect(ticks[1]).toBeLessThanOrEqual(2);
            await p.dispose();
        });

        it("the time a game was stopped (a hidden tab) is not added to the age", async () => {
            const p = await preview();
            p.setAnimation("a");
            p.setSize({ width: 4, height: 4 });
            p.setRunning(true);
            await flush();
            const { run } = drive(FakeGame.games[0]!);
            run();
            p.setRunning(false);
            await flush();
            now += 600_000;
            p.setRunning(true);
            await flush();
            // A change of the rate counts the time since the last frame: none was played.
            p.setSpeed(2);
            expect(p.probe.ageMs).toBeLessThan(100);
            await p.dispose();
        });
    });

    it("writes the canvas's style only when the display size changes", async () => {
        const p = await preview();
        p.setSize({ width: 4, height: 4 });
        p.setRunning(true);
        await flush();
        const canvas = FakeGame.games[0]!.options.canvas as FakeCanvas;
        let writes = 0;
        canvas.style = new Proxy<Record<string, string>>(
            {},
            {
                set(target, key, value: string) {
                    writes++;
                    target[key as string] = value;
                    return true;
                },
            },
        );
        p.setDisplaySize({ width: 40, height: 40 });
        expect(writes).toBe(2);
        // Pan, zoom, playback: the sessions store changes, the display size does not.
        p.setDisplaySize({ width: 40, height: 40 });
        p.setDisplaySize({ width: 40, height: 40 });
        expect(writes).toBe(2);
        p.setDisplaySize({ width: 80, height: 40 });
        expect(writes).toBe(4);
        expect(canvas.style).toMatchObject({ width: "80px", height: "40px" });
        await p.dispose();
    });

    it("the page keeps each diagnostic once whichever panel reported it, the newest 200", async () => {
        const messages: string[][] = [[], []];
        const panels = [
            await preview({ onDiagnostic: (message) => messages[0]!.push(message) }),
            await preview({ onDiagnostic: (message) => messages[1]!.push(message) }),
        ];
        for (const p of panels) {
            p.setSize({ width: 4, height: 4 });
            p.setRunning(true);
        }
        await flush();
        await flush();
        const [one, two] = FakeGame.games;
        one!.options.diagnostic(new Error("se-054 O: shared"));
        two!.options.diagnostic(new Error("se-054 O: shared"));
        // Each panel lists it once; the page has it once.
        expect(messages).toEqual([["se-054 O: shared"], ["se-054 O: shared"]]);
        const shared = panels[0]!.probe.diagnostics.filter((m) => m === "se-054 O: shared");
        expect(shared).toHaveLength(1);

        for (let index = 0; index < 250; index++) one!.options.diagnostic(new Error(`O ${index}`));
        const kept = panels[1]!.probe.diagnostics;
        expect(kept).toHaveLength(200);
        expect(kept[kept.length - 1]).toBe("O 249");
        expect(kept[0]).toBe("O 50");
        await Promise.all(panels.map((p) => p.dispose()));
    });

    it("advances the age by dt × 1000 × speed while playing", async () => {
        const p = await preview();
        p.setSize({ width: 4, height: 4 });
        p.setRunning(true);
        await flush();
        const game = FakeGame.games[0]!;
        game.frame(1 / 60);
        expect(p.probe.ageMs).toBeCloseTo(1000 / 60, 9);
        p.setSpeed(2);
        game.frame(1 / 60);
        expect(p.probe.ageMs).toBeCloseTo(3000 / 60, 9);
        p.setPlaying(false);
        game.frame(1 / 60);
        expect(p.probe.ageMs).toBeCloseTo(3000 / 60, 9);
        p.setAnimation("b");
        expect(p.probe.ageMs).toBe(0);
        await p.dispose();
    });
});
