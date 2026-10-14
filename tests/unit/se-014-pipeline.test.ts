import { describe, expect, it } from "vitest";
import { stretchedMapping } from "../../src/app/overlay/stretchedMapping";
import { PAINT_REFUSED } from "../../src/app/tools/paintTarget";
import { FEEDBACK_MS } from "../../src/app/tools/pipeline";
import type { ToolContext, ToolKey, ToolPointer, ToolSpec } from "../../src/app/tools/types";
import { frameKey } from "../../src/app/viewport/viewportLink";
import { compositeFrame } from "../../src/core/composite";
import { celAt, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import type { Rgba } from "./se-010-support";
import {
    FRAME,
    addFrame,
    celImage,
    firstDifference,
    layerId,
    setCel,
    sprite,
} from "./se-010-support";
import { at, DOT, harness, plainMapping, rgbaAt, stroke } from "./se-014-support";

// SE-014: the pointer pipeline, driven by synthetic pointer sequences (SPEC §5.2, §7.1). The
// dot tool writes one pixel per sample in the colour of its button; strokes are transactions
// of the document's history, shown through the live-stroke path.

const WIDTH = 8;
const HEIGHT = 6;
const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];

/** A one-layer document whose only cel is empty. */
function blank(width = WIDTH, height = HEIGHT): DocSession {
    return createDocument({ name: "blank", width, height }, sequentialIds("blank-"));
}

function fill(pixel: Rgba, width = WIDTH, height = HEIGHT): Rgba[] {
    return new Array<Rgba>(width * height).fill(pixel);
}

/** Three layers with cels at `FRAME`; the middle one, half transparent, is the active one. */
function layered(): DocSession {
    const doc = sprite(WIDTH, HEIGHT, [
        { pixels: fill([10, 20, 30, 255]) },
        { pixels: fill([200, 100, 0, 96]), opacity: 180 },
        { pixels: fill([0, 0, 250, 40]), celOpacity: 200 },
    ]);
    return { doc, selection: null, activeLayerId: layerId(1), activeFrameId: FRAME };
}

