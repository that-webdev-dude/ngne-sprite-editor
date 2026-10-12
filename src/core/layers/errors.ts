/**
 * What was wrong:
 * - `layer-not-found`: the document has no layer with the given ID.
 * - `last-pixel-layer`: the layer is the document's only pixel layer, which cannot be deleted
 *   (SPEC §7.3).
 * - `not-a-pixel-layer`: the command works on pixel layers and was given a reference layer.
 * - `no-pixel-layer-below`: merge down found no pixel layer below the layer.
 * - `name`: a layer name is empty or only white space.
 * - `opacity`: an opacity is not an integer from 0 to 255.
 * - `index`: a position is not an index of the layer stack.
 * - `blend-mode`: a blend mode is not one of `BlendMode`.
 */
export type LayerErrorCode =
    | "layer-not-found"
    | "last-pixel-layer"
    | "not-a-pixel-layer"
    | "no-pixel-layer-below"
    | "name"
    | "opacity"
    | "index"
    | "blend-mode";

/**
 * The one error type a layer command refuses a request with. It is thrown while the command
 * is made, so nothing reaches the history and the session is unchanged.
 */
export class LayerError extends Error {
    override readonly name = "LayerError";
    readonly code: LayerErrorCode;

    constructor(code: LayerErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}
