import { test } from "@playwright/test";
import type { LaunchOptions } from "@playwright/test";
import { readbackTests } from "./se-054-readback-cases";

// SE-054: preview readback at device pixel ratio 1.5, and the canvas's size there: its CSS
// size times the ratio is a whole multiple of the document's size (SPEC §6.5).
//
// The browser's own scale factor is set, not only the emulated one (SE-002 finding 7.1), so
// this file starts its own Chrome: the configured launch arguments are kept and only
// `--force-device-scale-factor` is replaced. Launch options belong to the worker.
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
