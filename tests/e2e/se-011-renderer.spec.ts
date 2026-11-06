import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { harnessSettled, openHarness } from "./se-011-support";

// SE-011: the life of the renderer, on the harness page (an `NgneViewport` without the app):
// a resize applied to the renderer in place, how a recovered device is drawn again (NGNE
// 0.3.0 lifecycle events), what a draw does while the device is being recovered, and what a
// disposed viewport leaves behind.

/** Counters of the harness viewport and of the page's WebGPU devices. */
function counters(page: Page) {
    return page.evaluate(() => {
        const probe = window.se011!.probe;
        return {
            submittedFrames: probe?.submittedFrames ?? -1,
            status: probe?.status ?? null,
            settled: probe?.settled ?? false,
            liveRenderers: window.__se011.liveRenderers(),
            liveDevices: window.__se011.liveDevices(),
            devicesCreated: window.__se011.devicesCreated(),
        };
    });
}

/** Shows frame `frame` of a 16×16 document and waits for it to be on screen. */
async function showDocument(page: Page, frame = 3): Promise<void> {
    await page.evaluate((frame) => {
        window.se011!.open(16, 8);
        window.se011!.show(frame);
    }, frame);
    await harnessSettled(page);
}

/** The top-left texel the viewport draws now: the red channel is 20 × the frame's number. */
function topLeft(page: Page): Promise<number[]> {
    return page.evaluate(() => [...window.se011!.probe!.readCanvas()!.data.slice(0, 4)]);
}

/** Lets `count` animation frames pass in the page. */
function frames(page: Page, count: number): Promise<void> {
    return page.evaluate(
        (count) =>
            new Promise<void>((resolve) => {
                const step = (left: number) =>
                    left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
                step(count);
            }),
        count,
    );
}

/** Loses the renderer's device and waits until NGNE has recovered it on a new one. */
async function loseAndRecover(page: Page): Promise<void> {
    const created = await page.evaluate(() => {
        window.__se011.loseDevice();
        return window.__se011.devicesCreated();
    });
    await expect
        .poll(() =>
            page.evaluate(() => ({
                devices: window.__se011.devicesCreated(),
                status: window.se011!.probe!.status,
            })),
        )
        .toEqual({ devices: created + 1, status: "ready" });
}

test("a viewport disposed while its create is in flight cancels it, and the next viewport's create starts at once", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openHarness(page, { manual: true });
    // The first viewport's renderer is being created: its device request is held.
    await page.evaluate(() => {
        window.__se011.holdDevices();
        window.se011!.create();
    });
    await expect.poll(() => page.evaluate(() => window.__se011.creatingDevices())).toBe(1);

    // That viewport goes and another is made at once, as when a document is closed and the
    // next one opened. The dispose cancels the first create (NGNE 0.3.0's create signal): it
    // publishes no renderer, and the second create does not wait for it.
    await page.evaluate(() => {
        window.se011!.dispose();
        window.se011!.create();
        window.se011!.open(16, 8);
        window.se011!.show(3);
    });
    await expect.poll(() => page.evaluate(() => window.__se011.creatingDevices())).toBe(2);
    await page.waitForTimeout(400);
    // Both device requests wait; no renderer exists and no canvas is in the host.
    expect(
        await page.evaluate(() => ({
            creating: window.__se011.creatingDevices(),
            peaks: window.__se011.peaks(),
            created: window.__se011.devicesCreated(),
            renderers: window.__se011.liveRenderers(),
            canvases: document.querySelectorAll("#host canvas").length,
        })),
    ).toEqual({
        creating: 2,
        peaks: { creating: 2, live: 0 },
        created: 0,
        renderers: 0,
        canvases: 0,
    });

    // The devices arrive: the cancelled create's late device is given back by NGNE, and the
    // second viewport's renderer is the only one.
    await page.evaluate(() => window.__se011.releaseDevices());
    await harnessSettled(page);
    await expect.poll(async () => (await counters(page)).liveDevices).toBe(1);
    expect(await counters(page)).toMatchObject({
        liveRenderers: 1,
        liveDevices: 1,
        devicesCreated: 2,
        status: "ready",
    });
    expect(await page.evaluate(() => window.__se011.peaks().creating)).toBe(2);
    expect(await page.evaluate(() => document.querySelectorAll("#host canvas").length)).toBe(1);
    expect(await topLeft(page)).toEqual([60, 255, 255, 255]);
    expect(await page.evaluate(() => window.se011!.errors)).toEqual([]);
    expect(errors).toEqual([]);
});

