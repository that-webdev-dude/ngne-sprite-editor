import { expect, test } from "@playwright/test";

// The frame and time budgets of the @alone tests (SPEC §11, owner decision of 2026-10-21,
// REVIEW.md H15). A budget such as "shown within two animation frames" is a performance
// assertion: it is enforced where the GPU is real (a run without `CI`, on the reference
// hardware of SPEC §3) and only reported where Chrome renders with SwiftShader (`CI`, see
// playwright.config.ts), whose speed follows the runner. What the test checks besides the
// budget (the images shown, a lower bound) stays an assertion everywhere.

/** Whether frame and time budgets are reported instead of asserted: under `CI` (SwiftShader). */
export const budgetsReported = !!process.env.CI;

/** Asserts `value <= budget`, or under `CI` records it as an annotation and in the log. */
export function expectWithinBudget(value: number, budget: number, what: string): void {
    if (!budgetsReported) {
        expect(value, what).toBeLessThanOrEqual(budget);
        return;
    }
    const over = value > budget;
    const description = `${what}: ${value} (budget ${budget}${over ? ", over: reported only under CI" : ""})`;
    test.info().annotations.push({ type: "budget", description });
    if (over) console.log(`budget reported: ${description}`);
}
