import { pointerTests, atDeviceRatio } from "./se-012-pointer-cases";

// SE-012: zoom about the cursor and the cursor readout at device pixel ratio 1.25, in a
// Chrome of its own (see `atDeviceRatio`). 1.25 is the ratio at which Chrome reports a mouse
// on a device pixel just short of it for one position in five: the mapping has to take such a
// position for the pixel it is on.
const RATIO = 1.25;

atDeviceRatio(RATIO);
pointerTests(RATIO);
