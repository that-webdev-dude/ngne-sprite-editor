import { readdirSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import { commandDialogs, createDialogRequests } from "../../src/app/dialogs/dialogRequests";
import type { DialogRequestBase } from "../../src/app/dialogs/dialogRequests";
import { isSpriteDialogRequest, sizeProblems, spriteDialogs } from "../../src/app/sprite/dialogs";
import type { SpriteDialogRequest } from "../../src/app/sprite/dialogs";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { DocumentSizeError, celKey, createDocument } from "../../src/core/model";
import { rectMask, selectionOf } from "../../src/core/selection";
import {
    collectCommandDialogs,
    commandDialog,
    registeredDialogs,
} from "../../src/ui/dialogs/registry";
import { imageWith } from "./se-034-support";

// SE-034: the dialog requests answered at once without a host, the dialog registry, and the
// sprite operations as commands of the registry, which apply a floating selection first.

/**
 * Calls of `applyFloating` (SE-032's hook), each with the size of the active document and the
 * number of steps its history can undo at the call: what the document was before the command.
 */
const floating = vi.hoisted(() => ({ calls: [] as (string | null)[] }));
vi.mock("../../src/app/selection/floating", async () => {
    const sessions = await import("../../src/app/state/sessions");
    return {
        applyFloating: () => {
            const document = sessions.activeDocument(sessions.sessionsStore.getState());
            if (!document) {
                floating.calls.push(null);
                return;
            }
            const { width, height } = document.session.doc;
            const steps = document.history.undoCount;
            floating.calls.push(`${width}×${height} after ${steps} step${steps === 1 ? "" : "s"}`);
        },
    };
});

const OPERATION_IDS = [
    "sprite.canvasSize",
    "sprite.spriteSize",
    "sprite.crop",
    "sprite.trim",
    "sprite.rotate90",
    "sprite.rotate180",
    "sprite.flipHorizontal",
    "sprite.flipVertical",
] as const;

function command(id: string) {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

function request(): SpriteDialogRequest | null {
    return spriteDialogs.store.getState().request;
}

function active(): OpenDocument {
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no document is open");
    return document;
}

/**
 * A 32 × 32 document with content at (4..11, 6..9), one pixel of it another colour so that no
 * flip or turn leaves it as it is, as the active document.
 */
function open(): OpenDocument {
    const session = createDocument({ name: "ops", width: 32, height: 32 });
    const image = imageWith(32, 32, { x: 4, y: 6, width: 8, height: 4 }, [9, 9, 9]);
    image.data.set([1, 2, 3, 255], (6 * 32 + 4) * 4);
    session.doc.images.set("i", image);
    session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
        imageId: "i",
        opacity: 255,
    });
    return sessionsStore.getState().open(session);
}

beforeAll(() => spriteDialogs.attachHost());

afterEach(() => {
    request()?.answer(null);
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    floating.calls.length = 0;
});

describe("dialog requests", () => {
    it("a request made while no host is attached is answered with null at once", async () => {
        const requests = createDialogRequests<
            DialogRequestBase & { answer(v: number | null): void }
        >();
        const seen: unknown[] = [];
        requests.store.subscribe((state) => seen.push(state.request));
        expect(requests.hosted).toBe(false);
        await expect(
            requests.open<number>((answer) => ({ kind: "any", answer })),
        ).resolves.toBeNull();
        expect(seen).toEqual([]);
    });

    it("stays open while a host is attached; the last host to detach answers it with null", async () => {
        const requests = createDialogRequests<
            DialogRequestBase & { answer(v: number | null): void }
        >();
        const first = requests.attachHost();
        const second = requests.attachHost();
        const pending = requests.open<number>((answer) => ({ kind: "any", answer }));
        expect(requests.store.getState().request?.kind).toBe("any");
        first();
        // Detaching twice counts once.
        first();
        expect(requests.store.getState().request).not.toBeNull();
        second();
        await expect(pending).resolves.toBeNull();
        expect(requests.store.getState().request).toBeNull();
        expect(requests.hosted).toBe(false);
    });

    it("the app's sprite dialogs go through the app's one store, and see only their own kinds", async () => {
        const done = spriteDialogs.canvasSize({
            initial: { width: 8, height: 8, anchor: { x: 0, y: 0 } },
        });
        const shared = commandDialogs.store.getState().request;
        expect(shared?.kind).toBe("canvas-size");
        expect(spriteDialogs.store.getState().request).toBe(shared);
        request()?.answer(null);
        await done;

        // A request of another feature's kind is in the shared store, not in the sprite view.
        const other = commandDialogs.open<number>((answer) => ({ kind: "other", answer }));
        expect(commandDialogs.store.getState().request?.kind).toBe("other");
        expect(spriteDialogs.store.getState().request).toBeNull();
        expect(isSpriteDialogRequest({ kind: "other", answer: () => {} })).toBe(false);
        (commandDialogs.store.getState().request?.answer as (values: null) => void)(null);
        await expect(other).resolves.toBeNull();
    });
});