describe("a stroke is one transaction of the history", () => {
    it("one down–moves–up yields exactly one history entry, labelled with the tool", () => {
        const h = harness();
        const { history, session } = h.open(blank());
        expect(
            stroke(h, [
                { x: 1, y: 1 },
                { x: 2, y: 1 },
                { x: 3, y: 2 },
                { x: 3, y: 3 },
            ]),
        ).toBe(true);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Dot");
        expect(history.transaction).toBeNull();
        expect(h.pipeline.stroking).toBe(false);
        const image = celImage(session.doc, session.activeLayerId, session.activeFrameId);
        for (const [x, y] of [
            [1, 1],
            [2, 1],
            [3, 2],
            [3, 3],
        ] as const) {
            expect(rgbaAt(image, x, y), `${x}, ${y}`).toEqual(BLACK);
        }
        expect(rgbaAt(image, 0, 0)).toEqual([0, 0, 0, 0]);

        // Undo takes the whole stroke back: the cel the stroke created is gone again.
        expect(history.undo()).toBe(true);
        expect(celAt(session.doc, session.activeLayerId, session.activeFrameId)).toBeUndefined();
        expect(history.canUndo).toBe(false);
    });

    it("keeps the transaction open while the button is held", () => {
        const h = harness();
        const { history } = h.open(blank());
        h.pipeline.down(at(h, { x: 0, y: 0 }, { button: 0 }));
        h.pipeline.move([at(h, { x: 1, y: 0 })]);
        expect(h.pipeline.stroking).toBe(true);
        expect(history.transaction?.open).toBe(true);
        expect(history.undoCount).toBe(0);
        h.pipeline.up(at(h, { x: 1, y: 0 }, { button: 0, buttons: 0 }));
        expect(history.undoCount).toBe(1);
    });

    it("Escape mid-stroke yields no entry and restores the pixels", () => {
        const h = harness();
        const session = layered();
        const { history } = h.open(session);
        const image = celImage(session.doc, layerId(1), FRAME);
        const before = image.data.slice();
        const shown = compositeFrame(session.doc, FRAME);

        h.pipeline.down(at(h, { x: 2, y: 2 }, { button: 0 }));
        h.pipeline.move([at(h, { x: 3, y: 2 }), at(h, { x: 4, y: 3 })]);
        expect(rgbaAt(image, 3, 2)).toEqual(BLACK);
        // What the Escape command runs (tools.commands.ts; se-014-registry tests the binding).
        expect(h.pipeline.cancel()).toBe(true);

        expect(h.pipeline.stroking).toBe(false);
        expect(history.undoCount).toBe(0);
        expect(history.transaction).toBeNull();
        expect(image.data).toEqual(before);
        // The cache shows the restored pixels again.
        expect(firstDifference(h.composites.cache!.get(FRAME), shown)).toBeNull();
        // The rest of the sequence does nothing.
        h.pipeline.move([at(h, { x: 5, y: 3 })]);
        h.pipeline.up(at(h, { x: 5, y: 3 }, { button: 0, buttons: 0 }));
        expect(history.undoCount).toBe(0);
        expect(image.data).toEqual(before);
    });

    it("a pointer cancel aborts like Escape, and removes a cel the stroke created", () => {
        const h = harness();
        const { history, session } = h.open(blank());
        h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 0 }));
        expect(celAt(session.doc, session.activeLayerId, session.activeFrameId)).toBeDefined();
        h.pipeline.cancel();
        expect(celAt(session.doc, session.activeLayerId, session.activeFrameId)).toBeUndefined();
        expect(history.undoCount).toBe(0);
        expect(h.compositeChanges.at(-1)).toEqual([session.activeFrameId]);
    });

    it("a stroke that changes nothing makes no entry", () => {
        const h = harness();
        const { history, session } = h.open(blank());
        // Outside the document: the dot tool writes nothing.
        stroke(h, [
            { x: -2, y: 1 },
            { x: -1, y: 1 },
        ]);
        expect(history.undoCount).toBe(0);
        expect(celAt(session.doc, session.activeLayerId, session.activeFrameId)).toBeUndefined();
    });

    it("the right button paints with the background colour", () => {
        const h = harness();
        const { session, history } = h.open(blank());
        h.editor.getState().setBackground(0x336699ff);
        stroke(h, [{ x: 2, y: 2 }], { button: 2 });
        expect(history.undoCount).toBe(1);
        const image = celImage(session.doc, session.activeLayerId, session.activeFrameId);
        expect(rgbaAt(image, 2, 2)).toEqual([0x33, 0x66, 0x99, 255]);
        h.editor.getState().setBackground(0xffffffff);
        stroke(h, [{ x: 3, y: 2 }], { button: 2 });
        expect(rgbaAt(image, 3, 2)).toEqual(WHITE);
    });

    it("leaves the middle button alone and takes no other pointer during a stroke", () => {
        const h = harness();
        const { history, session } = h.open(blank());
        expect(h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 1, buttons: 4 }))).toBe(false);
        expect(h.pipeline.stroking).toBe(false);

        expect(h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 0 }))).toBe(true);
        expect(h.pipeline.down(at(h, { x: 4, y: 4 }, { button: 0, pointerId: 2 }))).toBe(false);
        h.pipeline.move([at(h, { x: 5, y: 4 }, { pointerId: 2 })]);
        h.pipeline.up(at(h, { x: 5, y: 4 }, { pointerId: 2, buttons: 0 }));
        expect(h.pipeline.stroking).toBe(true);
        h.pipeline.up(at(h, { x: 1, y: 1 }, { button: 0, buttons: 0 }));
        const image = celImage(session.doc, session.activeLayerId, session.activeFrameId);
        expect(rgbaAt(image, 4, 4)).toEqual([0, 0, 0, 0]);
        expect(rgbaAt(image, 5, 4)).toEqual([0, 0, 0, 0]);
        expect(history.undoCount).toBe(1);
    });

    it("ends the stroke when a move reports its button released without a pointer up", () => {
        const h = harness();
        const { history } = h.open(blank());
        h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 0 }));
        // The left button came up while the right one stayed down.
        h.pipeline.move([at(h, { x: 2, y: 1 }, { buttons: 2 })]);
        expect(h.pipeline.stroking).toBe(false);
        expect(history.undoCount).toBe(1);
    });

    it("continues a stroke that leaves the document and comes back while the button is held", () => {
        const h = harness();
        const { history, session } = h.open(blank());
        stroke(h, [
            { x: 6, y: 2 },
            { x: 7, y: 2 },
            // Beside the document, and further out of the viewport element itself.
            { x: 9, y: 2 },
            { x: 40, y: -30 },
            { x: 9, y: 3 },
            { x: 7, y: 3 },
            { x: 5, y: 3 },
        ]);
        expect(history.undoCount).toBe(1);
        const image = celImage(session.doc, session.activeLayerId, session.activeFrameId);
        for (const [x, y] of [
            [6, 2],
            [7, 2],
            [7, 3],
            [5, 3],
        ] as const) {
            expect(rgbaAt(image, x, y), `${x}, ${y}`).toEqual(BLACK);
        }
    });

    it("cancels the stroke when its document is closed or another becomes active", () => {
        const h = harness();
        const first = h.open(blank());
        h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 0 }));
        h.open(createDocument({ name: "other", width: 4, height: 4 }, sequentialIds("other-")));
        expect(h.pipeline.stroking).toBe(false);
        expect(first.history.transaction).toBeNull();
        expect(first.history.undoCount).toBe(0);

        h.sessions.getState().activate(first.id);
        h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 0 }));
        h.sessions.getState().close(first.id);
        expect(h.pipeline.stroking).toBe(false);
        expect(first.history.transaction).toBeNull();
    });

    it("a tool that throws ends its stroke with the pixels restored", () => {
        const failing: ToolSpec = {
            id: "failing",
            label: "Failing",
            paints: true,
            onDown(context, pointer) {
                const at = (pointer.pixel.y * context.paint!.image.width + pointer.pixel.x) * 4;
                context.paint!.image.data.set([1, 2, 3, 255], at);
                context.paint!.markDirty({ ...pointer.pixel, width: 1, height: 1 });
            },
            onMove() {
                throw new Error("broken tool");
            },
        };
        const h = harness([failing]);
        const { history, session } = h.open(blank());
        h.tools.select("failing");
        h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 0 }));
        h.pipeline.move([at(h, { x: 2, y: 1 })]);
        expect(h.pipeline.stroking).toBe(false);
        expect(history.undoCount).toBe(0);
        expect(celAt(session.doc, session.activeLayerId, session.activeFrameId)).toBeUndefined();
        expect(h.errors).toHaveLength(1);
    });
});

