import { documentRect } from "../../engine/viewport/geometry";
import type { DeviceRect } from "../../engine/viewport/geometry";
import type { ViewState } from "../state/sessions";

// Coordinate mapping of the viewport (SE-012), shared by the tools and the overlay. Pure: no
// DOM and no store, so it is unit-tested in Node. Three spaces:
//
//   client    CSS pixels of the window, as pointer events report them (`clientX`, `clientY`)
//   device    device pixels from the top-left corner of the viewport element: the pixels of
//             the NGNE canvas and of the overlay canvas, and the space of the view's origin
//   document  sprite pixels; `(x, y)` is the top-left corner of pixel `x, y`
//
// The document rectangle is the engine's own (`documentRect`), so a position mapped here
// lands on the texel NGNE draws there.

export interface Point {
    x: number;
    y: number;
}

/** What the mapping depends on. */
export interface ViewFrame {
    /** The view of the document (SPEC §6.4). */
    view: ViewState;
    /** Size of the document in document pixels. */
    docWidth: number;
    docHeight: number;
    /** Device pixels per CSS pixel: `window.devicePixelRatio`. */
    ratio: number;
    /** Top-left corner of the viewport element in client coordinates, CSS pixels. */
    left: number;
    top: number;
}

/**
 * A device coordinate that is a whole number up to noise is that whole number: a position on
 * a texel boundary must not fall into the texel before it. The noise has two sources.
 * `(n / ratio) * ratio` need not give `n` back. And a pointer event reports its position in
 * CSS pixels with the precision of a 32-bit float: Chrome multiplies the device pixel by a
 * 32-bit reciprocal of the ratio (measured for SE-012: device pixel 269 at 1.5 arrives as
 * 179.33334350585938). At a ratio of 1.25 that puts one mouse position in five just below
 * its device pixel, at 1.2 two in three. The error stays under 0.002 device pixels up to
 * 8192 CSS pixels and a ratio of 4; anything closer than 1/128 to a whole device pixel is
 * taken as that pixel.
 */
const NOISE = 1 / 128;
function settle(value: number): number {
    const whole = Math.round(value);
    // `+ 0`: never a negative zero.
    return Math.abs(value - whole) < NOISE ? whole + 0 : value;
}

/**
 * The mapping for one frame. Its three named functions are those of the ticket:
 * `clientToDoc`, `docToClient` and `docToDevice`.
 */
export interface ViewMapping {
    readonly frame: Readonly<ViewFrame>;
    /** The document rectangle in device pixels, as the engine draws it. */
    readonly rect: Readonly<DeviceRect>;
    /**
     * The document pixel under a client position: whole numbers, also outside the document
     * (negative, or beyond its size). `clientToDoc(docToClient(p))` is `p` for whole `p` at
     * every zoom step of 1 and above.
     */
    clientToDoc(x: number, y: number): Point;
    /** The client position of a document position; `(x, y)` is the corner of pixel `x, y`. */
    docToClient(x: number, y: number): Point;
    /**
     * The device position of a document position. Whole numbers for whole `x`, `y` at the
     * zoom steps of 1 and above; `(0, 0)` and `(width, height)` are the corners of `rect`
     * at every step.
     */
    docToDevice(x: number, y: number): Point;
    /** The device position of a client position; fractions are kept. */
    clientToDevice(x: number, y: number): Point;
    /** The client position of a device position. */
    deviceToClient(x: number, y: number): Point;
    /** The document position of a device position, with its fraction inside the pixel. */
    deviceToDoc(x: number, y: number): Point;
    /** The document position of a client position, with its fraction inside the pixel. */
    clientToDocExact(x: number, y: number): Point;
    /** Whether a document pixel lies inside the document. */
    contains(pixel: Point): boolean;
}

/** The mapping between client, device and document coordinates for `frame`. */
export function createViewMapping(frame: ViewFrame): ViewMapping {
    const ratio = frame.ratio > 0 && Number.isFinite(frame.ratio) ? frame.ratio : 1;
    // The browser lays the element's box out on whole device pixels.
    const deviceLeft = Math.round(frame.left * ratio);
    const deviceTop = Math.round(frame.top * ratio);
    const rect = documentRect(frame.view, frame.docWidth, frame.docHeight);
    const { docWidth, docHeight } = frame;
    // Along each axis the document's side maps onto the rectangle's side: the view's scale at
    // the steps of 1 and above, the rectangle's rounded size at the overview steps. Multiplied
    // before divided, so whole positions at a whole scale stay exact.

    const clientToDevice = (x: number, y: number): Point => ({
        x: settle(x * ratio - deviceLeft),
        y: settle(y * ratio - deviceTop),
    });
    const deviceToClient = (x: number, y: number): Point => ({
        x: (deviceLeft + x) / ratio,
        y: (deviceTop + y) / ratio,
    });
    const docToDevice = (x: number, y: number): Point => ({
        x: rect.x + (x * rect.width) / docWidth,
        y: rect.y + (y * rect.height) / docHeight,
    });
    const deviceToDoc = (x: number, y: number): Point => ({
        x: ((x - rect.x) * docWidth) / rect.width,
        y: ((y - rect.y) * docHeight) / rect.height,
    });
    const clientToDocExact = (x: number, y: number): Point => {
        const device = clientToDevice(x, y);
        return deviceToDoc(device.x, device.y);
    };

    return {
        frame,
        rect,
        clientToDevice,
        deviceToClient,
        docToDevice,
        deviceToDoc,
        clientToDocExact,
        clientToDoc(x, y) {
            const exact = clientToDocExact(x, y);
            // `+ 0`: never a negative zero.
            return { x: Math.floor(exact.x) + 0, y: Math.floor(exact.y) + 0 };
        },
        docToClient(x, y) {
            const device = docToDevice(x, y);
            return deviceToClient(device.x, device.y);
        },
        contains: (pixel) =>
            pixel.x >= 0 && pixel.y >= 0 && pixel.x < docWidth && pixel.y < docHeight,
    };
}

/** The document pixel under a client position (see `ViewMapping.clientToDoc`). */
export function clientToDoc(frame: ViewFrame, x: number, y: number): Point {
    return createViewMapping(frame).clientToDoc(x, y);
}

/** The client position of a document position (see `ViewMapping.docToClient`). */
export function docToClient(frame: ViewFrame, x: number, y: number): Point {
    return createViewMapping(frame).docToClient(x, y);
}

/** The device position of a document position (see `ViewMapping.docToDevice`). */
export function docToDevice(frame: ViewFrame, x: number, y: number): Point {
    return createViewMapping(frame).docToDevice(x, y);
}
