import { atDeviceRatio } from "./se-012-pointer-cases";
import { toolPointerTests } from "./se-014-pointer-cases";

// SE-014: where a dot lands and what the zoom tool keeps under the pointer at device pixel
// ratio 1.5, in a Chrome of its own (see `atDeviceRatio`). At 1.5 a whole device pixel is a
// fraction of a CSS pixel.
const RATIO = 1.5;

atDeviceRatio(RATIO);
toolPointerTests(RATIO);
