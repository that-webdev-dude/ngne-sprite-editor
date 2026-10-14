import type { DeviceSize } from "../../engine/viewport/types";
import type { Point, ViewMapping } from "../view/coordinates";

// The mapping of the image on screen while NGNE stretches its canvas (SE-013).
//
// After the viewport element changes size, NGNE keeps its old canvas on screen, CSS-stretched
// over the element, until the replacement for the new size has drawn (SPEC §6.4). Meanwhile it
// keeps drawing the current view on that old canvas: its quads are placed by the view alone
// (`documentRect`), in the canvas's backing pixels, whatever the canvas's size. The overlay
// takes the same backing size and the same CSS box, so it draws with the same document
// rectangle and is stretched alike. Only client positions (the pointer) map differently: a
// device pixel of the element is `backing / box` backing pixels along each axis.

/**
 * The mapping for a canvas of `backing` pixels shown over an element of `box` device pixels.
 * `rect`, `docToDevice` and `deviceToDoc` are those of `base` (they do not depend on the
 * size); client positions are scaled to backing pixels per axis. `base` itself when the two
 * sizes are equal or either is not known.
 */
export function stretchedMapping(
    base: ViewMapping,
    backing: DeviceSize,
    box: DeviceSize,
): ViewMapping {
    const known = (size: DeviceSize) => size.width > 0 && size.height > 0;
    if (!known(backing) || !known(box)) return base;
    if (backing.width === box.width && backing.height === box.height) return base;
    const sx = backing.width / box.width;
    const sy = backing.height / box.height;

    const clientToDevice = (x: number, y: number): Point => {
        const device = base.clientToDevice(x, y);
        return { x: device.x * sx, y: device.y * sy };
    };
    const deviceToClient = (x: number, y: number): Point => base.deviceToClient(x / sx, y / sy);
    const clientToDocExact = (x: number, y: number): Point => {
        const device = clientToDevice(x, y);
        return base.deviceToDoc(device.x, device.y);
    };

    return {
        frame: base.frame,
        rect: base.rect,
        docToDevice: base.docToDevice,
        deviceToDoc: base.deviceToDoc,
        contains: base.contains,
        clientToDevice,
        deviceToClient,
        clientToDocExact,
        clientToDoc(x, y) {
            const exact = clientToDocExact(x, y);
            // `+ 0`: never a negative zero.
            return { x: Math.floor(exact.x) + 0, y: Math.floor(exact.y) + 0 };
        },
        docToClient(x, y) {
            const device = base.docToDevice(x, y);
            return deviceToClient(device.x, device.y);
        },
    };
}
