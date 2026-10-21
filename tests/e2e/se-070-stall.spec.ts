import { expect, test } from "@playwright/test";
import { watchStalls } from "./se-070-stall-support";

// SE-070 fix round 2: the stall watch of the soak names the loop a stuck page is in, and lets
// the test fail instead of waiting for its timeout.

test("stall watch: a page stuck in a script fails the test with the script's stack", async ({
    page,
    context,
}, testInfo) => {
    await page.setContent(
        "<script>function se070Spin() { let turns = 0; for (;;) turns++; }</script>",
    );
    const cdp = await context.newCDPSession(page);
    const watch = await watchStalls(page, cdp, testInfo, { stallMs: 3_000, everyMs: 500 });
    await page.evaluate(() => void setTimeout("se070Spin()", 200));
    let failure: unknown = null;
    try {
        // Never answered: the page is stuck from the timer on.
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1_000)));
    } catch (error) {
        try {
            watch.rethrow(error);
        } catch (named) {
            failure = named;
        }
    }
    expect(watch.stall).toContain("Its JavaScript was paused here:");
    expect(watch.stall).toContain("at se070Spin");
    expect(String(failure)).toContain("at se070Spin");
    expect(testInfo.attachments.map((attachment) => attachment.name)).toContain("stall-stack.txt");
    expect(page.isClosed()).toBe(true);
    await watch.stop();
});

test("stall watch: a page that answers is not reported, and stop disables the debugger", async ({
    page,
    context,
}, testInfo) => {
    await page.setContent("<p>idle</p>");
    const cdp = await context.newCDPSession(page);
    const watch = await watchStalls(page, cdp, testInfo, { stallMs: 3_000, everyMs: 200 });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await watch.stop();
    expect(watch.stall).toBeNull();
    // With the agent disabled a pause is refused.
    await expect(cdp.send("Debugger.pause")).rejects.toThrow(/not enabled/);
    expect(() => watch.rethrow(new Error("plain"))).toThrow("plain");
});
