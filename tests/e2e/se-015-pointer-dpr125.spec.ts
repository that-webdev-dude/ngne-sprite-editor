import { atDeviceRatio } from "./se-012-pointer-cases";
import { brushCursorTests } from "./se-015-pointer-cases";

// SE-015: the brush cursor and the pixels a click paints at device pixel ratio 1.25, in a
// Chrome of its own (see `atDeviceRatio`). At 1.25 Chrome reports a mouse on a device pixel
// just short of it for one position in five.
const RATIO = 1.25;

atDeviceRatio(RATIO);
brushCursorTests(RATIO);