describe("handlers and samples", () => {
    function recorder() {
        const calls: string[] = [];
        const pointers: ToolPointer[] = [];
        const contexts: ToolContext[] = [];
        const keys: ToolKey[] = [];
        const tool: ToolSpec = {
            id: "recorder",
            label: "Recorder",
            onDown(context, pointer) {
                calls.push(`down ${pointer.pixel.x},${pointer.pixel.y}`);
                pointers.push(pointer);
                contexts.push(context);
            },
            onMove(_context, pointer) {
                calls.push(`move ${pointer.pixel.x},${pointer.pixel.y}`);
                pointers.push(pointer);
            },
            onUp(_context, pointer) {
                calls.push(`up ${pointer.pixel.x},${pointer.pixel.y}`);
            },
            onCancel() {
                calls.push("cancel");
            },
            onKey(_context, key) {
                keys.push(key);
                calls.push(`key ${key.type} ${key.key}`);
                return key.key === "Shift";
            },
        };
        return { tool, calls, pointers, contexts, keys };
    }

    it("calls down, a move per sample of each event, then up; no transaction for a tool that does not paint", () => {
        const r = recorder();
        const h = harness([r.tool]);
        const { history } = h.open(blank(), { scale: 4, originX: 10, originY: 6 });
        h.tools.select("recorder");
        h.pipeline.down(at(h, { x: 0, y: 0 }, { button: 0, shiftKey: true, timeStamp: 5 }));
        // One event with three coalesced samples.
        h.pipeline.move([at(h, { x: 1, y: 0 }), at(h, { x: 2, y: 1 }), at(h, { x: 3, y: 1 })]);
        h.pipeline.up(at(h, { x: 3, y: 2 }, { button: 0, buttons: 0 }));
        expect(r.calls).toEqual(["down 0,0", "move 1,0", "move 2,1", "move 3,1", "up 3,2"]);
        expect(r.contexts[0]?.paint).toBeNull();
        expect(history.undoCount).toBe(0);
        expect(r.pointers[0]).toMatchObject({
            client: { x: 12, y: 8 },
            device: { x: 12, y: 8 },
            pixel: { x: 0, y: 0 },
            position: { x: 0.5, y: 0.5 },
            inside: true,
            button: "primary",
            modifiers: { shift: true, ctrl: false, alt: false, meta: false },
            time: 5,
        });
    });

    it("maps the right button to secondary and the options to their values", () => {
        const r = recorder();
        r.tool.options = [
            { kind: "number", key: "size", label: "Size", min: 1, max: 64, default: 1 },
            { kind: "toggle", key: "perfect", label: "Pixel-perfect", default: false },
        ];
        const h = harness([r.tool]);
        h.open(blank());
        h.tools.select("recorder");
        h.tools.setOption(h.tools.active()!, "size", 9);
        h.pipeline.down(at(h, { x: 0, y: 0 }, { button: 2, buttons: 2 }));
        expect(r.pointers[0]?.button).toBe("secondary");
        expect(r.contexts[0]?.button).toBe("secondary");
        expect(r.contexts[0]?.colour).toBe(0xffffffff);
        expect(r.contexts[0]?.options).toEqual({ size: 9, perfect: false });
    });

    it("passes keys to the stroke's tool, never Escape, and reports which it used", () => {
        const r = recorder();
        const h = harness([r.tool]);
        h.open(blank());
        h.tools.select("recorder");
        const key = (type: "down" | "up", name: string, shiftKey = false) => ({
            type,
            key: name,
            shiftKey,
            ctrlKey: false,
            altKey: false,
            metaKey: false,
            repeat: false,
        });
        // No stroke: no tool gets keys.
        expect(h.pipeline.key(key("down", "Shift", true))).toBe(false);
        h.pipeline.down(at(h, { x: 0, y: 0 }, { button: 0 }));
        expect(h.pipeline.key(key("down", "Shift", true))).toBe(true);
        expect(h.pipeline.key(key("down", "B"))).toBe(false);
        expect(h.pipeline.key(key("down", "Escape"))).toBe(false);
        expect(h.pipeline.key(key("up", "Shift"))).toBe(true);
        expect(r.calls.slice(1)).toEqual(["key down Shift", "key down B", "key up Shift"]);
        expect(r.keys[0]?.modifiers.shift).toBe(true);
        expect(h.pipeline.cancel()).toBe(true);
        expect(r.calls.at(-1)).toBe("cancel");
    });

    it("keeps the tool of the pointer down for the whole stroke", () => {
        const r = recorder();
        const h = harness([r.tool]);
        h.open(blank());
        h.tools.select("recorder");
        h.pipeline.down(at(h, { x: 0, y: 0 }, { button: 0 }));
        h.tools.hold(DOT);
        expect(h.tools.activeId()).toBe(DOT);
        h.pipeline.move([at(h, { x: 1, y: 0 })]);
        expect(h.pipeline.strokeTool?.id).toBe("recorder");
        h.pipeline.up(at(h, { x: 1, y: 0 }, { button: 0, buttons: 0 }));
        expect(r.calls).toEqual(["down 0,0", "move 1,0", "up 1,0"]);
    });

    it("does nothing without an active registered tool, a document or a viewport", () => {
        const h = harness();
        const press = {
            pointerId: 1,
            button: 0,
            buttons: 1,
            clientX: 4,
            clientY: 4,
            shiftKey: false,
            ctrlKey: false,
            altKey: false,
            metaKey: false,
            timeStamp: 0,
        };
        expect(h.pipeline.down(press)).toBe(false);
        h.open(blank());
        h.editor.getState().setTool("pencil");
        expect(h.tools.active()).toBeNull();
        expect(h.pipeline.down(at(h, { x: 0, y: 0 }, { button: 0 }))).toBe(false);
        h.tools.select(DOT);
        h.mapping = () => null;
        expect(h.pipeline.down(at(h, { x: 0, y: 0 }, { button: 0 }))).toBe(false);
    });
});

