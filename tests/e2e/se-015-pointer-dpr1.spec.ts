import { brushCursorTests } from "./se-015-pointer-cases";

// SE-015: the brush cursor and the pixels a click paints at the configured device pixel
// ratio, 1.
brushCursorTests(1);
