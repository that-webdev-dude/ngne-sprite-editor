import { afterEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu, menuCommands } from "../../src/app/commands/menuModel";
import type { Command } from "../../src/app/commands/types";
import { GIF_FILE, createGifExport, reducedColoursMessage } from "../../src/app/export/gifExport";
import { createGifDialogs } from "../../src/app/export/gifDialog";
import type { GifDialogs, GifRequest } from "../../src/app/export/gifDialog";
import { sessionsStore } from "../../src/app/state/sessions";
import { gifFile } from "../../src/core/gif";
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
}

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
    const exportGif = createGifExport({
        workflows: test.exports,
        dialogs,
        notices: { info: (message) => void test.notices.push({ kind: "info", message }) },
    });
    return { test, dialogs, exportGif, shown };
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
        expect(test.events).toEqual(["apply floating", "gif dialog"]);
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
            "Colours reduced in 1 frame of the GIF: a GIF frame holds at most 256.",
        ]);
        expect(reducedColoursMessage(3)).toBe(
            "Colours reduced in 3 frames of the GIF: a GIF frame holds at most 256.",
        );
        expect(errors(test)).toEqual([]);
    });

    it("refuses during a stroke: at the start, and when one began while the dialog was open", async () => {
        const harness = gifHarness();
        const { test } = harness;
        const document = active(test);
        const begin = () =>
            document.history.begin({
                layerId: document.session.activeLayerId,
                frameId: document.session.activeFrameId,
            });
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