describe("paint target and guards", () => {
    const refusals: [string, (session: DocSession) => void, string][] = [
        ["locked", (session) => void (session.doc.layers[0]!.locked = true), PAINT_REFUSED.locked],
        [
            "hidden",
            (session) => void (session.doc.layers[0]!.visible = false),
            PAINT_REFUSED.hidden,
        ],
        [
            "a reference layer",
            (session) => {
                session.doc.layers.push({
                    id: "reference",
                    name: "Reference",
                    kind: "reference",
                    visible: true,
                    locked: false,
                    opacity: 128,
                    sourceId: "source",
                    x: 0,
                    y: 0,
                    scale: 1,
                    placement: "behind",
                });
                session.activeLayerId = "reference";
            },
            PAINT_REFUSED.reference,
        ],
    ];

    for (const [name, change, message] of refusals) {
        it(`refuses paint on ${name} layer with a status-bar message and changes no pixel`, () => {
            const h = harness();
            const session = blank();
            const { history } = h.open(session);
            change(session);
            expect(
                stroke(h, [
                    { x: 1, y: 1 },
                    { x: 2, y: 1 },
                ]),
            ).toBe(false);
            expect(history.undoCount).toBe(0);
            expect(history.transaction).toBeNull();
            expect(session.doc.cels.size).toBe(0);
            expect(h.status.getState().feedback).toBe(message);
        });
    }

    it("refuses paint below 1×: at an overview step the pointer cannot name the texel shown", () => {
        const h = harness();
        for (const scale of [1 / 2, 1 / 4, 1 / 8]) {
            const { history, id } = h.open(blank(64, 64), { scale, originX: 0, originY: 0 });
            expect(stroke(h, [{ x: 4, y: 4 }]), `${scale}`).toBe(false);
            expect(history.undoCount).toBe(0);
            expect(h.status.getState().feedback).toBe(PAINT_REFUSED.overview);
            h.sessions.getState().close(id);
        }
        // From 1× up it paints.
        const { history } = h.open(blank(64, 64), { scale: 1, originX: 0, originY: 0 });
        expect(stroke(h, [{ x: 4, y: 4 }])).toBe(true);
        expect(history.undoCount).toBe(1);
        expect(h.status.getState().feedback).toBeNull();
    });

    it("lets a tool that does not paint act on a locked layer and below 1×", () => {
        const calls: string[] = [];
        const look: ToolSpec = { id: "look", label: "Look", onDown: () => void calls.push("down") };
        const h = harness([look]);
        const session = blank();
        h.open(session, { scale: 1 / 2, originX: 0, originY: 0 });
        session.doc.layers[0]!.locked = true;
        h.tools.select("look");
        expect(h.pipeline.down(at(h, { x: 0, y: 0 }, { button: 0 }))).toBe(true);
        expect(calls).toEqual(["down"]);
        expect(h.status.getState().feedback).toBeNull();
    });

    it("clears its message at the next press and after the toast time, not someone else's", () => {
        const h = harness();
        const session = blank();
        h.open(session);
        session.doc.layers[0]!.locked = true;
        stroke(h, [{ x: 1, y: 1 }]);
        expect(h.status.getState().feedback).toBe(PAINT_REFUSED.locked);
        h.timers.advance(FEEDBACK_MS - 1);
        expect(h.status.getState().feedback).toBe(PAINT_REFUSED.locked);
        h.timers.advance(1);
        expect(h.status.getState().feedback).toBeNull();

        stroke(h, [{ x: 1, y: 1 }]);
        session.doc.layers[0]!.locked = false;
        expect(stroke(h, [{ x: 1, y: 1 }])).toBe(true);
        expect(h.status.getState().feedback).toBeNull();

        session.doc.layers[0]!.locked = true;
        stroke(h, [{ x: 1, y: 1 }]);
        h.status.getState().setFeedback("Selection 3 × 2");
        h.timers.advance(FEEDBACK_MS);
        expect(h.status.getState().feedback).toBe("Selection 3 × 2");
    });
});

