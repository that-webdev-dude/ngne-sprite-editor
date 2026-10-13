import { pointerTests, atDeviceRatio } from "./se-012-pointer-cases";

// SE-012: zoom about the cursor and the cursor readout at device pixel ratio 1.5, in a Chrome
// of its own (see `atDeviceRatio`).
const RATIO = 1.5;

atDeviceRatio(RATIO);
pointerTests(RATIO);
