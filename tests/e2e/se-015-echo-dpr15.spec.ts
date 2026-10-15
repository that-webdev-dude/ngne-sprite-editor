import { atDeviceRatio } from "./se-012-pointer-cases";
import { strokeEchoTests } from "./se-015-echo-cases";

// SE-015: the overlay stroke echo at device pixel ratio 1.5, in a Chrome of its own (see
// `atDeviceRatio`). At 1.5 a whole device pixel is a fraction of a CSS pixel.
const RATIO = 1.5;

atDeviceRatio(RATIO);
strokeEchoTests(RATIO);
