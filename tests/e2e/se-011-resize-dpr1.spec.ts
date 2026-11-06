import { resizeTests } from "./se-011-resize-cases";

// SE-011 on NGNE 0.3.0: renderer resize at device pixel ratio 1 (see `resizeTests`).
resizeTests(1);
