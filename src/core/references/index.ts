// Reference layers (SPEC §7.6, SE-045): where a reference image lies on the canvas, and the
// commands that add one and set its position, scale and placement. Name, visibility, lock,
// opacity and delete are the layer commands of `core/layers`.

export {
    ADD_REFERENCE_LABEL,
    addReferenceLayerCommand,
    assertReferenceChange,
    canAddReferenceLayer,
    findReferenceLayer,
    ReferenceLayerError,
    referenceLayers,
    RESET_REFERENCE_FIT_LABEL,
    resetReferenceFitCommand,
    setReferenceCommand,
} from "./commands";
export type {
    AddReferenceLayerOptions,
    ReferenceChange,
    ReferenceLayerErrorCode,
} from "./commands";
export { fitPlacement, fitToCanvas, referenceRect } from "./fit";
export type { ReferencePlacement, ReferenceRect } from "./fit";
