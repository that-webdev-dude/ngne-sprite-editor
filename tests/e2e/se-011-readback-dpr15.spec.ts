import { test } from "@playwright/test";
import type { LaunchOptions } from "@playwright/test";
import { readbackTests } from "./se-011-readback-cases";

// SE-011: viewport readback at device pixel ratio 1.5.
//
// `devicePixelContentBoxSize`, which sizes the canvas (SPEC §6.4), follows the browser's own
// scale factor and not the emulated one (SE-002 finding 7.1). So this file starts its own
// Chrome with that scale factor: the configured launch arguments are kept and only
// `--force-device-scale-factor` is replaced. Launch options belong to the worker, which is
// why they are set for the whole file.
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

readbackTests(RATIO);
