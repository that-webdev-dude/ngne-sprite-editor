import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";

// The engine gaps of SPEC §6.8 that @ngne/core 0.3.1 and 0.4.0 address, checked on a bare
// renderer of the pinned version (harness `ngne-040-gaps.ts`). These tests back the
// "Status with 0.4.0" column of SPEC §6.8 and docs/engine-gaps.md; the editor's own
// workarounds are unchanged by them and stay until each one's removal is decided.

interface View {
    scale: number;
    originX: number;
    originY: number;
}

async function open(page: Page) {
    await page.goto("/tests/e2e/harness/ngne-040-gaps.html");
    const adapter = page.locator("#adapter");
    await expect(adapter).not.toBeEmpty();
    // Hardware locally, SwiftShader with CI=1; recorded with the result, not asserted.
    test.info().annotations.push({
        type: "adapter",
        description: (await adapter.textContent()) ?? "",
    });
}

function probe<T>(page: Page, name: string, arg?: unknown): Promise<T> {
    return page.evaluate(
        ([probeName, probeArg]) =>
            (
                window as unknown as {
                    ngneGaps: Record<string, (arg: unknown) => Promise<unknown>>;
                }
            ).ngneGaps[probeName as string]!(probeArg),
        [name, arg] as const,
    ) as Promise<T>;
}

function note(type: string, description: string) {
    test.info().annotations.push({ type, description });
}

interface Precision {
    beyond: number;
    worst: number;
    opaqueWrong: number;
    translucentTexels: number;
}

test("raw RGBA8 updateTexture shows every translucent value within ±1, whole and as a region", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await open(page);
    const result = await probe<{
        whole: Precision;
        region: Precision;
        bitmap: Precision;
        errors: string[];
    }>(page, "raw");
    for (const key of ["whole", "region", "bitmap"] as const) {
        const r = result[key];
        note(`raw ${key}`, `${r.beyond} of ${r.translucentTexels} beyond ±1, worst ${r.worst}`);
    }

    expect(result.whole.translucentTexels).toBe(256 * 254);
    expect(result.whole.beyond).toBe(0);
    expect(result.whole.opaqueWrong).toBe(0);
    expect(result.region.translucentTexels).toBe(200 * 230);
    expect(result.region.beyond).toBe(0);
    expect(result.region.opaqueWrong).toBe(0);
    // The control: the bitmap path the editor uses today.
    expect(result.bitmap.beyond).toBe(0);
    expect(result.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("camera zoom draws the document as the viewport places it wherever its edges are whole device pixels", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await open(page);
    // Zoom steps times device pixel ratios (SPEC §6.4): whole-pixel edges at the integer
    // scales, fractional ones elsewhere for a 37 × 23 document.
    const views: View[] = [
        { scale: 1, originX: 0, originY: 0 },
        { scale: 2, originX: 10.4, originY: 7.6 },
        { scale: 3, originX: 5, originY: 3 },
        { scale: 4, originX: 31.5, originY: 2.5 },
        { scale: 0.5, originX: 6, originY: 4 },
        { scale: 1.1, originX: 3.3, originY: 1.7 },
        { scale: 1.25, originX: 7, originY: 5 },
        { scale: 1.5, originX: 2, originY: 9 },
        { scale: 2.5, originX: 4.6, originY: 3.2 },
        { scale: 3.75, originX: 1, originY: 1 },
    ];
    const result = await probe<{
        cases: { view: View; wholeEdges: boolean; differing: number }[];
        errors: string[];
    }>(page, "zoom", views);
    for (const c of result.cases)
        note(
            `zoom ${c.view.scale}`,
            `${c.differing} device pixels differ (${c.wholeEdges ? "whole" : "fractional"} edges)`,
        );

    const whole = result.cases.filter((c) => c.wholeEdges);
    expect(whole.map((c) => c.view.scale)).toEqual([1, 2, 3, 4]);
    expect(whole.map((c) => c.differing)).toEqual([0, 0, 0, 0]);
    expect(result.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("repeat addressing tiles one checker period exactly, linear filtering interpolates and nearest stays the default", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await open(page);
    const result = await probe<{
        repeatWrong: number;
        repeatPixels: number;
        linear: number[];
        linearWorst: number;
        nearest: number[];
        nearestWrong: number;
        errors: string[];
    }>(page, "sampling");
    note(
        "repeat",
        `${result.repeatWrong} of ${result.repeatPixels} pixels differ from the checker`,
    );
    note("linear", `${result.linear.join(" ")} (worst ${result.linearWorst} from bilinear)`);
    note("nearest", result.nearest.join(" "));

    expect(result.repeatWrong).toBe(0);
    expect(result.linearWorst).toBeLessThanOrEqual(3);
    expect(new Set(result.linear).size).toBeGreaterThan(4);
    expect(result.nearestWrong).toBe(0);
    expect(result.errors).toEqual([]);
    expect(errors).toEqual([]);
});

test("pixel snapping maps an odd-sized quad 1:1 at fractional centres, flipped or not", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await open(page);
    const cases = [
        { x: 10.3, y: 7.8 },
        { x: 20.5, y: 12.5 },
        { x: 31.49, y: 9.51 },
        { x: 15.75, y: 20.25 },
        { x: 24.5, y: 16.5, flipX: true },
        { x: 8.2, y: 24.9, flipY: true },
        { x: 36.6, y: 22.4, flipX: true, flipY: true },
    ];
    const result = await probe<{
        cases: {
            x: number;
            y: number;
            oneToOne: boolean;
            corner: number[] | null;
            drawn: number;
        }[];
        errors: string[];
    }>(page, "snap", cases);
    for (const c of result.cases)
        note(`snap ${c.x},${c.y}`, `corner ${JSON.stringify(c.corner)}, ${c.drawn} pixels drawn`);

    expect(result.cases.map((c) => c.oneToOne)).toEqual(cases.map(() => true));
    expect(result.errors).toEqual([]);
    expect(errors).toEqual([]);
});
