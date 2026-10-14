import { atDeviceRatio } from "./se-012-pointer-cases";
import { gridTests } from "./se-013-grid-cases";

// SE-013: grid lines against the NGNE image on the screen at device pixel ratio 1.5, in a
// Chrome of its own (see `atDeviceRatio`): a device pixel is two thirds of a CSS pixel.
const RATIO = 1.5;

atDeviceRatio(RATIO);
gridTests(RATIO);