describe("the live-stroke display path", () => {
    it("shows the stroke in the cache's composite while the button is held", () => {
        const h = harness();
        const session = layered();
        h.open(session);
        const cache = h.composites.cache!;
        h.pipeline.down(at(h, { x: 2, y: 2 }, { button: 0 }));
        h.pipeline.move([at(h, { x: 3, y: 2 })]);
        h.frames.run();
        h.pipeline.move([at(h, { x: 4, y: 2 })]);
        h.frames.run();
        // The composite the viewport reads is the live one, up to date with the stroke.
        const live = cache.get(FRAME);
        expect(firstDifference(live, compositeFrame(session.doc, FRAME))).toBeNull();
        expect(h.invalidated.every((keys) => keys !== "all" && keys[0] === frameKey(FRAME))).toBe(
            true,
        );
        h.pipeline.up(at(h, { x: 4, y: 2 }, { button: 0, buttons: 0 }));
    });

    it("tells the viewport at most once per animation frame", () => {
        const h = harness();
        h.open(layered());
        h.pipeline.down(at(h, { x: 0, y: 0 }, { button: 0 }));
        // The first change of a frame is shown at once.
        expect(h.invalidated).toHaveLength(1);
        for (let x = 1; x < WIDTH; x++) h.pipeline.move([at(h, { x, y: 0 })]);
        expect(h.invalidated).toHaveLength(1);
        h.frames.run();
        // What came after it in that frame, in the next one.
        expect(h.invalidated).toHaveLength(2);
        h.pipeline.move([at(h, { x: 0, y: 1 })]);
        h.pipeline.move([at(h, { x: 1, y: 1 })]);
        expect(h.invalidated).toHaveLength(2);
        h.frames.run();
        expect(h.invalidated).toHaveLength(3);
        // A frame with nothing new tells nothing, and asks for no further frame.
        h.frames.run();
        expect(h.invalidated).toHaveLength(3);
        expect(h.frames.pending).toBe(0);
        // Idle again: the next change is shown at once.
        h.pipeline.move([at(h, { x: 2, y: 1 })]);
        expect(h.invalidated).toHaveLength(4);
        h.pipeline.up(at(h, { x: 2, y: 1 }, { button: 0, buttons: 0 }));
        // The stroke's end asks for no frame of its own: the history step reaches the viewport.
        h.frames.run();
        expect(h.invalidated).toHaveLength(4);
    });

    for (const [name, make] of [
        ["on a cel with pixels under and over other layers", layered],
        ["on an empty cel, which the stroke creates", () => blank()],
    ] as const) {
        it(`after a committed stroke the cache returns the adopted buffer, equal to a full composite, ${name}`, () => {
            const h = harness();
            const session = make();
            const { history } = h.open(session);
            const frameId = session.activeFrameId;
            const cache = h.composites.cache!;
            cache.get(frameId);
            h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 0 }));
            const live = cache.get(frameId);
            h.pipeline.move([at(h, { x: 2, y: 1 }), at(h, { x: 2, y: 2 })]);
            h.frames.run();
            h.pipeline.move([at(h, { x: 3, y: 3 })]);
            // A sentinel: one pixel written into an image of the frame and reported to nobody,
            // at a texel the stroke never touches. A full composite of the frame would show
            // it; compositing the stroke's dirty rectangles does not.
            const planted =
                session.doc.layers.length > 1
                    ? celImage(session.doc, layerId(0), frameId)
                    : celImage(session.doc, session.activeLayerId, frameId);
            const sentinel = { x: 6, y: 4 };
            const at64 = (sentinel.y * planted.width + sentinel.x) * 4;
            const original = planted.data.slice(at64, at64 + 4);
            planted.data.set([9, 99, 199, 255], at64);
            const shown = rgbaAt(live, sentinel.x, sentinel.y);

            h.pipeline.up(at(h, { x: 3, y: 3 }, { button: 0, buttons: 0 }));
            expect(history.undoCount).toBe(1);
            // The history step dropped the frame's composite; the stroke handed its own back.
            expect(h.compositeChanges.at(-1)).toEqual([frameId]);
            expect(cache.has(frameId)).toBe(true);
            // Not composited again: a composite of the cache's own would be a new buffer, and
            // a full composite into the live one would show the sentinel.
            expect(cache.get(frameId)).toBe(live);
            expect(rgbaAt(live, sentinel.x, sentinel.y)).toEqual(shown);
            expect(
                rgbaAt(compositeFrame(session.doc, frameId), sentinel.x, sentinel.y),
            ).not.toEqual(shown);
            planted.data.set(original, at64);
            expect(firstDifference(live, compositeFrame(session.doc, frameId))).toBeNull();

            // Undo is an ordinary history step: the frame is composited anew from the pixels.
            history.undo();
            const undone = cache.get(frameId);
            expect(undone).not.toBe(live);
            expect(firstDifference(undone, compositeFrame(session.doc, frameId))).toBeNull();
        });
    }

    it("hands the live composite back to the cache when the cache let it go during the stroke", () => {
        const h = harness();
        const session = layered();
        addFrame(session.doc, "frame-1");
        setCel(session.doc, layerId(0), "frame-1", fill([5, 5, 5, 255]));
        h.open(session);
        const cache = h.composites.cache!;
        // Room for one composite.
        Object.defineProperty(cache, "budgetBytes", { value: WIDTH * HEIGHT * 4 });
        h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 0 }));
        const live = cache.get(FRAME);
        // Another reader asks for frame 1: the live composite is the least recently used.
        cache.get("frame-1");
        expect(cache.has(FRAME)).toBe(false);
        // The viewport asks for the stroked frame again: the cache composites one of its own.
        const own = cache.get(FRAME);
        expect(own).not.toBe(live);

        h.pipeline.move([at(h, { x: 2, y: 1 })]);
        h.frames.run();
        h.pipeline.move([at(h, { x: 3, y: 1 })]);
        h.frames.run();
        // The stroke goes on showing: the live composite is the frame's again, up to date.
        expect(cache.get(FRAME)).toBe(live);
        expect(firstDifference(cache.get(FRAME), compositeFrame(session.doc, FRAME))).toBeNull();
        h.pipeline.up(at(h, { x: 3, y: 1 }, { button: 0, buttons: 0 }));
        expect(firstDifference(cache.get(FRAME), compositeFrame(session.doc, FRAME))).toBeNull();
    });

    it("takes the stroke back, with one error, when the frame cannot be composited at the release", () => {
        const h = harness();
        const session = layered();
        const { history } = h.open(session);
        const image = celImage(session.doc, layerId(1), FRAME);
        const before = image.data.slice();
        h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 0 }));
        // Shown in the next animation frame: pending at the release.
        h.pipeline.move([at(h, { x: 2, y: 1 })]);
        // The painted layer turns into a reference layer under the stroke.
        Object.assign(session.doc.layers[1]!, {
            kind: "reference",
            sourceId: "source",
            x: 0,
            y: 0,
            scale: 1,
            placement: "behind",
        });
        h.pipeline.up(at(h, { x: 2, y: 1 }, { button: 0, buttons: 0 }));
        expect(history.transaction).toBeNull();
        expect(h.pipeline.stroking).toBe(false);
        expect(h.errors).toHaveLength(1);
        expect(history.undoCount).toBe(0);
        expect(image.data).toEqual(before);
    });

    it("drops the live composite after an abort, so the restored pixels are composited", () => {
        const h = harness();
        const session = layered();
        h.open(session);
        const cache = h.composites.cache!;
        const before = compositeFrame(session.doc, FRAME);
        h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 0 }));
        const live = cache.get(FRAME);
        h.pipeline.cancel();
        expect(h.compositeChanges.at(-1)).toEqual([FRAME]);
        expect(cache.get(FRAME)).not.toBe(live);
        expect(firstDifference(cache.get(FRAME), before)).toBeNull();
        expect(h.frames.pending).toBe(0);
    });

    it("drops the composites of the other frames a linked cel shows while it is stroked", () => {
        const h = harness();
        const session = layered();
        addFrame(session.doc, "frame-1");
        addFrame(session.doc, "frame-2");
        // Frame 1 shows the active layer's image too; frame 2 has a cel of its own.
        const linked = session.doc.cels.get(`${layerId(1)}:${FRAME}`)!;
        session.doc.cels.set(`${layerId(1)}:frame-1`, { ...linked });
        setCel(session.doc, layerId(1), "frame-2", fill([1, 1, 1, 255]));
        h.open(session);
        h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 0 }));
        expect(h.compositeChanges).toEqual([["frame-1"]]);
        h.pipeline.up(at(h, { x: 1, y: 1 }, { button: 0, buttons: 0 }));
        expect(h.compositeChanges.at(-1)).toEqual([FRAME, "frame-1"]);
    });

    it("works without a cache to adopt into: the frame's composite is dropped instead", () => {
        const h = harness();
        const session = layered();
        h.open(session);
        // Over the budget: nothing can be kept.
        const cache = h.composites.cache!;
        Object.defineProperty(cache, "budgetBytes", { value: 0 });
        h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 0 }));
        expect(h.invalidated).toEqual([]);
        expect(h.compositeChanges).toEqual([[FRAME]]);
        expect(firstDifference(cache.get(FRAME), compositeFrame(session.doc, FRAME))).toBeNull();
        h.pipeline.up(at(h, { x: 1, y: 1 }, { button: 0, buttons: 0 }));
    });
});

