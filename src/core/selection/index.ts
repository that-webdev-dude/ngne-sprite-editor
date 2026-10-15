// The selection model of SPEC §5.2 and §7.2 (SE-030): 1-bit masks with bounds, the masks of
// the selection shapes, the operations set, add, subtract, intersect, invert, all and none,
// the boundary as edge segments for the marching ants, and the commands that change
// `DocSession.selection` through the history.

export { selectionBoundary } from "./boundary";
export type { HorizontalEdge, OuterCorner, SelectionBoundary, VerticalEdge } from "./boundary";
export {
    deselectCommand,
    invertSelectionCommand,
    selectAllCommand,
    selectCommand,
    setSelectionCommand,
} from "./commands";
export {
    copyMask,
    createMask,
    maskBounds,
    maskHas,
    masksEqual,
    selectionOf,
    selectionsEqual,
    setMaskPixel,
    setMaskRun,
} from "./mask";
export {
    combineSelection,
    fullMask,
    intersectMask,
    invertMask,
    invertSelection,
    selectAll,
    subtractMask,
    unionMask,
} from "./operations";
export type { SelectionMode } from "./operations";
export { ellipseMask, ellipseRows, MAX_ELLIPSE_SIDE, polygonMask, rectMask } from "./shapes";
