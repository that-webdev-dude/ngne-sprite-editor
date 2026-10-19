import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpriteAtlas } from "../../src/core/export";

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