describe("the texel a stroke paints during NGNE's resize quiet", () => {
    it("is the texel shown under the pointer, as the overlay's cursor names it", () => {
        const h = harness();
        const { session } = h.open(blank(16, 16), { scale: 8, originX: 0, originY: 0 });
        // The element grew from 128 × 128 to 160 × 160 device pixels; NGNE still shows its
        // 128 × 128 canvas stretched over it (SPEC §6.4), and so does the overlay.
        const backing = { width: 128, height: 128 };
        const box = { width: 160, height: 160 };
        h.mapping = () => stretchedMapping(plainMapping(h.sessions)!, backing, box);
        // Client 100, 60: device 100, 60 of the element, 80, 48 of the canvas shown there.
        const input = { ...at(h, { x: 0, y: 0 }, { button: 0 }), clientX: 100, clientY: 60 };
        expect(plainMapping(h.sessions)!.clientToDoc(100, 60)).toEqual({ x: 12, y: 7 });
        h.pipeline.down(input);
        h.pipeline.up({ ...input, buttons: 0 });
        const image = celImage(session.doc, session.activeLayerId, session.activeFrameId);
        expect(rgbaAt(image, 10, 6)).toEqual(BLACK);
        expect(rgbaAt(image, 12, 7)).toEqual([0, 0, 0, 0]);
    });
});

describe("colours", () => {
    it("writes the foreground colour with the dot tool's alpha option", () => {
        const h = harness();
        const { session } = h.open(blank());
        h.editor.getState().setForeground(0x10203080);
        h.tools.setOption(h.tools.active()!, "alpha", 128);
        stroke(h, [{ x: 0, y: 0 }]);
        const image = celImage(session.doc, session.activeLayerId, session.activeFrameId);
        expect(rgbaAt(image, 0, 0)).toEqual([0x10, 0x20, 0x30, 64]);
    });
});
