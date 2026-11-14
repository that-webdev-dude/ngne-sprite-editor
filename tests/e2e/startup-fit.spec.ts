import { test } from "@playwright/test";
import { STARTUP_FIT_CASES } from "./startup-fit-cases";

// gh-003: a document opened while the app starts, at the configured device pixel ratio of 1.
test.describe("device pixel ratio 1", () => {
    for (const { title, run } of STARTUP_FIT_CASES) test(title, run);
});
