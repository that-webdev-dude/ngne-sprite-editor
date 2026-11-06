import { atDeviceRatio } from "./se-012-pointer-cases";
import { resizeTests } from "./se-011-resize-cases";

// SE-011 on NGNE 0.3.0: renderer resize at device pixel ratio 1.5, in a Chrome of its own (see
// `atDeviceRatio`).
const RATIO = 1.5;

atDeviceRatio(RATIO);
resizeTests(RATIO);
