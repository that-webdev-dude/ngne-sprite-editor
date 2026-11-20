import { expect, test } from "@playwright/test";
import { ZOOM_STEPS } from "../../src/app/view/zoom";
import { collectErrors } from "./se-006-support";
import type { PeriodCase, PeriodResult } from "./harness/checker-period";

// gh-13: the checkerboard drawn from one repeating period shows the pixels the
// document-sized image showed, at every zoom step, for square sizes odd and even, small and
// large documents, and in the tiled-mode copies (harness `checker-period.ts`). The zoom is
// device pixels per document pixel at any device pixel ratio (SPEC §6.4), so one ratio
// covers them all.

/** Documents and square sizes: odd sides, squares larger than the document, the largest side. */
const DOCUMENTS = [
    { width: 5, height: 3 },
    { width: 37, height: 23 },
    { width: 256, height: 256 },
    { width: 1024, height: 1024 },
];
const SIZES = [1, 2, 3, 5, 8, 64];

test("the repeating checker period draws the pixels of the document-sized checker image at every zoom step", async ({
    page,
}) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await page.goto("/tests/e2e/harness/checker-period.html");
    const adapter = page.locator("#adapter");
    await expect(adapter).not.toBeEmpty();
    test.info().annotations.push({
        type: "adapter",
        description: (await adapter.textContent()) ?? "",
    });

    const cases: PeriodCase[] = [];
    for (const document of DOCUMENTS) {
        for (const size of SIZES) {
            // Steps whose document rectangle stays within the 512 px canvas, and the first
            // that does not: a rectangle larger than the canvas is drawn in part.
            const fitting = ZOOM_STEPS.filter((scale) => document.width * scale <= 512);
            const over = ZOOM_STEPS.find((scale) => document.width * scale > 512);
            for (const scale of over === undefined ? fitting : [...fitting, over]) {
                cases.push({ ...document, size, scale });
            }
        }
    }
    const { results, errors: rendererErrors } = await page.evaluate(
        (list) =>
            (
                window as unknown as {
                    checkerPeriod: {
                        compare(
                            cases: PeriodCase[],
                        ): Promise<{ results: PeriodResult[]; errors: string[] }>;
                    };
                }
            ).checkerPeriod.compare(list),
        cases,
    );
    const wrong = results.filter((result) => result.differing > 0);
    test.info().annotations.push({
        type: "cases",
        description: `${results.length} cases, ${wrong.length} with differing pixels`,
    });

    expect(results).toHaveLength(cases.length);
    // Not vacuous: every drawing put the checkerboard on the canvas.
    expect(results.filter((result) => result.covered === 0)).toEqual([]);
    expect(wrong).toEqual([]);
    expect(rendererErrors).toEqual([]);
    expect(errors).toEqual([]);
});
