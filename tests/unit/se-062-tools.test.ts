import { afterEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import { createPreferenceStore } from "../../src/app/preferences/preferences";
import { activeDocument, isDirty, sessionsStore } from "../../src/app/state/sessions";
import { axisGeometry, handleAt } from "../../src/app/symmetry/axisGeometry";
import { createAxisGrab } from "../../src/app/symmetry/axisDrag";
import { setSymmetry, setTiledMode } from "../../src/app/symmetry/symmetry";
import {
    SYMMETRY_X_COMMAND,
    SYMMETRY_Y_COMMAND,
    TILED_X_COMMAND,
    TILED_Y_COMMAND,
} from "../../src/app/symmetry/symmetry.commands";
import { bucketTool } from "../../src/app/tools/bucket/bucket.tools";
import { INK, OPACITY } from "../../src/app/tools/brush/brushOptions";
import { contourTool } from "../../src/app/tools/contour/contour.tools";
import { eraserTool } from "../../src/app/tools/eraser/eraser.tools";
import { pencilTool } from "../../src/app/tools/pencil/pencil.tools";
import { createToolPipeline } from "../../src/app/tools/pipeline";
import type { ToolPipeline } from "../../src/app/tools/pipeline";
import { polygonTool } from "../../src/app/tools/polygon/polygon.tools";
import { FILLED } from "../../src/app/tools/shapes/shapeTool";
import { rectangleTool } from "../../src/app/tools/shapes/shapes.tools";
import { createStrokeEcho } from "../../src/app/tools/strokeEcho";
import {
    createStrokeEchoLayer,
    echoPixels,
    NO_COVER,
    tiledOffsets,
} from "../../src/app/tools/strokeEcho.overlay";
import type { EchoCover } from "../../src/app/tools/strokeEcho.overlay";
import { DEFAULT_OVERLAY_THEME } from "../../src/app/overlay/types";
import type { OpenDocument } from "../../src/app/state/sessions";
import { QUAD_LAYER } from "../../src/engine/viewport/geometry";
import { replaceSceneDocument, ViewportSlots } from "../../src/engine/viewport/viewportSlots";
import type { Scene } from "../../src/engine/viewport/viewportSlots";
import { bitmap, FakeRenderer, flush, RecordingViewport } from "./se-011-support";
import { createSprayTool } from "../../src/app/tools/spray/sprayTool";
import type { ToolSpec } from "../../src/app/tools/types";
import { createViewMapping } from "../../src/app/view/coordinates";
import { connectViewport } from "../../src/app/viewport/viewportController";
import { createActiveComposites } from "../../src/app/state/composites";
import { createSessionsStore } from "../../src/app/state/sessions";
import { celAt, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import { createPixelBuffer } from "../../src/core/pixels";
import { deserialize, serialize } from "../../src/core/project";
import { paintInk } from "../../src/core/raster";
import { tiledCopies } from "../../src/engine/viewport/geometry";
import type { Quad } from "../../src/engine/viewport/geometry";
import { FRAME, celImage, layerId, sprite } from "./se-010-support";
import type { Rgba } from "./se-010-support";

import { at, harness, rgbaAt, stroke } from "./se-014-support";
import type { Harness } from "./se-014-support";

// SE-062 in the app: the paint tools read the document's symmetry and tiled mode at each press
// (through the options of `Stamper` and `ShapeStroke`, so the SE-065 tool modules need no
// edit); the settings are view preferences (no history entry, never dirty, saved); the View
// menu chooses them; a press on an axis's handle drags the axis; the viewport repeats the
// frame in tiled mode and the stroke echo draws each copy.

const WIDTH = 16;
const HEIGHT = 12;
const RED = 0xff0000ff;

const TOOLS: readonly ToolSpec[] = [
    pencilTool,
    eraserTool,
    rectangleTool,
    bucketTool,
    contourTool,
    polygonTool,
    createSprayTool({ next: () => 7 }),
];

let blanks = 0;
function blank(width = WIDTH, height = HEIGHT): DocSession {
    blanks++;
    return createDocument({ name: "blank", width, height }, sequentialIds(`blank${blanks}-`));
}

/** One layer of one opaque colour. */
function filled(width: number, height: number, colour: Rgba): DocSession {
    const pixels: Rgba[] = Array.from({ length: width * height }, () => colour);
    const doc = sprite(width, height, [{ pixels }]);
    return { doc, selection: null, activeLayerId: layerId(0), activeFrameId: FRAME };
}

function tools(tool: string): Harness {
    const h = harness(TOOLS);
    h.tools.select(tool);
    h.editor.getState().setForeground(RED);
    return h;
}

/** The active cel's image; transparent while the cel is empty. */
function image(session: DocSession): PixelBuffer {
    const { doc, activeLayerId, activeFrameId } = session;
    if (!celAt(doc, activeLayerId, activeFrameId)) {
        return createPixelBuffer(doc.width, doc.height, 0);
    }
    return celImage(doc, activeLayerId, activeFrameId);
}

function mirroredLeftRight(buffer: PixelBuffer): boolean {
    for (let y = 0; y < buffer.height; y++) {
        for (let x = 0; x < buffer.width; x++) {
            const a = rgbaAt(buffer, x, y);
            const b = rgbaAt(buffer, buffer.width - 1 - x, y);
            if (a.join() !== b.join()) return false;
        }
    }
    return true;
}

function mirroredTopBottom(buffer: PixelBuffer): boolean {
    for (let y = 0; y < buffer.height; y++) {
        for (let x = 0; x < buffer.width; x++) {
            if (rgbaAt(buffer, x, y).join() !== rgbaAt(buffer, x, buffer.height - 1 - y).join()) {
                return false;
            }
        }
    }
    return true;
}

/** The pixels of `buffer` that are not transparent, `x,y`, sorted. */
function opaque(buffer: PixelBuffer): string[] {
    const keys: string[] = [];
    for (let y = 0; y < buffer.height; y++) {
        for (let x = 0; x < buffer.width; x++)
            if (rgbaAt(buffer, x, y)[3]! > 0) keys.push(`${x},${y}`);
    }
    return keys.sort();
}

/** Sets the symmetry of the harness's active document. */
function symmetry(
    h: Harness,
    mode: "none" | "x" | "y" | "both",
    axes: { axisX?: number; axisY?: number } = {},
) {
    setSymmetry({ mode, ...axes }, h.document().id, h.sessions);
}

describe("paint tools with symmetry", () => {
    it("a pencil stroke with horizontal symmetry on an even-width canvas is a pixel-exact mirror, one undo step", () => {
        const h = tools("pencil");
        const document = h.open(blank());
        symmetry(h, "x");
        expect(document.session.doc.settings.symmetry.axisX).toBe(WIDTH);
        stroke(h, [
            { x: 1, y: 1 },
            { x: 5, y: 3 },
            { x: 2, y: 9 },
        ]);
        const result = image(document.session);
        expect(mirroredLeftRight(result)).toBe(true);
        expect(rgbaAt(result, 1, 1)).toEqual([255, 0, 0, 255]);
        expect(rgbaAt(result, WIDTH - 2, 1)).toEqual([255, 0, 0, 255]);
        expect(document.history.undoCount).toBe(1);
        document.history.undo();
        expect(opaque(image(document.session))).toEqual([]);
    });

    it("an axis through the middle column of an odd-width canvas paints that column once", () => {
        const h = tools("pencil");
        const document = h.open(filled(9, 6, [32, 128, 192, 255]));
        // A new axis lies on the canvas's centre: through the middle of column 4.
        symmetry(h, "x");
        expect(document.session.doc.settings.symmetry.axisX).toBe(9);
        const pencil = h.tools.active()!;
        h.tools.setOption(pencil, INK.key, "alpha");
        h.tools.setOption(pencil, OPACITY.key, 128);
        stroke(h, [
            { x: 4, y: 0 },
            { x: 4, y: 5 },
        ]);
        const once = { width: 1, height: 1, data: new Uint8ClampedArray([32, 128, 192, 255]) };
        paintInk("alpha", RED, 128).apply(once.data, new Uint8ClampedArray([32, 128, 192, 255]), 0);
        for (let y = 0; y < 6; y++)
            expect(rgbaAt(image(document.session), 4, y)).toEqual(rgbaAt(once, 0, 0));
    });

    it("the eraser, the rectangle, the contour, the polygon and the spray are mirrored as well", () => {
        for (const [tool, draw] of [
            [
                "rectangle",
                (h: Harness) =>
                    stroke(h, [
                        { x: 1, y: 1 },
                        { x: 4, y: 3 },
                    ]),
            ],
            [
                "contour",
                (h: Harness) =>
                    stroke(h, [
                        { x: 1, y: 1 },
                        { x: 5, y: 1 },
                        { x: 3, y: 4 },
                    ]),
            ],
            [
                "spray",
                (h: Harness) =>
                    stroke(h, [
                        { x: 3, y: 3 },
                        { x: 5, y: 4 },
                    ]),
            ],
            [
                "polygon",
                (h: Harness) => {
                    for (const pixel of [
                        { x: 1, y: 1 },
                        { x: 5, y: 2 },
                        { x: 2, y: 4 },
                    ]) {
                        h.pipeline.down(at(h, pixel, { button: 0, buttons: 1 }));
                        h.pipeline.up(at(h, pixel, { button: 0, buttons: 0 }));
                    }
                    h.pipeline.closeGesture();
                },
            ],
        ] as const) {
            const h = tools(tool);
            const document = h.open(blank());
            symmetry(h, "both");
            if (tool === "rectangle" || tool === "polygon")
                h.tools.setOption(h.tools.active()!, FILLED.key, true);
            draw(h);
            const result = image(document.session);
            expect(opaque(result).length, tool).toBeGreaterThan(0);
            expect(mirroredLeftRight(result), tool).toBe(true);
            expect(mirroredTopBottom(result), tool).toBe(true);
            expect(document.history.undoCount, tool).toBe(1);
        }

        const h = tools("eraser");
        const document = h.open(filled(WIDTH, HEIGHT, [0, 0, 255, 255]));
        symmetry(h, "y");
        stroke(h, [
            { x: 2, y: 1 },
            { x: 6, y: 2 },
        ]);
        const erased = image(document.session);
        expect(rgbaAt(erased, 2, 1)).toEqual([0, 0, 0, 0]);
        expect(rgbaAt(erased, 2, HEIGHT - 2)).toEqual([0, 0, 0, 0]);
        expect(mirroredTopBottom(erased)).toBe(true);
    });

    it("the bucket fills from every mirrored seed and inks each pixel once", () => {
        const h = tools("bucket");
        const document = h.open(filled(WIDTH, HEIGHT, [255, 255, 255, 255]));
        symmetry(h, "x");
        const bucket = h.tools.active()!;
        h.tools.setOption(bucket, INK.key, "alpha");
        h.tools.setOption(bucket, OPACITY.key, 128);
        // One white area holds both seeds: painted seed by seed it would be inked twice.
        stroke(h, [{ x: 2, y: 2 }]);
        const once = new Uint8ClampedArray([255, 255, 255, 255]);
        paintInk("alpha", RED, 128).apply(once, new Uint8ClampedArray([255, 255, 255, 255]), 0);
        const result = image(document.session);
        for (const [x, y] of [
            [2, 2],
            [WIDTH - 3, 2],
            [8, 11],
        ]) {
            expect(rgbaAt(result, x!, y!)).toEqual(Array.from(once));
        }
        expect(document.history.undoCount).toBe(1);
    });

    it("the bucket's mirrored seed fills its own area", () => {
        // Two white areas split by a black column; the press is in the left one.
        const pixels: Rgba[] = [];
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 9; x++)
                pixels.push(x === 4 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
        }
        const session = {
            doc: sprite(9, 4, [{ pixels }]),
            selection: null,
            activeLayerId: layerId(0),
            activeFrameId: FRAME,
        };
        const h = tools("bucket");
        const document = h.open(session);
        symmetry(h, "x");
        stroke(h, [{ x: 1, y: 1 }]);
        const result = image(document.session);
        expect(rgbaAt(result, 0, 0)).toEqual([255, 0, 0, 255]);
        expect(rgbaAt(result, 8, 3)).toEqual([255, 0, 0, 255]);
        expect(rgbaAt(result, 4, 0)).toEqual([0, 0, 0, 255]);
    });

    it("a stroke keeps the symmetry of its press", () => {
        const h = tools("pencil");
        const document = h.open(blank());
        h.pipeline.down(at(h, { x: 1, y: 1 }, { button: 0, buttons: 1 }));
        symmetry(h, "x");
        h.pipeline.move([at(h, { x: 3, y: 1 }, { button: -1, buttons: 1 })]);
        h.pipeline.up(at(h, { x: 3, y: 1 }, { button: 0, buttons: 0 }));
        expect(opaque(image(document.session))).toEqual(["1,1", "2,1", "3,1"]);
    });
});

describe("paint tools in tiled mode", () => {
    it("a pencil stroke crossing the right edge continues from the left edge", () => {
        const h = tools("pencil");
        const document = h.open(blank());
        setTiledMode("x", h.sessions);
        // The pointer leaves the document on the right: it is over the copy there.
        stroke(h, [
            { x: WIDTH - 2, y: 4 },
            { x: WIDTH + 2, y: 4 },
        ]);
        expect(opaque(image(document.session))).toEqual(
            [`${WIDTH - 2},4`, `${WIDTH - 1},4`, "0,4", "1,4", "2,4"].sort(),
        );
        expect(document.history.undoCount).toBe(1);
    });

    it("a press on a copy paints the pixel it shows, the bucket's too", () => {
        const h = tools("pencil");
        const document = h.open(blank());
        setTiledMode("both", h.sessions);
        stroke(h, [{ x: -3, y: HEIGHT + 2 }]);
        expect(opaque(image(document.session))).toEqual([`${WIDTH - 3},2`]);

        const bucket = tools("bucket");
        const other = bucket.open(blank(4, 4));
        setTiledMode("both", bucket.sessions);
        stroke(bucket, [{ x: 5, y: -1 }]);
        expect(opaque(image(other.session)).length).toBe(16);
        // Without tiled mode a press off the document fills nothing.
        setTiledMode("none", bucket.sessions);
        other.history.undo();
        stroke(bucket, [{ x: 5, y: -1 }]);
        expect(opaque(image(other.session))).toEqual([]);
    });
});

describe("the settings", () => {
    it("change with no history entry, leave the document clean, and are saved", async () => {
        const h = tools("pencil");
        const document = h.open(blank());
        const before = document.history.undoCount;
        symmetry(h, "both", { axisX: 9, axisY: 3 });
        setTiledMode("y", h.sessions);
        const now = activeDocument(h.sessions.getState())!;
        expect(now.history.undoCount).toBe(before);
        expect(isDirty(now)).toBe(false);
        const project = await deserialize(serialize(now.session.doc, new Map()));
        expect(project.doc.settings.symmetry).toEqual({ mode: "both", axisX: 9, axisY: 3 });
        expect(project.doc.settings.tiled).toBe("y");
    });

    it("an axis is clamped to the canvas", () => {
        const h = tools("pencil");
        const document = h.open(blank());
        symmetry(h, "x", { axisX: -5, axisY: 999 });
        expect(document.session.doc.settings.symmetry).toMatchObject({
            axisX: 0,
            axisY: 2 * HEIGHT,
        });
    });
});

describe("View menu", () => {
    afterEach(() => {
        for (const open of sessionsStore.getState().documents)
            sessionsStore.getState().close(open.id);
    });

    const command = (id: string) => {
        const found = appCommands.get(id);
        if (!found) throw new Error(`no command ${id}`);
        return found;
    };
    const TOGGLES = [SYMMETRY_X_COMMAND, SYMMETRY_Y_COMMAND, TILED_X_COMMAND, TILED_Y_COMMAND];

    it("take the places planned for Symmetry and Tiled Mode, in their group, in order, without keys", () => {
        expect(appCommands.get("view.symmetry")).toBeUndefined();
        expect(appCommands.get("view.tiled")).toBeUndefined();
        const view = menuCommands(buildMenu(appCommands.list(), ["View"])).map((entry) => entry.id);
        const first = view.indexOf(SYMMETRY_X_COMMAND);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(view.slice(first, first + 4)).toEqual(TOGGLES);
        const planned = plannedCommands.find((entry) => entry.id === "view.symmetry")!;
        for (const id of TOGGLES) {
            const toggle = command(id);
            expect(toggle.menuPath).toEqual(["View"]);
            expect(Math.floor(toggle.menuOrder / 100)).toBe(Math.floor(planned.menuOrder! / 100));
            expect(toggle.shortcuts).toEqual([]);
        }
    });

    it("switch each axis of the active document on and off; titles say what choosing them does; no history, clean", async () => {
        for (const id of TOGGLES) expect(command(id).enabled()).toBe(false);
        const document = sessionsStore
            .getState()
            .open(createDocument({ name: "hero", width: 8, height: 8 }));
        const settings = () => document.session.doc.settings;
        const titles = () => TOGGLES.map((id) => command(id).title());
        for (const id of TOGGLES) expect(command(id).enabled()).toBe(true);
        expect(titles()).toEqual([
            "Turn On Horizontal Symmetry",
            "Turn On Vertical Symmetry",
            "Turn On Tiling in X",
            "Turn On Tiling in Y",
        ]);
        await command(SYMMETRY_X_COMMAND).run();
        expect(settings().symmetry.mode).toBe("x");
        await command(SYMMETRY_Y_COMMAND).run();
        expect(settings().symmetry.mode).toBe("both");
        await command(TILED_Y_COMMAND).run();
        expect(settings().tiled).toBe("y");
        expect(titles()).toEqual([
            "Turn Off Horizontal Symmetry",
            "Turn Off Vertical Symmetry",
            "Turn On Tiling in X",
            "Turn Off Tiling in Y",
        ]);
        await command(SYMMETRY_X_COMMAND).run();
        expect(settings().symmetry.mode).toBe("y");
        await command(TILED_X_COMMAND).run();
        expect(settings().tiled).toBe("both");
        await command(TILED_Y_COMMAND).run();
        await command(TILED_X_COMMAND).run();
        expect(settings().tiled).toBe("none");
        // The axes stay where they were.
        expect(settings().symmetry).toMatchObject({ axisX: 8, axisY: 8 });
        const open = activeDocument(sessionsStore.getState())!;
        expect(open.history.undoCount).toBe(0);
        expect(isDirty(open)).toBe(false);
    });
});

/** A pipeline on the harness's stores that grabs the axes' handles. */
function grabbing(h: Harness): ToolPipeline {
    return createToolPipeline({
        sessions: h.sessions,
        composites: h.composites,
        viewport: { invalidate: () => {} },
        status: h.status,
        editor: h.editor,
        tools: h.tools,
        mapping: () => h.mapping(),
        nextFrame: h.frames.request,
        later: h.timers.set,
        onError: (error) => void h.errors.push(error),
        grab: createAxisGrab(h.sessions),
    });
}

describe("dragging an axis", () => {
    it("the axes lie on the first device pixel at their position, their handles outside the document", () => {
        const mapping = createViewMapping({
            view: { scale: 8, originX: 20, originY: 10 },
            docWidth: 9,
            docHeight: 6,
            ratio: 1,
            left: 0,
            top: 0,
        });
        const geometry = axisGeometry(mapping, { mode: "both", axisX: 9, axisY: 6 });
        // x = 4.5 texels → device 20 + 36; y = 3 texels → device 10 + 24.
        expect(geometry.lines).toEqual([
            { axis: "x", at: 56, rect: { x: 56, y: 10, width: 1, height: 48 } },
            { axis: "y", at: 34, rect: { x: 20, y: 34, width: 72, height: 1 } },
        ]);
        for (const { axis, rect } of geometry.handles) {
            const outside =
                rect.y + rect.height <= mapping.rect.y - 1 ||
                rect.y >= mapping.rect.y + mapping.rect.height + 1 ||
                rect.x + rect.width <= mapping.rect.x - 1 ||
                rect.x >= mapping.rect.x + mapping.rect.width + 1;
            expect(outside, axis).toBe(true);
        }
        expect(handleAt(geometry, { x: 56, y: 3 }, 1)).toBe("x");
        expect(handleAt(geometry, { x: 15, y: 34 }, 1)).toBe("y");
        expect(handleAt(geometry, { x: 40, y: 30 }, 1)).toBeNull();
        expect(axisGeometry(mapping, { mode: "none", axisX: 9, axisY: 6 })).toEqual({
            lines: [],
            handles: [],
        });
    });

    it("a press on a handle moves the axis by half pixels, whatever the tool, and paints nothing", () => {
        const h = tools("pencil");
        const document = h.open(blank(), { scale: 8, originX: 40, originY: 40 });
        symmetry(h, "x");
        const pipeline = grabbing(h);
        const mapping = h.mapping()!;
        const handle = axisGeometry(mapping, document.session.doc.settings.symmetry).handles[0]!;
        const client = { x: handle.rect.x + 2, y: handle.rect.y + 2 };
        const input = (dx: number, button: number, buttons: number) => ({
            ...at(h, { x: 0, y: 0 }),
            clientX: client.x + dx,
            clientY: client.y,
            button,
            buttons,
        });
        expect(pipeline.grabAt(client.x, client.y)?.cursor).toBe("ew-resize");
        expect(pipeline.down(input(0, 0, 1))).toBe(true);
        // 13 device pixels at 8 per texel: 1.625 texels, 3.25 half pixels → 3.
        pipeline.move([input(13, -1, 1)]);
        expect(document.session.doc.settings.symmetry.axisX).toBe(WIDTH + 3);
        pipeline.move([input(-20, -1, 1)]);
        expect(document.session.doc.settings.symmetry.axisX).toBe(WIDTH - 5);
        pipeline.up(input(-20, 0, 0));
        expect(document.session.doc.settings.symmetry.axisX).toBe(WIDTH - 5);
        expect(document.history.undoCount).toBe(0);
        expect(isDirty(activeDocument(h.sessions.getState())!)).toBe(false);
        expect(opaque(image(document.session))).toEqual([]);

        // Clamped to the canvas.
        const again = axisGeometry(h.mapping()!, document.session.doc.settings.symmetry)
            .handles[1]!;
        const press = {
            ...at(h, { x: 0, y: 0 }),
            clientX: again.rect.x + 2,
            clientY: again.rect.y + 2,
        };
        pipeline.down({ ...press, button: 0, buttons: 1 });
        pipeline.move([{ ...press, clientX: press.clientX + 1000, button: -1, buttons: 1 }]);
        expect(document.session.doc.settings.symmetry.axisX).toBe(2 * WIDTH);
        // Escape puts it back where the press found it.
        expect(pipeline.cancel()).toBe(true);
        expect(document.session.doc.settings.symmetry.axisX).toBe(WIDTH - 5);
    });

    it("only the left button grabs, only while symmetry shows the axis; a press on the document paints", () => {
        const h = tools("pencil");
        const document = h.open(blank(), { scale: 8, originX: 40, originY: 40 });
        const pipeline = grabbing(h);
        const handleOf = () =>
            axisGeometry(h.mapping()!, { ...document.session.doc.settings.symmetry, mode: "y" })
                .handles[0]!;
        const handle = handleOf();
        const client = { clientX: handle.rect.x + 2, clientY: handle.rect.y + 2 };
        expect(pipeline.grabAt(client.clientX, client.clientY)).toBeNull();
        symmetry(h, "y");
        expect(pipeline.grabAt(client.clientX, client.clientY)?.cursor).toBe("ns-resize");
        pipeline.down({ ...at(h, { x: 0, y: 0 }), ...client, button: 2, buttons: 2 });
        expect(pipeline.strokeTool?.id).toBe("pencil");
        pipeline.up({ ...at(h, { x: 0, y: 0 }), ...client, button: 2, buttons: 0 });

        pipeline.down(at(h, { x: 3, y: 2 }, { button: 0, buttons: 1 }));
        expect(pipeline.strokeTool?.id).toBe("pencil");
        pipeline.up(at(h, { x: 3, y: 2 }, { button: 0, buttons: 0 }));
        expect(opaque(image(document.session))).toEqual(["3,2", `3,${HEIGHT - 3}`]);
    });
});

describe("tiled copies in the viewport and the echo", () => {
    const quad: Quad = { texture: "ed:f:0", layer: 4, x: 30, y: 20, width: 40, height: 24 };

    it("tiledCopies: the quad again on each side of the repeated axes, a whole quad away", () => {
        expect(tiledCopies(quad, "none")).toEqual([]);
        expect(tiledCopies(quad, "x").map(({ x, y }) => [x, y])).toEqual([
            [-10, 20],
            [70, 20],
        ]);
        expect(tiledCopies(quad, "y").map(({ x, y }) => [x, y])).toEqual([
            [30, -4],
            [30, 44],
        ]);
        const both = tiledCopies(quad, "both");
        expect(both).toHaveLength(8);
        expect(both.every((copy) => copy.texture === quad.texture && copy.width === 40)).toBe(true);
        expect(tiledOffsets("both", 5, 3)).toEqual([
            { x: -5, y: -3 },
            { x: 0, y: -3 },
            { x: 5, y: -3 },
            { x: -5, y: 0 },
            { x: 5, y: 0 },
            { x: -5, y: 3 },
            { x: 0, y: 3 },
            { x: 5, y: 3 },
        ]);
        expect(tiledOffsets("none", 5, 3)).toEqual([]);
    });

    it("the stroke echo draws each region in every copy, the copies without the reference cover", () => {
        const made: { puts: Uint8ClampedArray[] }[] = [];
        vi.stubGlobal(
            "OffscreenCanvas",
            class {
                readonly puts: Uint8ClampedArray[] = [];
                constructor(
                    public width: number,
                    public height: number,
                ) {
                    made.push(this);
                }
                getContext() {
                    return {
                        putImageData: (image: { data: Uint8ClampedArray }) =>
                            void this.puts.push(image.data),
                    };
                }
            },
        );
        vi.stubGlobal(
            "ImageData",
            class {
                constructor(
                    readonly data: Uint8ClampedArray,
                    readonly width: number,
                    readonly height: number,
                ) {}
            },
        );
        try {
            const checker = { a: 0x112233, b: 0x445566, size: 2 };
            const echo = createStrokeEcho({
                nextVersion: (() => {
                    let n = 0;
                    return () => ++n;
                })(),
            });
            let tiled: "none" | "x" | "y" | "both" = "both";
            let cover: EchoCover = NO_COVER;
            const { layer } = createStrokeEchoLayer(
                echo,
                () => checker,
                () => cover,
                () => tiled,
            );
            const session = { activeFrameId: "frame" } as DocSession;
            const buffer: PixelBuffer = {
                width: 8,
                height: 6,
                data: Uint8ClampedArray.from({ length: 8 * 6 * 4 }, (_, index) =>
                    index % 4 === 3 ? 255 : (index * 7) & 255,
                ),
            };
            echo.start({ session, frameId: "frame", buffer, prepare: () => {} });
            const rect = { x: 2, y: 1, width: 3, height: 2 };
            echo.composited(rect);
            echo.drawn("frame:plain", 0);
            const draw = () => {
                const calls: number[][] = [];
                layer.draw({
                    context: {
                        imageSmoothingEnabled: true,
                        drawImage: (_image: unknown, ...args: number[]) => void calls.push(args),
                    } as unknown as CanvasRenderingContext2D,
                    size: { width: 200, height: 200 },
                    document: { session } as OpenDocument,
                    mapping: createViewMapping({
                        view: { scale: 3, originX: 30, originY: 20 },
                        docWidth: 8,
                        docHeight: 6,
                        ratio: 1,
                        left: 0,
                        top: 0,
                    }),
                    cursor: null,
                    theme: DEFAULT_OVERLAY_THEME,
                });
                return calls.map((args) => args.slice(4));
            };
            // Document 2, 1 is device 36, 23; a copy is 24 × 18 device pixels away.
            const placed = draw();
            expect(placed[0]).toEqual([36, 23, 9, 6]);
            expect(placed.slice(1).sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!)).toEqual([
                [12, 5, 9, 6],
                [36, 5, 9, 6],
                [60, 5, 9, 6],
                [12, 23, 9, 6],
                [60, 23, 9, 6],
                [12, 41, 9, 6],
                [36, 41, 9, 6],
                [60, 41, 9, 6],
            ]);
            // No cover: the copies use the centre's pixels as they are.
            expect(made[0]!.puts).toHaveLength(1);
            // A reference in front over the region: the centre gives way, the copies do not.
            cover = { behind: [], front: [{ x: 0, y: 0, width: 8, height: 6 }] };
            tiled = "x";
            const again = draw();
            expect(again).toEqual([
                [36, 23, 9, 6],
                [12, 23, 9, 6],
                [60, 23, 9, 6],
            ]);
            const puts = made[0]!.puts.slice(1);
            expect(Array.from(puts[0]!)).toEqual(
                Array.from(echoPixels(buffer, rect, checker, cover)),
            );
            expect(Array.from(puts[1]!)).toEqual(Array.from(echoPixels(buffer, rect, checker)));
            tiled = "none";
            expect(draw()).toEqual([[36, 23, 9, 6]]);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("the viewport's slots draw the checkerboard and the frame again around the document, nothing else", async () => {
        const renderer = new FakeRenderer();
        const scene: Scene = {
            document: null,
            epoch: 0,
            current: null,
            view: { scale: 2, originX: 10, originY: 20 },
            checker: { a: 0x111111, b: 0x222222, size: 2 },
            background: 0,
        };
        const slots = new ViewportSlots(scene, {
            target: renderer,
            bitmap: async () => bitmap("image"),
            rendererFailed: () => false,
            onChange: () => {},
            onError: (error) => {
                throw error;
            },
            onStuck: () => {},
            gate: () => undefined,
        });
        replaceSceneDocument(scene, {
            width: 4,
            height: 2,
            pixels: () => ({ width: 4, height: 2, data: new Uint8ClampedArray(32) }),
        });
        slots.documentChanged();
        scene.current = "a:plain";
        scene.onion = [{ key: "b:plain", alpha: 0.5, placement: "behind" }];
        slots.sync();
        for (let turn = 0; turn < 10; turn++) {
            await flush();
            for (const call of renderer.calls) call.resolve();
        }
        const byLayer = (layer: number) => slots.quads().filter((quad) => quad.layer === layer);
        expect(byLayer(QUAD_LAYER.frame)).toHaveLength(1);
        scene.tiled = "both";
        expect(byLayer(QUAD_LAYER.checker)).toHaveLength(9);
        const frames = byLayer(QUAD_LAYER.frame);
        expect(frames).toHaveLength(9);
        expect(new Set(frames.map((quad) => quad.texture)).size).toBe(1);
        // The document's quad is 8 × 4 device pixels centred on 14, 22; the copies a quad away.
        expect(frames.map(({ x, y }) => `${x},${y}`).sort()).toEqual(
            ["6,18", "14,18", "22,18", "6,22", "14,22", "22,22", "6,26", "14,26", "22,26"].sort(),
        );
        // The onion skin stays on the document alone.
        expect(byLayer(QUAD_LAYER.onionBehind)).toHaveLength(1);
        scene.tiled = "y";
        expect(byLayer(QUAD_LAYER.frame).map(({ x, y }) => `${x},${y}`)).toEqual([
            "14,22",
            "14,18",
            "14,26",
        ]);
        // A new document starts untiled until the app says otherwise.
        replaceSceneDocument(scene, null);
        expect(scene.tiled).toBe("none");
    });

    it("the controller tells the viewport the shown document's tiled mode", () => {
        const sessions = createSessionsStore();
        const viewport = new (class extends RecordingViewport {
            tiled: string[] = [];
            setTiled(mode: "none" | "x" | "y" | "both") {
                this.tiled.push(mode);
            }
        })();
        const connection = connectViewport(viewport, {
            sessions,
            preferences: createPreferenceStore(null),
            composites: createActiveComposites(sessions),
        });
        const first = sessions.getState().open(blank());
        sessions.getState().updateDocSettings(first.id, (settings) => {
            settings.tiled = "both";
        });
        expect(viewport.tiled.at(-1)).toBe("both");
        sessions.getState().open(blank(4, 4));
        expect(viewport.tiled.at(-1)).toBe("none");
        sessions.getState().activate(first.id);
        expect(viewport.tiled.at(-1)).toBe("both");
        connection.dispose();
    });
});
