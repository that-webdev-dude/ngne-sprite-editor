// What happens to a renderer instance that was created and loaded to replace the one on
// screen (SPEC §6.4, replacement order). The canvases are swapped only for an instance that
// can draw, so the viewport is never blank and never shows a dead canvas in place of a good
// one. Plain data in, a decision out: no DOM and no NGNE.

/** `RendererStatus` of NGNE, spelled out here to keep this module free of the engine. */
export type InstanceStatus = "ready" | "recovering" | "failed" | "disposed";

/** What the decision needs to know of a renderer instance. */
export interface InstanceState {
    status: InstanceStatus;
    /** An upload failed for good on it: it cannot show the scene in full. */
    stuck: boolean;
}

/**
 * - `wait`: the new instance is recovering its device. It cannot draw yet; the instance on
 *   screen stays until it can.
 * - `abandon`: the new instance is disposed and the one on screen stays. The status check
 *   tries the replacement again.
 * - `swap`: the new instance draws; when NGNE submitted the frame, its canvas takes the
 *   place of the old one, which is disposed.
 */
export type SwapDecision = "wait" | "abandon" | "swap";

/** True for an instance that shows the scene in full. */
export function isHealthy(instance: InstanceState | null): boolean {
    return instance !== null && instance.status === "ready" && !instance.stuck;
}

/**
 * Decides what to do with a loaded replacement `next` for the instance `old` on screen
 * (null when there is none). A failed or disposed renderer never gets on screen. One that is
 * stuck does only when what is on screen is no better.
 */
export function swapDecision(next: InstanceState, old: InstanceState | null): SwapDecision {
    if (next.status === "recovering") return "wait";
    if (next.status !== "ready") return "abandon";
    if (next.stuck && isHealthy(old)) return "abandon";
    return "swap";
}