test("20 quick resizes are each applied to the renderer in place, and no renderer is made for them", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openHarness(page);
    await showDocument(page);
    const before = await counters(page);
    expect(before).toMatchObject({ liveRenderers: 1, liveDevices: 1 });

    // A new size every 25 ms. Each one is applied (NGNE 0.3.0 `resize`) and drawn in the
    // `ResizeObserver` task it is observed in: two animation frames later the canvas has it.
    const sizes = await page.evaluate(async () => {
        const seen: { wanted: { width: number; height: number }; canvas: unknown }[] = [];
        const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
        for (let step = 0; step < 20; step++) {
            const wanted = { width: 500 + step * 9, height: 380 + step * 5 };
            window.se011!.resize(wanted.width, wanted.height);
            await frame();
            await frame();
            seen.push({ wanted, canvas: window.se011!.probe!.canvasSize });
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return seen;
    });
    for (const { wanted, canvas } of sizes) expect(canvas).toEqual(wanted);
    await harnessSettled(page);

    const after = await counters(page);
    expect(after).toMatchObject({ liveRenderers: 1, liveDevices: 1, status: "ready" });
    expect(await page.evaluate(() => window.se011!.probe!.canvasSize)).toEqual(
        sizes.at(-1)?.wanted,
    );
    // Not one replacement for the twenty sizes: the device is the one made at the start.
    expect(after.devicesCreated).toBe(before.devicesCreated);
    expect(await page.evaluate(() => window.__se011.peaks())).toEqual({ creating: 1, live: 1 });
    expect(await page.evaluate(() => document.querySelectorAll("#host canvas").length)).toBe(1);
    expect(await topLeft(page)).toEqual([60, 255, 255, 255]);
    expect(await page.evaluate(() => window.se011!.errors)).toEqual([]);
    expect(errors).toEqual([]);
});

test("a device lost and recovered is drawn again once, by NGNE's ready event, with no timer, focus or visibility listener of the viewport's", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openHarness(page, { track: true, manual: true });
    // Intervals are held: one the viewport made would run only when the test fires it.
    const baseline = await page.evaluate(() => {
        const alive = window.__se011.alive();
        window.__se011.holdIntervals();
        window.se011!.create();
        return alive;
    });
    await showDocument(page);
    // The viewport's own: one observer, and nothing that polls.
    const own = {
        intervals: baseline.intervals,
        focusListeners: baseline.focusListeners,
        visibilityListeners: baseline.visibilityListeners,
        resizeObservers: baseline.resizeObservers + 1,
    };
    expect(await page.evaluate(() => window.__se011.alive())).toMatchObject(own);

    for (let round = 0; round < 3; round++) {
        const before = await counters(page);
        await loseAndRecover(page);
        // Nothing reads the status: NGNE's `ready` event draws the scene again, once.
        await expect
            .poll(async () => (await counters(page)).submittedFrames, { message: `${round}` })
            .toBe(before.submittedFrames + 1);
        await harnessSettled(page);
        await frames(page, 3);
        expect((await counters(page)).submittedFrames, `${round}`).toBe(before.submittedFrames + 1);
        // Focus, visibility and held intervals change nothing.
        await page.evaluate(() => {
            window.dispatchEvent(new Event("focus"));
            document.dispatchEvent(new Event("visibilitychange"));
            window.__se011.fireIntervals();
        });
        await frames(page, 3);
        expect((await counters(page)).submittedFrames, `${round}`).toBe(before.submittedFrames + 1);
    }
    expect(await topLeft(page)).toEqual([60, 255, 255, 255]);

    // Hidden or visible, the viewport keeps no timer.
    const setVisibility = (state: "hidden" | "visible") =>
        page.evaluate((state) => {
            Object.defineProperty(document, "visibilityState", {
                configurable: true,
                get: () => state,
            });
            document.dispatchEvent(new Event("visibilitychange"));
            return window.__se011.alive().intervals;
        }, state);
    expect(await setVisibility("hidden")).toBe(baseline.intervals);
    expect(await setVisibility("visible")).toBe(baseline.intervals);
    expect(await page.evaluate(() => window.__se011.alive())).toMatchObject(own);
    expect(await page.evaluate(() => window.se011!.errors)).toEqual([]);
    expect(errors).toEqual([]);
});

