import { afterEach, describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import { activeDocument, isDirty, sessionsStore } from "../../src/app/state/sessions";
import { createToolPipeline } from "../../src/app/tools/pipeline";
import { pencilTool } from "../../src/app/tools/pencil/pencil.tools";
import { compositeFrame } from "../../src/core/composite";
import { createDocument } from "../../src/core/model";
import type { DocSession, Rect } from "../../src/core/model";
import { maskHas, rectMask, selectCommand } from "../../src/core/selection";
import { FRAME, celImage, firstDifference, layerId, sprite } from "./se-010-support";
import type { Rgba } from "./se-010-support";
import { at, harness, rgbaAt, stroke } from "./se-014-support";
import type { Harness } from "./se-014-support";

// SE-030: Select All, Deselect and Invert Selection as commands of the registry, with the keys
// of SPEC §7.8; and paint clipped to the selection, which the pointer pipeline passes as the
// transaction's clip (SPEC §7.1).

const command = (id: string) => {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
};

afterEach(() => {
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
});

describe("selection commands", () => {
    it("take the Select menu items planned for them, with Ctrl+A, Ctrl+D and Ctrl+I in global", () => {
        for (const [id, title, chord] of [
            ["select.all", "Select All", "Ctrl+A"],
            ["select.none", "Deselect", "Ctrl+D"],
            ["select.invert", "Invert Selection", "Ctrl+I"],
        ] as const) {
            const found = command(id);
            expect(found.planned, id).toBe(false);
            expect(found.source).toMatch(/selection\/selection\.commands\.ts$/);
            expect(found.title()).toBe(title);
            const plan = plannedCommands.find((entry) => entry.id === id);
            expect(found.menuPath).toEqual(["Select"]);
            expect(found.menuOrder).toBe(plan?.menuOrder);
            expect(found.shortcuts).toEqual([chord]);
            expect(found.contexts).toEqual(["global"]);
        }
    });

    it("are disabled without a document; Deselect also without a selection", () => {
        for (const id of ["select.all", "select.none", "select.invert"]) {
            expect(command(id).enabled(), id).toBe(false);
        }
        sessionsStore.getState().open(createDocument({ name: "sel", width: 6, height: 4 }));
        expect(command("select.all").enabled()).toBe(true);
        expect(command("select.invert").enabled()).toBe(true);
        expect(command("select.none").enabled()).toBe(false);
    });

    it("change the active document's selection, one undo step each", async () => {
        const document = sessionsStore
            .getState()
            .open(createDocument({ name: "sel", width: 6, height: 4 }));
        const { session, history } = document;
        await command("select.all").run();
        expect(session.selection?.bounds).toEqual({ x: 0, y: 0, width: 6, height: 4 });
        expect(history.undoLabel).toBe("Select All");
        expect(command("select.none").enabled()).toBe(true);
        // Already all selected: nothing to record.
        await command("select.all").run();
        expect(history.undoCount).toBe(1);
        // Everything inverted is nothing.
        await command("select.invert").run();
        expect(session.selection).toBeNull();
        expect(history.undoLabel).toBe("Invert Selection");
        history.undo();
        await command("select.none").run();
        expect(session.selection).toBeNull();
        expect(history.undoLabel).toBe("Deselect");
        expect(history.undoCount).toBe(2);
        // The store tells its subscribers (the status bar, the overlay) of each step.
        expect(activeDocument(sessionsStore.getState())?.revision).toBeGreaterThan(0);
    });

    it("make the document dirty: a selection change is a history step", async () => {
        const document = sessionsStore
            .getState()
            .open(createDocument({ name: "sel", width: 6, height: 4 }));
        const current = () => activeDocument(sessionsStore.getState())!;
        expect(isDirty(current())).toBe(false);
        await command("select.all").run();
        expect(isDirty(current())).toBe(true);
        document.history.undo();
        expect(isDirty(current())).toBe(false);
    });

    it("are disabled while a stroke's transaction is open", () => {
        const document = sessionsStore
            .getState()
            .open(createDocument({ name: "sel", width: 6, height: 4 }));
        document.history.execute(
            selectCommand(
                document.session,
                rectMask(6, 4, { x: 1, y: 1, width: 2, height: 2 }),
                "replace",
                "Select",
            )!,
        );
        const transaction = document.history.begin({
            layerId: document.session.activeLayerId,
            frameId: document.session.activeFrameId,
        });
        for (const id of ["select.all", "select.none", "select.invert"]) {
            expect(command(id).enabled(), id).toBe(false);
        }
        transaction.abort();
        expect(command("select.none").enabled()).toBe(true);
    });
});

const WIDTH = 10;
const HEIGHT = 8;
const BLACK = [0, 0, 0, 255];
/** The selection of the clipping tests: columns 2 to 5, rows 1 to 4. */
const SELECTED = { x: 2, y: 1, width: 4, height: 4 };

/** One layer whose cel holds a pattern: every pixel differs from its neighbours. */
function patterned(): DocSession {
    const pixels: Rgba[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) pixels.push([x * 20, y * 30, 100 + x + y, 255]);
    }
    const doc = sprite(WIDTH, HEIGHT, [{ pixels }]);
    return { doc, selection: null, activeLayerId: layerId(0), activeFrameId: FRAME };
}

