import { viewportBaselineTests } from "./se-070-viewport-cases";

// SE-070: viewport baselines at the configured device pixel ratio, 1: readback exact over
// opaque regions, screenshots of the overlay exact.
viewportBaselineTests(1);
