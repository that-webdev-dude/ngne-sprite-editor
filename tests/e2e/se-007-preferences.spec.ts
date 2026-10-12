import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
    PREFERENCES_STORAGE_KEY as KEY,
    PREFERENCES_VERSION as VERSION,
} from "../../src/app/preferences/preferences";
import { collectErrors } from "./se-006-support";
import { openEditor } from "./se-007-support";

// SE-007: the preference store in the browser — one versioned localStorage record; corrupt or
// older stored values fall back to defaults without an error.

/** Puts `text` under the preference key before the app starts, on the first load only. */
async function storeBeforeLoad(page: Page, text: string): Promise<void> {
    await page.addInitScript(
        ({ key, text }) => {
            if (sessionStorage.getItem("se007-seeded")) return;
            sessionStorage.setItem("se007-seeded", "1");
            localStorage.setItem(key, text);
        },
        { key: KEY, text },
    );
}

const preferences = (page: Page) => page.evaluate(() => window.__ngneTest!.preferences.all());
const storedText = (page: Page) => page.evaluate((key) => localStorage.getItem(key), KEY);

/** The defaults of the running app: the values after a reset of every preference. */
function defaults(page: Page) {
    return page.evaluate(() => {
        const store = window.__ngneTest!.preferences;
        store.reset();
        return store.all();
    });
}

for (const [name, text] of [
    ["corrupt", `{"version":${VERSION},"values":{"grid":`],
    [
        "of an older version",
        JSON.stringify({ version: VERSION - 1, values: { grid: { width: 4, height: 4 } } }),
    ],
    ["of an older, unversioned shape", JSON.stringify({ grid: { width: 4, height: 4 } })],
    ["not a record at all", "null"],
] as const) {
    test(`stored preferences that are ${name} fall back to defaults without an error`, async ({
        page,
    }) => {
        const errors = collectErrors(page);
        const warnings: string[] = [];
        page.on("console", (message) => {
            if (message.type() === "warning") warnings.push(message.text());
        });
        await storeBeforeLoad(page, text);
        await openEditor(page);

        const loaded = await preferences(page);
        // The documented defaults, not the 4×4 grid of the stored record.
        expect(loaded).toMatchObject({
            checkerboard: { colors: "theme", size: 8 },
            grid: { width: 16, height: 16 },
            autosave: { enabled: true },
        });
        expect(errors).toEqual([]);
        expect(warnings).toEqual([]);
        // The stored text is left as it was until a preference changes.
        expect(await storedText(page)).toBe(text);
        // Every preference is at its default: a reset changes nothing.
        expect(await defaults(page)).toEqual(loaded);
    });
}

test("a preference is persisted in a versioned record and survives a reload", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    expect(await storedText(page)).toBeNull();

    const notified = await page.evaluate(() => {
        const store = window.__ngneTest!.preferences;
        const keys: string[] = [];
        store.subscribe((key) => keys.push(key));
        store.set("grid", { width: 8, height: 12 });
        store.set("autosave", { enabled: false });
        return keys;
    });
    expect(notified).toEqual(["grid", "autosave"]);
    const stored = JSON.parse((await storedText(page)) ?? "null") as {
        version: number;
        values: { grid: unknown };
    };
    expect(stored.version).toBe(VERSION);
    expect(stored.values.grid).toEqual({ width: 8, height: 12 });

    await page.reload();
    await openEditor(page);
    expect(await preferences(page)).toMatchObject({
        grid: { width: 8, height: 12 },
        autosave: { enabled: false },
        checkerboard: { colors: "theme", size: 8 },
    });
    expect(errors).toEqual([]);
});

test("one invalid field of a current record falls back alone", async ({ page }) => {
    const errors = collectErrors(page);
    await storeBeforeLoad(
        page,
        JSON.stringify({
            version: VERSION,
            values: { grid: { width: 24, height: -3 }, autosave: { enabled: false } },
        }),
    );
    await openEditor(page);
    expect(await preferences(page)).toMatchObject({
        grid: { width: 24, height: 16 },
        autosave: { enabled: false },
    });
    expect(errors).toEqual([]);
});
