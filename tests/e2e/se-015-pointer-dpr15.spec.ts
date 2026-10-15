import { atDeviceRatio } from "./se-012-pointer-cases";
import { brushCursorTests } from "./se-015-pointer-cases";

// SE-015: the brush cursor and the pixels a click paints at device pixel ratio 1.5, in a
// Chrome of its own (see `atDeviceRatio`). At 1.5 a whole device pixel is a fraction of a CSS
// pixel.
const RATIO = 1.5;

atDeviceRatio(RATIO);
brushCursorTests(RATIO);
