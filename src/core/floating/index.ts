// The floating selection of SPEC §5.2 and §7.2 (SE-032): lifted or pasted pixels held in a
// transaction until they are applied or cancelled, the selected pixels of a cel as content to
// copy, and the edits Delete and Fill of the selected pixels. Its transforms (SE-033): flips,
// quarter turns and the free transform, nearest-neighbour.

export { contentOfImage, copySelected, FloatingSelection, MAX_TRANSFORM_SIDE } from "./floating";
export type { FloatingContent, FloatTarget, LiftOptions, PasteOptions } from "./floating";
export { clearSelected, fillSelected } from "./selected";
export {
    boxCorners,
    flipContent,
    fromBoxSpace,
    isIdentity,
    normalizeAngle,
    renderTransform,
    rotateBox,
    rotateContent,
    toBoxSpace,
    turnOf,
} from "./transform";
export type { FlipAxis, FloatBox, FreeTransform, RenderedContent } from "./transform";