describe("dialog registry", () => {
    it("discovers every *.dialog.tsx module: the four sprite dialogs", () => {
        const modules = readdirSync(new URL("../../src/ui/", import.meta.url), {
            recursive: true,
            encoding: "utf8",
        }).filter((path) => path.endsWith(".dialog.tsx"));
        expect(modules.length).toBeGreaterThanOrEqual(2);
        for (const kind of ["new-sprite", "sprite-properties", "canvas-size", "sprite-size"]) {
            expect(registeredDialogs.get(kind)?.kind, kind).toBe(kind);
        }
        expect(registeredDialogs.get("canvas-size")?.name).toBe("Canvas size");
        expect(registeredDialogs.get("sprite-size")?.name).toBe("Sprite size");
    });

    it("refuses a module without dialogs and a kind registered twice", () => {
        const Body = () => null;
        expect(() => collectCommandDialogs({ "./a.dialog.tsx": {} })).toThrow('"commandDialogs"');
        expect(() =>
            collectCommandDialogs({
                "./a.dialog.tsx": { commandDialogs: [commandDialog("x", "X", Body)] },
                "./b.dialog.tsx": { commandDialogs: [commandDialog("x", "Y", Body)] },
            }),
        ).toThrow('Dialog kind "x" is used by ./a.dialog.tsx and ./b.dialog.tsx.');
    });
});

