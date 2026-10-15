import { atDeviceRatio } from "./se-012-pointer-cases";
import { antsTests } from "./se-030-ants-cases";

// SE-030: the marching ants against the NGNE image on the screen at device pixel ratio 1.5,
// in a Chrome of its own (see `atDeviceRatio`): a device pixel is two thirds of a CSS pixel.
const RATIO = 1.5;

atDeviceRatio(RATIO);
antsTests(RATIO);