test("a draw asked for while the device is being recovered waits, keeps its dirty flag and is made once the renderer is ready", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openHarness(page);
    await showDocument(page);
    await page.evaluate(() => window.__se011.record({ x: 0, y: 0, width: 4, height: 4 }));

    // The device is lost and its replacement is held back: NGNE stays `recovering`.
    await page.evaluate(() => {
        window.__se011.holdDevices();
        window.__se011.loseDevice();
    });
    await expect.poll(async () => (await counters(page)).status).toBe("recovering");
    // NGNE asks for an adapter before the device: the request is counted once it gets there.
    await expect.poll(() => page.evaluate(() => window.__se011.creatingDevices())).toBe(1);
    const before = await counters(page);

    // A draw is asked for. `render()` would be a silent no-op: nothing is submitted, and the
    // request is not dropped.
    await page.evaluate(() => window.se011!.redraw());
    await frames(page, 12);
    const waiting = await counters(page);
    expect(waiting).toMatchObject({
        status: "recovering",
        submittedFrames: before.submittedFrames,
        settled: false,
    });
    expect(await page.evaluate(() => window.__se011.captures)).toEqual([]);

    // The device arrives: the draw that was asked for is made, with the slots NGNE restored.
    await page.evaluate(() => window.__se011.releaseDevices());
    await harnessSettled(page);
    const after = await counters(page);
    expect(after.status).toBe("ready");
    expect(after.submittedFrames).toBeGreaterThan(before.submittedFrames);
    expect(after).toMatchObject({ liveRenderers: 1, liveDevices: 1 });
    const captures = await page.evaluate(() => window.__se011.captures);
    expect(captures.length).toBeGreaterThanOrEqual(1);
    for (const capture of captures) {
        expect(capture.crop.data.slice(0, 4)).toEqual([60, 255, 255, 255]);
    }
    expect(await page.evaluate(() => window.se011!.errors)).toEqual([]);
    expect(errors).toEqual([]);
});

test("a viewport disposed during a create, an upload or a replacement leaves no renderer, device, timer or listener", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openHarness(page, { track: true, manual: true });
    const baseline = await page.evaluate(() => window.__se011.alive());
    /** What is left once everything the disposed viewport had started has run out. */
    const left = async () => {
        await page.waitForTimeout(400);
        return page.evaluate(() => ({
            alive: window.__se011.alive(),
            renderers: window.__se011.liveRenderers(),
            devices: window.__se011.liveDevices(),
            creating: window.__se011.creatingDevices(),
            canvases: document.querySelectorAll("#host canvas").length,
        }));
    };
    const nothing = { alive: baseline, renderers: 0, devices: 0, creating: 0, canvases: 0 };

    // During a create: the device request is in flight when the viewport goes.
    await page.evaluate(() => {
        window.__se011.holdDevices();
        window.se011!.create();
        // The toolkit keeps the probe to read the renderer count from after the dispose.
        window.__se011.liveRenderers();
    });
    await expect.poll(() => page.evaluate(() => window.__se011.creatingDevices())).toBe(1);
    // The viewport's own: its observer; no timer and no focus or visibility listener.
    expect(await page.evaluate(() => window.__se011.alive())).toMatchObject({
        intervals: baseline.intervals,
        focusListeners: baseline.focusListeners,
        visibilityListeners: baseline.visibilityListeners,
        resizeObservers: baseline.resizeObservers + 1,
    });
    await page.evaluate(() => {
        window.se011!.dispose();
        window.__se011.releaseDevices();
    });
    expect(await left()).toEqual(nothing);
    const afterCreate = await page.evaluate(() => window.__se011.devicesCreated());
    // The renderer that was being made got its device and gave it back.
    expect(afterCreate).toBe(1);

    // During an upload: a frame is on its way into its slot.
    await page.evaluate(() => {
        window.se011!.create();
        window.__se011.liveRenderers();
    });
    await showDocument(page);
    await page.evaluate(() => {
        window.__se011.closeUploadGate();
        window.se011!.show(5);
    });
    await frames(page, 3);
    expect(await page.evaluate(() => window.se011!.probe!.settled)).toBe(false);
    await page.evaluate(() => {
        window.se011!.dispose();
        window.__se011.openUploadGate();
    });
    expect(await left()).toEqual(nothing);

    // During a replacement: the renderer failed (its device lost, and none to be had for its
    // recovery), and the new renderer waits for its uploads beside it.
    await page.evaluate(() => {
        window.se011!.create();
        window.__se011.liveRenderers();
    });
    await showDocument(page);
    await page.evaluate(() => {
        window.__se011.closeUploadGate();
        window.__se011.refuseDevices(1);
        window.__se011.loseDevice();
    });
    await expect.poll(() => page.evaluate(() => window.__se011.liveRenderers())).toBe(2);
    await page.waitForTimeout(100);
    // The page goes on answering: the disposed viewport does not spin on its queue.
    const answered = await Promise.race([
        page.evaluate(() => {
            window.se011!.dispose();
            return "answered";
        }),
        new Promise<string>((resolve) => setTimeout(() => resolve("frozen"), 8000)),
    ]);
    expect(answered).toBe("answered");
    expect(await page.evaluate(() => 6 * 7)).toBe(42);
    await page.evaluate(() => window.__se011.openUploadGate());
    expect(await left()).toEqual(nothing);

    // A viewport made afterwards works.
    await page.evaluate(() => window.se011!.create());
    await showDocument(page);
    expect(await topLeft(page)).toEqual([60, 255, 255, 255]);
    // The failure that started the replacement, reported once by the viewport and once by
    // NGNE on the console.
    const reported = await page.evaluate(() => window.se011!.errors);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatch(/could not recover/);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/WebGPU recovery failed/);
});
