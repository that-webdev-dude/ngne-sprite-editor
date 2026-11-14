import { test } from "@playwright/test";
import { atDeviceRatio } from "./se-012-pointer-cases";
import { STARTUP_FIT_CASES } from "./startup-fit-cases";

// gh-003: a document opened while the app starts, at the device pixel ratio of the CI failure
// (1.1), in a Chrome of its own (see `atDeviceRatio`).
const RATIO = 1.1;

atDeviceRatio(RATIO);
test.describe(`device pixel ratio ${RATIO}`, () => {
    for (const { title, run } of STARTUP_FIT_CASES) test(title, run);
});