describe("sprite operations in the registry", () => {
    it("take the Sprite menu items planned for them", () => {
        for (const id of OPERATION_IDS) {
            const found = command(id);
            const plan = plannedCommands.find((entry) => entry.id === id);
            expect(found.planned, id).toBe(false);
            expect(found.source, id).toMatch(/sprite\/spriteOperations\.commands\.ts$/);
            expect(found.title(), id).toBe(plan?.title);
            expect(found.menuPath, id).toEqual(["Sprite"]);
            expect(found.menuOrder, id).toBe(plan?.menuOrder);
            expect(found.shortcuts, id).toEqual([]);
        }
    });

    it("need a document; Crop to Selection also a selection; none runs during a stroke", () => {
        for (const id of OPERATION_IDS) expect(command(id).enabled(), id).toBe(false);
        const document = open();
        for (const id of OPERATION_IDS) {
            expect(command(id).enabled(), id).toBe(id !== "sprite.crop");
        }
        document.history.execute({
            label: "Select",
            bytes: 0,
            touched: { frameIds: [], layerIds: [], structure: false },
            do: (session) => {
                session.selection = selectionOf(
                    rectMask(32, 32, { x: 0, y: 0, width: 4, height: 4 }),
                );
            },
            undo: (session) => {
                session.selection = null;
            },
        });
        expect(command("sprite.crop").enabled()).toBe(true);
        const stroke = document.history.begin({
            layerId: document.session.activeLayerId,
            frameId: document.session.activeFrameId,
        });
        for (const id of OPERATION_IDS) expect(command(id).enabled(), id).toBe(false);
        stroke.abort();
    });

    it("Canvas Size asks for size and anchor, starting from the document's size, centred", async () => {
        open();
        const done = command("sprite.canvasSize").run();
        const open1 = request();
        if (open1?.kind !== "canvas-size") throw new Error("the Canvas size dialog is not open");
        expect(open1.initial).toEqual({ width: 32, height: 32, anchor: { x: 0.5, y: 0.5 } });
        open1.answer({ width: 48, height: 40, anchor: { x: 0.5, y: 0.5 } });
        await done;
        expect([active().session.doc.width, active().session.doc.height]).toEqual([48, 40]);
        expect(active().history.undoLabel).toBe("Canvas Size");
        // The floating selection was applied before the dialog opened, on the old document.
        expect(floating.calls).toEqual(["32×32 after 0 steps"]);

        // Cancel changes nothing; the same size makes no step.
        const cancelled = command("sprite.canvasSize").run();
        request()?.answer(null);
        await cancelled;
        const same = command("sprite.canvasSize").run();
        const open2 = request();
        if (open2?.kind !== "canvas-size") throw new Error("the Canvas size dialog is not open");
        open2.answer(open2.initial);
        await same;
        expect(active().history.undoCount).toBe(1);
    });

    it("Sprite Size asks for size and resampling, nearest to begin with", async () => {
        open();
        const done = command("sprite.spriteSize").run();
        const open1 = request();
        if (open1?.kind !== "sprite-size") throw new Error("the Sprite size dialog is not open");
        expect(open1.initial).toEqual({ width: 32, height: 32, method: "nearest" });
        open1.answer({ width: 64, height: 64, method: "area" });
        await done;
        expect(active().session.doc.width).toBe(64);
        expect(active().history.undoLabel).toBe("Sprite Size");
    });

    it("a refused size is the command's failure, with the document unchanged", async () => {
        open();
        const done = command("sprite.spriteSize").run();
        request()?.answer({ width: 2048, height: 32, method: "nearest" } as never);
        await expect(done).rejects.toBeInstanceOf(DocumentSizeError);
        expect(active().session.doc.width).toBe(32);
        expect(active().history.undoCount).toBe(0);
    });

    it("crop, trim, rotate and flip run on the active document, each one undo step, each after the floating selection is applied", () => {
        const document = open();
        document.history.execute({
            label: "Select",
            bytes: 0,
            touched: { frameIds: [], layerIds: [], structure: false },
            do: (session) => {
                session.selection = selectionOf(
                    rectMask(32, 32, { x: 2, y: 2, width: 20, height: 20 }),
                );
            },
            undo: (session) => {
                session.selection = null;
            },
        });
        const size = () => [document.session.doc.width, document.session.doc.height];
        command("sprite.crop").run();
        expect(size()).toEqual([20, 20]);
        expect(document.session.selection).toBeNull();
        command("sprite.trim").run();
        expect(size()).toEqual([8, 4]);
        command("sprite.rotate90").run();
        expect(size()).toEqual([4, 8]);
        command("sprite.rotate180").run();
        command("sprite.flipHorizontal").run();
        command("sprite.flipVertical").run();
        expect(document.history.undoCount).toBe(7);
        expect(document.history.undoLabel).toBe("Flip Canvas Vertical");
        // Each operation applied the floating selection before it changed the document: the
        // hook saw the size and the history of the document as the operation before left it.
        expect(floating.calls).toEqual([
            "32×32 after 1 step",
            "20×20 after 2 steps",
            "8×4 after 3 steps",
            "4×8 after 4 steps",
            "4×8 after 5 steps",
            "4×8 after 6 steps",
        ]);
        while (document.history.undo());
        expect(size()).toEqual([32, 32]);
    });

    it("the dialogs refuse a side outside 1..1024 with a message", () => {
        expect(sizeProblems({ width: 32, height: 32 }).message).toBeNull();
        expect(sizeProblems({ width: 0, height: 32 }).message).toBe(
            "Width must be from 1 to 1024 px.",
        );
        expect(sizeProblems({ width: 4, height: 1025 }).message).toBe(
            "Height must be from 1 to 1024 px.",
        );
        expect(sizeProblems({ width: 0.5, height: -1 }).message).toBe(
            "Width and height must each be from 1 to 1024 px.",
        );
    });
});