/** Opens `patterned()` in `h` with `SELECTED` as its selection, painting black. */
function withSelection(h: Harness): DocSession {
    const session = patterned();
    const { history } = h.open(session);
    const mask = rectMask(WIDTH, HEIGHT, SELECTED);
    history.execute(selectCommand(session, mask, "replace", "Select")!);
    h.editor.getState().setForeground(0x000000ff);
    return session;
}

/** The pixels of the active cel whose bytes differ from `before`, as "x,y". */
function changed(session: DocSession, before: Uint8ClampedArray): string[] {
    const image = celImage(session.doc, session.activeLayerId, session.activeFrameId);
    const found: string[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const at = (y * WIDTH + x) * 4;
            if ([0, 1, 2, 3].some((channel) => image.data[at + channel] !== before[at + channel])) {
                found.push(`${x},${y}`);
            }
        }
    }
    return found;
}

describe("paint clipped to the selection", () => {
    // A row across the selection's left and right edges, and a column across its bottom.
    const across = [
        ...Array.from({ length: WIDTH }, (_, x) => ({ x, y: 3 })),
        ...Array.from({ length: HEIGHT }, (_, y) => ({ x: 4, y })),
    ];

    it("a stroke crossing the selection's edge changes pixels only inside", () => {
        const h = harness();
        const session = withSelection(h);
        const image = celImage(session.doc, session.activeLayerId, session.activeFrameId);
        const before = image.data.slice();
        expect(stroke(h, across)).toBe(true);
        const inside = across.filter((point) => maskHas(session.selection!.mask, point.x, point.y));
        expect(changed(session, before).sort()).toEqual(
            [...new Set(inside.map(({ x, y }) => `${x},${y}`))].sort(),
        );
        for (const { x, y } of inside) expect(rgbaAt(image, x, y)).toEqual(BLACK);
        // One undo step, which restores the bytes.
        expect(h.document().history.undoLabel).toBe("Dot");
        h.document().history.undo();
        expect(Array.from(image.data)).toEqual(Array.from(before));
    });

    it("the pencil's stroke too, and the live composite never shows a pixel outside", () => {
        const h = harness([pencilTool]);
        h.tools.select("pencil");
        const session = withSelection(h);
        const image = celImage(session.doc, session.activeLayerId, session.activeFrameId);
        const before = image.data.slice();
        const shownBefore = compositeFrame(session.doc, FRAME);
        const cache = h.composites.cache!;

        const [first, ...rest] = across;
        h.pipeline.down(at(h, first!, { button: 0 }));
        for (const point of rest) {
            h.pipeline.move([at(h, point)]);
            h.frames.run();
            // What the viewport and the stroke echo read: the live composite, up to date.
            const live = cache.get(FRAME);
            expect(firstDifference(live, compositeFrame(session.doc, FRAME))).toBeNull();
            for (let y = 0; y < HEIGHT; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    if (maskHas(session.selection!.mask, x, y)) continue;
                    expect(rgbaAt(live, x, y), `${x}, ${y}`).toEqual(rgbaAt(shownBefore, x, y));
                }
            }
        }
        h.pipeline.up(at(h, rest.at(-1)!, { button: 0, buttons: 0 }));
        expect(h.document().history.undoLabel).toBe("Pencil");
        const outside = changed(session, before).filter((key) => {
            const [x, y] = key.split(",").map(Number) as [number, number];
            return !maskHas(session.selection!.mask, x, y);
        });
        expect(outside).toEqual([]);
        expect(changed(session, before).length).toBeGreaterThan(4);
    });

    it("a stroke entirely outside the selection records nothing", () => {
        const h = harness();
        const session = withSelection(h);
        const image = celImage(session.doc, session.activeLayerId, session.activeFrameId);
        const before = image.data.slice();
        const undo = h.document().history.undoCount;
        stroke(h, [
            { x: 7, y: 6 },
            { x: 8, y: 6 },
            { x: 9, y: 7 },
        ]);
        expect(h.document().history.undoCount).toBe(undo);
        expect(Array.from(image.data)).toEqual(Array.from(before));
    });

    it("composites and echoes only the part of each change within the selection's bounds", () => {
        const h = harness();
        const session = withSelection(h);
        const composited: Rect[] = [];
        let echoes = 0;
        // The pipeline of the harness, with an overlay stroke echo that records what it is told.
        const pipeline = createToolPipeline({
            sessions: h.sessions,
            composites: h.composites,
            viewport: { invalidate() {} },
            status: h.status,
            editor: h.editor,
            tools: h.tools,
            mapping: () => h.mapping(),
            nextFrame: h.frames.request,
            later: h.timers.set,
            onError: (error) => void h.errors.push(error),
            echo: {
                start: () => void echoes++,
                changed() {},
                composited: (rect) => void composited.push({ ...rect }),
                release() {},
                clear() {},
            },
        });
        const [first, ...rest] = across;
        pipeline.down(at(h, first!, { button: 0 }));
        for (const point of rest) {
            pipeline.move([at(h, point)]);
            h.frames.run();
        }
        pipeline.up(at(h, rest.at(-1)!, { button: 0, buttons: 0 }));
        expect(echoes).toBe(1);
        expect(composited.length).toBeGreaterThan(0);
        const bounds = session.selection!.bounds;
        for (const rect of composited) {
            expect(rect.x >= bounds.x && rect.y >= bounds.y, JSON.stringify(rect)).toBe(true);
            expect(rect.x + rect.width <= bounds.x + bounds.width, JSON.stringify(rect)).toBe(true);
            expect(rect.y + rect.height <= bounds.y + bounds.height, JSON.stringify(rect)).toBe(
                true,
            );
        }
        // The stroke's pixels inside are all there, in the cache's composite too.
        expect(h.errors).toEqual([]);
        expect(
            firstDifference(h.composites.cache!.get(FRAME), compositeFrame(session.doc, FRAME)),
        ).toBeNull();
    });

    it("without a selection every pixel can change", () => {
        const h = harness();
        const session = patterned();
        h.open(session);
        h.editor.getState().setForeground(0x000000ff);
        const image = celImage(session.doc, session.activeLayerId, session.activeFrameId);
        const before = image.data.slice();
        stroke(h, across);
        expect(changed(session, before).length).toBe(WIDTH + HEIGHT - 1);
    });
});
