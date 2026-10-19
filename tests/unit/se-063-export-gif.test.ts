import { afterEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import type { Command } from "../../src/app/commands/types";
import { GIF_FILE, createGifExport, reducedColoursMessage } from "../../src/app/export/gifExport";
import { createGifDialogs } from "../../src/app/export/gifDialog";
import type { GifDialogs, GifRequest } from "../../src/app/export/gifDialog";
import { sessionsStore } from "../../src/app/state/sessions";
import { encodeGif, gifFile } from "../../src/core/gif";
import { createDocument } from "../../src/core/model";
import type { SpriteDoc } from "../../src/core/model";
import { fourFrames, manyColours } from "../e2e/se-063-documents";
import { active, errors, openSession } from "./se-041-support";
import { exportHarness, infos } from "./se-052-support";
import type { ExportHarness } from "./se-052-support";

// SE-063: Export GIF… as a command of the registry and as an export of the SE-052 workflows
// (`otherExport`): its dialog's choices, the file it saves, what it reports, and the rules of
// a file operation (floating selection first, not during a stroke, one at a time).

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

afterEach(() => {
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
});

describe("the Export GIF… command", () => {
    it("is a File menu item after Export PNG Sequence…, in the export group, without a key", () => {
        const gif = command("file.exportGif");
        expect(gif.title()).toBe("Export GIF…");
        expect(gif).toMatchObject({ planned: false, source: "../export/gif.commands.ts" });
        expect(gif.menuPath).toEqual(["File"]);
        expect(gif.shortcuts).toEqual([]);
        const file = menuCommands(buildMenu(appCommands.list(), ["File"])).map((entry) => entry.id);
        expect(file.indexOf("file.exportGif")).toBe(file.indexOf("file.exportPngSequence") + 1);
        const group = (id: string) => Math.floor(command(id).menuOrder / 100);
        expect(group("file.exportGif")).toBe(group("file.export"));
    });

    it("can run when an export can: a document is open and no file operation runs", () => {
        expect(command("file.exportGif").enabled()).toBe(false);
        sessionsStore.getState().open(createDocument({ name: "hero", width: 4, height: 3 }));
        expect(command("file.exportGif").enabled()).toBe(true);
    });
});

interface GifHarness {
    test: ExportHarness;
    dialogs: GifDialogs;
    exportGif: () => Promise<boolean>;
    /** Every GIF dialog shown. */
    shown: GifRequest[];
    /** Runs while the save picker is open, before it answers: what the user does meanwhile. */
    duringPicker: (() => void) | null;
    /** The pause the encode uses between frames, around the export's own; null: its own. */
    pause: ((own: () => Promise<void>) => Promise<void>) | null;
}

/**
 * Export GIF… over the SE-052 harness. `test.events` records, in order: "apply floating",
 * "gif dialog", "save picker", "encode" (the encoder called), "write <name>" (a file saved).
 */
function gifHarness(doc: SpriteDoc = fourFrames()): GifHarness {
    const test = exportHarness();
    const layerId = doc.layers[0]!.id;
    openSession(test, { doc, selection: null, activeLayerId: layerId, activeFrameId: "frame-0" });
    const dialogs = createGifDialogs();
    dialogs.attachHost();
    const shown: GifRequest[] = [];
    dialogs.store.subscribe(({ request }) => {
        if (request) {
            shown.push(request);
            test.events.push("gif dialog");
        }
    });
    const platform = test.exportPlatform;
    const chooseFile = platform.chooseFile.bind(platform);
    platform.chooseFile = async (name, type) => {
        test.events.push("save picker");
        harness.duringPicker?.();
        const target = await chooseFile(name, type);
        if (!target) return null;
        return {
            name: target.name,
            async write(bytes) {
                await target.write(bytes);
                test.events.push(`write ${target.name}`);
            },
        };
    };
    const exportGif = createGifExport({
        workflows: test.exports,
        dialogs,
        notices: { info: (message) => void test.notices.push({ kind: "info", message }) },
        encode(doc, options, pause) {
            test.events.push("encode");
            const around = harness.pause;
            return encodeGif(doc, options, around ? () => around(pause!) : pause);
        },
    });
    const harness: GifHarness = {
        test,
        dialogs,
        exportGif,
        shown,
        duringPicker: null,
        pause: null,
    };
    return harness;
}

/** Opens a stroke on the active document, as the pencil does; returns its transaction. */
function beginStroke(test: ExportHarness) {
    const document = active(test);
    return document.history.begin({
        layerId: document.session.activeLayerId,
        frameId: document.session.activeFrameId,
    });
}

function waitForGifDialog(harness: GifHarness): Promise<GifRequest> {
    return vi.waitFor(() => {
        const open = harness.dialogs.store.getState().request;
        if (!open) throw new Error("no GIF dialog yet");
        return open;
    });
}

describe("Export GIF… through otherExport", () => {
    it("offers every frame and each tag with its pass and plays, and the scales 1–8", async () => {
        const harness = gifHarness();
        const running = harness.exportGif();
        const request = await waitForGifDialog(harness);
        expect(request.choices).toEqual([
            { value: "all", label: "All frames", frameCount: 4, plays: 0 },
            { value: "tag:tag-0", label: "Bounce (1–4)", frameCount: 6, plays: 0 },
            { value: "tag:tag-1", label: "Twice (3–4)", frameCount: 2, plays: 2 },
            { value: "tag:tag-2", label: "Back (2–4)", frameCount: 3, plays: 1 },
        ]);
        expect([request.width, request.height]).toEqual([16, 16]);
        expect([request.minScale, request.maxScale]).toEqual([1, 8]);
        expect([request.initialChoice, request.initialScale]).toEqual(["all", 1]);
        expect(request.fileName("all", 1)).toBe("four-frames.gif");
        expect(request.fileName("tag:tag-0", 2)).toBe("four-frames-bounce@2x.gif");
        request.answer(null);
        expect(await running).toBe(false);
        // A cancelled dialog is not reported.
        expect(harness.test.notices).toEqual([]);
    });

    it("applies the floating selection first, saves the GIF gifFile makes and reports it once", async () => {
        const harness = gifHarness();
        const { test } = harness;
        test.exportPlatform.toSave.push("chosen.gif");
        const running = harness.exportGif();
        (await waitForGifDialog(harness)).answer({ choice: "tag:tag-0", scale: 2 });
        expect(await running).toBe(true);
        // The file is chosen first, then encoded (SE-063 review).
        expect(test.events).toEqual([
            "apply floating",
            "gif dialog",
            "save picker",
            "encode",
            "write chosen.gif",
        ]);
        expect(test.exportPlatform.suggested).toEqual(["four-frames-bounce@2x.gif"]);
        const expected = gifFile(active(test).session.doc, {
            frames: { tagId: "tag-0" },
            scale: 2,
        });
        expect(test.exportPlatform.saved).toHaveLength(1);
        expect(
            Buffer.from(test.exportPlatform.saved[0]!.bytes).equals(
                Buffer.from(expected.file.bytes),
            ),
        ).toBe(true);
        expect(infos(test)).toEqual(["Exported 1 file to “chosen.gif”"]);
        expect(errors(test)).toEqual([]);
    });

    it("opens with the frames the export settings name and the scale chosen last", async () => {
        const harness = gifHarness();
        const { test } = harness;
        test.exportPlatform.toSave.push(null);
        let running = harness.exportGif();
        (await waitForGifDialog(harness)).answer({ choice: "all", scale: 5 });
        expect(await running).toBe(false);
        active(test).session.doc.exportSettings.frames = { tagId: "tag-1" };
        running = harness.exportGif();
        const request = await waitForGifDialog(harness);
        expect([request.initialChoice, request.initialScale]).toEqual(["tag:tag-1", 5]);
        request.answer(null);
        await running;
    });

    it("downloads the GIF without a save picker", async () => {
        const harness = gifHarness();
        const { test } = harness;
        test.exportPlatform.access = false;
        const running = harness.exportGif();
        (await waitForGifDialog(harness)).answer({ choice: "all", scale: 1 });
        expect(await running).toBe(true);
        expect(test.exportPlatform.downloads.map(({ name, kind }) => [name, kind])).toEqual([
            ["four-frames.gif", "gif"],
        ]);
        expect(GIF_FILE).toEqual({
            kind: "gif",
            description: "GIF image",
            mime: "image/gif",
            extension: ".gif",
        });
        expect(infos(test)).toEqual(["Exported 1 file to “four-frames.gif”"]);
    });

    it("reports reduced colours with a warning after the result, not a failure", async () => {
        const harness = gifHarness(manyColours());
        const { test } = harness;
        test.exportPlatform.access = false;
        const running = harness.exportGif();
        (await waitForGifDialog(harness)).answer({ choice: "all", scale: 1 });
        expect(await running).toBe(true);
        expect(test.exportPlatform.downloads).toHaveLength(1);
        expect(infos(test)).toEqual([
            "Exported 1 file to “many-colours.gif”",
            "Colours reduced in 1 of the document's frames: a GIF frame holds at most 256.",
        ]);
        expect(reducedColoursMessage(3)).toBe(
            "Colours reduced in 3 of the document's frames: a GIF frame holds at most 256.",
        );
        expect(errors(test)).toEqual([]);
    });

    it("counts the document's frames in the warning: a ping-pong shows its reduced frame twice", async () => {
        const harness = gifHarness(manyColours());
        const { test } = harness;
        test.exportPlatform.access = false;
        const running = harness.exportGif();
        (await waitForGifDialog(harness)).answer({ choice: "tag:tag-0", scale: 1 });
        expect(await running).toBe(true);
        // The GIF holds 0 1 2 1: document frame 1 is reduced, and shown twice.
        expect(
            gifFile(active(test).session.doc, { frames: { tagId: "tag-0" }, scale: 1 }),
        ).toMatchObject({
            frameCount: 4,
            reducedFrames: 1,
        });
        expect(infos(test)).toEqual([
            "Exported 1 file to “many-colours-swing.gif”",
            "Colours reduced in 1 of the document's frames: a GIF frame holds at most 256.",
        ]);
    });

    it("refuses during a stroke: at the start, and when one began while the dialog was open", async () => {
        const harness = gifHarness();
        const { test } = harness;
        const begin = () => beginStroke(test);
        const running = harness.exportGif();
        const request = await waitForGifDialog(harness);
        const stroke = begin();
        request.answer({ choice: "all", scale: 1 });
        expect(await running).toBe(false);
        expect(errors(test)).toEqual(["Could not export “Four Frames”. A stroke is in progress."]);
        expect(test.exportPlatform.saved).toEqual([]);
        expect(test.exportPlatform.suggested).toEqual([]);

        // Still open: the export stops before its dialog.
        expect(await harness.exportGif()).toBe(false);
        expect(harness.shown).toHaveLength(1);
        expect(errors(test)).toHaveLength(2);
        stroke.abort();
    });

    it("is one file operation: none other starts while its dialog is open", async () => {
        const harness = gifHarness();
        const { test } = harness;
        const running = harness.exportGif();
        const request = await waitForGifDialog(harness);
        expect(test.workflows.busy).toBe(true);
        expect(test.exports.canExport()).toBe(false);
        expect(await test.exports.exportSpriteSheet()).toBe(false);
        expect(await harness.exportGif()).toBe(false);
        expect(harness.shown).toHaveLength(1);
        request.answer(null);
        expect(await running).toBe(false);
        expect(test.workflows.busy).toBe(false);
    });
});

describe("Export GIF…: the file is chosen first, then encoded (SE-063 review)", () => {
    it("asks for the file before the encode runs; a cancelled picker encodes nothing", async () => {
        const harness = gifHarness();
        const { test } = harness;
        test.exportPlatform.toSave.push(null);
        const running = harness.exportGif();
        (await waitForGifDialog(harness)).answer({ choice: "all", scale: 1 });
        expect(await running).toBe(false);
        expect(test.events).toEqual(["apply floating", "gif dialog", "save picker"]);
        expect(test.notices).toEqual([]);
    });

    it("stops when a stroke began while the save picker was open", async () => {
        const harness = gifHarness();
        const { test } = harness;
        test.exportPlatform.toSave.push("chosen.gif");
        let stroke: ReturnType<typeof beginStroke> | null = null;
        harness.duringPicker = () => {
            stroke = beginStroke(test);
        };
        const running = harness.exportGif();
        (await waitForGifDialog(harness)).answer({ choice: "all", scale: 1 });
        expect(await running).toBe(false);
        expect(errors(test)).toEqual(["Could not export “Four Frames”. A stroke is in progress."]);
        expect(test.events).not.toContain("encode");
        expect(test.exportPlatform.saved).toEqual([]);
        stroke!.abort();
    });

    it("stops when a stroke begins, or the document changes, while it encodes", async () => {
        for (const meanwhile of ["stroke", "change"] as const) {
            const harness = gifHarness();
            const { test } = harness;
            test.exportPlatform.toSave.push("chosen.gif");
            let stroke: ReturnType<typeof beginStroke> | null = null;
            let pauses = 0;
            harness.pause = async (own) => {
                // During the encode, after its first frame.
                if (++pauses === 1) {
                    stroke = beginStroke(test);
                    if (meanwhile === "change") {
                        stroke.image.data.fill(255);
                        stroke.markDirty({ x: 0, y: 0, width: 16, height: 16 });
                        stroke.commit("Paint");
                        stroke = null;
                    }
                }
                await own();
            };
            const running = harness.exportGif();
            (await waitForGifDialog(harness)).answer({ choice: "all", scale: 1 });
            expect(await running, meanwhile).toBe(false);
            expect(errors(test), meanwhile).toEqual([
                `Could not export “Four Frames”. ${
                    meanwhile === "stroke"
                        ? "A stroke is in progress."
                        : "The document changed while the GIF was made. Export it again."
                }`,
            ]);
            expect(test.events, meanwhile).toContain("encode");
            expect(test.exportPlatform.saved, meanwhile).toEqual([]);
            expect(pauses, meanwhile).toBe(1);
            (stroke as ReturnType<typeof beginStroke> | null)?.abort();
        }
    });

    it("does not block the page for the whole encode: a timer set as it starts runs before it ends", async () => {
        const harness = gifHarness();
        const { test } = harness;
        test.exportPlatform.toSave.push("chosen.gif");
        // The timer is set when the encoder is called, before its first frame.
        const push = test.events.push.bind(test.events);
        test.events.push = (...items) => {
            if (items.includes("encode")) setTimeout(() => push("timer"), 0);
            return push(...items);
        };
        const running = harness.exportGif();
        (await waitForGifDialog(harness)).answer({ choice: "all", scale: 1 });
        expect(await running).toBe(true);
        const events = test.events.slice(test.events.indexOf("encode"));
        expect(events).toEqual(["encode", "timer", "write chosen.gif"]);
    });

    it("otherExport: a producer runs after the picker or before the download; its failure is one toast", async () => {
        const harness = gifHarness();
        const { test } = harness;
        const file = { name: "made.bin", bytes: new Uint8Array(0) };
        const type = GIF_FILE;
        const platform = test.exportPlatform;
        test.exportPlatform.toSave.push("chosen.gif");
        const produce = async () => {
            test.events.push("produce");
            return Uint8Array.from([7, 8, 9]);
        };
        expect(
            await test.exports.otherExport(async () => {
                test.events.push("make");
                return { file, type, count: 1, produce };
            }),
        ).toBe(true);
        expect(test.events).toEqual([
            "apply floating",
            "make",
            "save picker",
            "produce",
            "write chosen.gif",
        ]);
        expect(platform.saved).toEqual([{ name: "chosen.gif", bytes: Uint8Array.from([7, 8, 9]) }]);

        platform.access = false;
        expect(
            await test.exports.otherExport(async () => ({ file, type, count: 1, produce })),
        ).toBe(true);
        expect(platform.downloads).toEqual([
            { name: "made.bin", bytes: Uint8Array.from([7, 8, 9]), kind: "gif" },
        ]);

        const failing = async (): Promise<Uint8Array<ArrayBuffer>> => {
            throw new Error("Out of memory.");
        };
        expect(
            await test.exports.otherExport(async () => ({
                file,
                type,
                count: 1,
                produce: failing,
            })),
        ).toBe(false);
        platform.access = true;
        platform.toSave.push("other.gif");
        expect(
            await test.exports.otherExport(async () => ({
                file,
                type,
                count: 1,
                produce: failing,
            })),
        ).toBe(false);
        expect(errors(test)).toEqual([
            "Could not export “Four Frames”. Out of memory.",
            "Could not export “Four Frames”. Out of memory.",
        ]);
        expect(platform.downloads).toHaveLength(1);
        expect(platform.saved).toHaveLength(1);
    });
});
