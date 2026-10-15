import { atDeviceRatio } from "./se-012-pointer-cases";
import { brushCursorTests } from "./se-015-pointer-cases";

// SE-015: the brush cursor and the pixels a click paints at device pixel ratio 1.1, in a
// Chrome of its own (see `atDeviceRatio`). At 1.1 the viewport element itself starts between
// two device pixels.
const RATIO = 1.1;

atDeviceRatio(RATIO);
brushCursorTests(RATIO);
