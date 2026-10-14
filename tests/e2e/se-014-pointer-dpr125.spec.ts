import { atDeviceRatio } from "./se-012-pointer-cases";
import { toolPointerTests } from "./se-014-pointer-cases";

// SE-014: where a dot lands and what the zoom tool keeps under the pointer at device pixel
// ratio 1.25, in a Chrome of its own (see `atDeviceRatio`). At 1.25 Chrome reports a mouse on
// a device pixel just short of it for one position in five.
const RATIO = 1.25;

atDeviceRatio(RATIO);
toolPointerTests(RATIO);
