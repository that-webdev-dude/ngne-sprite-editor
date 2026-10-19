import { describe, expect, it, vi } from "vitest";
import { previewOf } from "../../src/app/export/exportPreview";
import * as exporting from "../../src/core/export";
import type * as ExportModule from "../../src/core/export";
import { active, openNew, paint } from "./se-041-support";
import { exportHarness, fakeFolder, waitForDialog } from "./se-052-support";

// SE-052 review (I): the Export dialog's bundle is the one an export writes when nothing has
// changed since the dialog showed it; an edit makes a new one. `bundle` is counted through a
// spy on the module, which every importer of `core/export` sees.

vi.mock("../../src/core/export", async (importOriginal) => {
    const actual = await importOriginal<typeof ExportModule>();
    return { ...actual, bundle: vi.fn(actual.bundle) };
});

const bundleCalls = () => vi.mocked(exporting.bundle).mock.calls.length;

describe("the bundle of an export", () => {
    it("is the dialog's when nothing changed; an edit makes a new one", async () => {
        const test = exportHarness();
        openNew(test);
        paint(active(test), 1);
        const folder = fakeFolder("sprites");
        test.exportPlatform.toChoose.push(folder);

        const running = test.exports.exportWithDialog();
        const request = await waitForDialog(test, "export");
        // The dialog renders the preview of the record the store holds.
        const before = bundleCalls();
        const shown = previewOf(active(test));
        expect(bundleCalls()).toBe(before + 1);
        request.answer(true);
        expect(await running).toBe(true);
        // Written from the dialog's bundle: no second one.
        expect(bundleCalls()).toBe(before + 1);
        expect(folder.files.get("hero.png")).toEqual(shown.bundle?.files[0]?.bytes);

        // After an edit, Export Again bundles the document anew.
        paint(active(test), 2);
        expect(await test.exports.exportAgain()).toBe(true);
        expect(bundleCalls()).toBe(before + 2);
        expect(folder.files.get("hero.png")).not.toEqual(shown.bundle?.files[0]?.bytes);
        // And once more without a change: the bundle of that record again.
        expect(await test.exports.exportAgain()).toBe(true);
        expect(bundleCalls()).toBe(before + 2);
    });
});
