import { atDeviceRatio } from "./se-012-pointer-cases";
import { tiledTests } from "./se-062-tiled-cases";

// SE-062: tiled mode in the viewport at device pixel ratio 1.5, in a Chrome of its own (see
// `atDeviceRatio`): the copies are whole device rectangles apart there too.
const RATIO = 1.5;

atDeviceRatio(RATIO);
tiledTests(RATIO);
