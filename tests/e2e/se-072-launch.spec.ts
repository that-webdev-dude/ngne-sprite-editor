import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { celKey, createDocument } from "../../src/core/model";
import { serialize } from "../../src/core/project";
import { collectErrors } from "./se-006-support";
import { documentName, errorToast, infoToast } from "./se-041-support";
import { tabs } from "./se-047-support";
import { buildApp, serve } from "./se-072-support";
import type { Served } from "./se-072-support";

// SE-072: the installed app opens the `.ngsprite` file it is launched with (the manifest's
// `file_handlers`). Chrome hands the file to the page through `window.launchQueue`, which this
// spec stubs before the app loads: a launch is kept until the page sets its consumer, as Chrome
// keeps it, and is then delivered with a File System Access handle of the file. The production
// build, without test hooks: what the spec reads is on screen or in the stub.

declare global {
    interface Window {
        /** The launch queue stub: delivers a launch of the file `name` with `bytes`. */
        __se072Launch?(name: string, bytes: number[]): void;
        /**
         * Delivers one launch of several files; an `unreadable` one has a handle whose file
         * cannot be read (moved or deleted since).
         */
        __se072LaunchFiles?(files: { name: string; bytes: number[]; unreadable?: boolean }[]): void;
        /** Every write through a launched file's handle: the file name and its bytes. */
        __se072Writes?: { name: string; bytes: number[] }[];
    }
}

/** The bytes of a project file: a `width` × `height` sprite `name` with one opaque pixel. */
function projectBytes(name: string, width: number, height: number): number[] {
    const { doc } = createDocument({ name, width, height });
    const data = new Uint8ClampedArray(width * height * 4);
    data.set([208, 48, 48, 255], (1 * width + 2) * 4);
    doc.images.set("pixel", { width, height, data });
    doc.cels.set(celKey(doc.layers[0]!.id, doc.frames[0]!.id), { imageId: "pixel", opacity: 255 });
    return Array.from(serialize(doc, new Map()));
}

/**
 * Replaces `window.launchQueue` before the app loads. `launches` are pending when the page
 * starts (the app was launched with them); `__se072Launch` delivers one more later (a file
 * opened while the app runs, `launch_handler: focus-existing`).
 */
async function stubLaunchQueue(
    page: Page,
    launches: { name: string; bytes: number[] }[],
): Promise<void> {
    await page.addInitScript((launches) => {
        window.__se072Writes = [];
        const handle = (name: string, bytes: number[], unreadable = false) => {
            const file = new File([Uint8Array.from(bytes)], name);
            const self = {
                kind: "file",
                name,
                getFile: async () => {
                    if (unreadable) {
                        throw new DOMException(
                            "A requested file could not be found.",
                            "NotFoundError",
                        );
                    }
                    return file;
                },
                async createWritable() {
                    const chunks: number[] = [];
                    return {
                        async write(data: Uint8Array) {
                            chunks.push(...data);
                        },
                        async close() {
                            window.__se072Writes!.push({ name, bytes: chunks });
                        },
                        async abort() {},
                    };
                },
                queryPermission: async () => "granted",
                requestPermission: async () => "granted",
                isSameEntry: async (other: unknown) => other === self,
            };
            return self;
        };
        const pending = launches.map(({ name, bytes }) => ({ files: [handle(name, bytes)] }));
        let consumer: ((params: unknown) => void) | null = null;
        const deliver = () => {
            if (!consumer) return;
            for (const params of pending.splice(0)) consumer(params);
        };
        Object.defineProperty(window, "launchQueue", {
            configurable: true,
            value: {
                setConsumer(next: (params: unknown) => void) {
                    consumer = next;
                    setTimeout(deliver, 0);
                },
            },
        });
        window.__se072Launch = (name, bytes) => {
            pending.push({ files: [handle(name, bytes)] });
            deliver();
        };
        window.__se072LaunchFiles = (files) => {
            pending.push({
                files: files.map(({ name, bytes, unreadable }) => handle(name, bytes, unreadable)),
            });
            deliver();
        };
    }, launches);
}

let served: Served;

test.beforeAll(async () => {
    test.setTimeout(120_000);
    served = await serve(await buildApp());
});

test.afterAll(async () => {
    await served?.close();
});

test("launch queue: the file the app is launched with opens in a tab, and Save writes back to it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const launched = projectBytes("launched", 8, 6);
    await stubLaunchQueue(page, [{ name: "launched.ngsprite", bytes: launched }]);
    await page.goto(served.url);
    await expect(infoToast(page, "Opened launched.ngsprite")).toBeVisible();
    await expect(documentName(page)).toHaveText("launched");
    await expect(tabs(page)).toHaveCount(1);

    // The document keeps the launched file's handle: Save writes to it without a picker. An
    // unchanged document is written as the same bytes (SPEC §10).
    await page.locator("[data-viewport]").focus();
    await page.keyboard.press("Control+KeyS");
    await expect(infoToast(page, "Saved launched.ngsprite")).toBeVisible();
    expect(await page.evaluate(() => window.__se072Writes)).toEqual([
        { name: "launched.ngsprite", bytes: launched },
    ]);

    // A file opened while the app runs comes to the same page and opens in a tab of its own.
    await page.evaluate(({ name, bytes }) => window.__se072Launch!(name, bytes), {
        name: "second.ngsprite",
        bytes: projectBytes("second", 4, 4),
    });
    await expect(infoToast(page, "Opened second.ngsprite")).toBeVisible();
    await expect(documentName(page)).toHaveText("second");
    await expect(tabs(page)).toHaveCount(2);
    await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
    expect(errors).toEqual([]);
});

test("launch queue: launches back to back all open, one after another, and a file that cannot be opened is reported", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubLaunchQueue(page, []);
    await page.goto(served.url);
    await expect(page.locator('[data-region="viewport"]')).toBeVisible();
    // The consumer is set (the stub delivers what is pending once it is).
    await page.waitForFunction(() => window.__se072Launch !== undefined);

    // Two files opened from the desktop in quick succession: the second comes while the
    // first still opens, and waits for it instead of being dropped.
    await page.evaluate(
        ({ one, two }) => {
            window.__se072Launch!("one.ngsprite", one);
            window.__se072Launch!("two.ngsprite", two);
        },
        { one: projectBytes("one", 4, 4), two: projectBytes("two", 5, 5) },
    );
    await expect(tabs(page)).toHaveCount(2);
    await expect(tabs(page).nth(0)).toContainText("one");
    await expect(tabs(page).nth(1)).toContainText("two");
    await expect(documentName(page)).toHaveText("two");

    // One launch of three files: every project file opens; a corrupt one and one that cannot
    // be read are reported by an error toast each, as Open reports them.
    await page.evaluate(
        ({ three }) =>
            window.__se072LaunchFiles!([
                { name: "corrupt.ngsprite", bytes: [1, 2, 3, 4] },
                { name: "gone.ngsprite", bytes: [], unreadable: true },
                { name: "three.ngsprite", bytes: three },
            ]),
        { three: projectBytes("three", 6, 6) },
    );
    await expect(tabs(page)).toHaveCount(3);
    await expect(documentName(page)).toHaveText("three");
    await expect(
        errorToast(page).filter({ hasText: "Could not open “corrupt.ngsprite”." }),
    ).toBeVisible();
    await expect(
        errorToast(page).filter({
            hasText: "Could not open “gone.ngsprite”. A requested file could not be found.",
        }),
    ).toBeVisible();
    await expect(errorToast(page)).toHaveCount(2);
    expect(errors).toEqual([]);
});
