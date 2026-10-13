import { atDeviceRatio, pointerTests } from "./se-012-pointer-cases";

// SE-012: zoom about the cursor and the cursor readout at device pixel ratio 1.1, in a Chrome
// of its own (see `atDeviceRatio`). At 1.1 the viewport element starts between device pixels:
// the tracks of the shell beside and above it, 44 and 72 CSS px, are 48.4 and 79.2 device
// pixels. At 1, 1.25 and 1.5 they are whole, and the rounding of the element's corner in the
// mapping is never asked for.
const RATIO = 1.1;

atDeviceRatio(RATIO);
pointerTests(RATIO);
