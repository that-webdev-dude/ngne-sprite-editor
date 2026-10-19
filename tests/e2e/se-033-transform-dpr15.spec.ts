import { expect, test } from "@playwright/test";
import type { LaunchOptions } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { overlayPixels, overlaySettled } from "./se-013-support";
import { floating, handleProbe, lift, setUp, transformGroup } from "./se-033-support";

// SE-033 review E4: the transform box's handles on the overlay at a device pixel ratio of 1.5
// (SPEC §11: overlay screenshots at DPR 1 and 1.5). As se-011-readback-dpr15 does, this file
// starts its own Chrome with that scale factor, `devicePixelContentBoxSize` following the
// browser's own factor and not the emulated one (SE-002 finding 7.1).
const RATIO = 1.5;

test.use({
    deviceScaleFactor: RATIO,
    launchOptions: [
        async (
            { launchOptions }: { launchOptions: LaunchOptions },
            use: (options: LaunchOptions) => Promise<void>,
        ) => {
            const kept = (launchOptions.args ?? []).filter(
                (argument) => !argument.startsWith("--force-device-scale-factor"),
            );
            await use({
                ...launchOptions,
                args: [...kept, `--force-device-scale-factor=${RATIO}`],
            });
        },
        { scope: "worker" },
    ],
});

test("at a ratio of 1.5 the overlay draws the south-east handle while a selection floats, and nothing there once it is applied", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const document = await setUp(page);
    expect(await page.evaluate(() => devicePixelRatio)).toBe(RATIO);
    await lift(page, document);
    await overlaySettled(page);
    const probe = handleProbe();
    // The handle is 7 CSS px: 11 device px here, so 4 px out from the corner is still on it,
    // and 6 px out is past it.
    const inside = { x: probe.x + 2, y: probe.y + 2 };
    const outside = { x: probe.x + 4, y: probe.y + 4 };
    expect(await overlayPixels(page, [probe, inside, outside])).toEqual([
        [255, 255, 255, 255],
        [255, 255, 255, 255],
        [0, 0, 0, 0],
    ]);

    await transformGroup(page).getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => floating(page)).toBe(false);
    await overlaySettled(page);
    expect(await overlayPixels(page, [probe])).toEqual([[0, 0, 0, 0]]);
    expect(errors).toEqual([]);
});
