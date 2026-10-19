import type { Page } from "@playwright/test";
// Modules the page imports from the dev server, for the types of what they export.
import type * as CoreHistory from "../../src/core/history";
import type * as CoreLayers from "../../src/core/layers";
import type * as CorePng from "../../src/core/png";
import type * as AppReferences from "../../src/app/references/references";
import type { ReferenceChange } from "../../src/core/references";
import type { Rgb } from "./se-011-support";

// Shared helpers of the SE-045 specs: reference images made in the page, reference layers added
// and changed through the app's own functions, and what NGNE is expected to show.

/** An image the page makes: flat colour, or the two-axis gradient of the quality test. */
export type ImageSpec =
    | { kind: "flat"; width: number; height: number; rgba: readonly number[] }
    | { kind: "gradient"; width: number; height: number }
    /**
     * Columns one pixel wide: `rgba` in the even ones, `other` in the odd ones (opaque black
     * and white, or a colour and transparent black).
     */
    | {
          kind: "columns";
          width: number;
          height: number;
          rgba: readonly number[];
          other: readonly number[];
      };

/**
 * Adds a reference layer to the active document from a PNG the page encodes, through
 * `addReferenceLayerFromPng`; resolves with the new layer's ID, or null when it was refused.
 */
export function addReference(
    page: Page,
    image: ImageSpec,
    options: AppReferences.AddReferenceOptions = {},
): Promise<string | null> {
    return page.evaluate(
        async ({ image, options }) => {
            const pngPath = "/src/core/png/index.ts";
            const png = (await import(/* @vite-ignore */ pngPath)) as typeof CorePng;
            const referencesPath = "/src/app/references/references.ts";
            const references = (await import(
                /* @vite-ignore */ referencesPath
            )) as typeof AppReferences;
            const { width, height } = image;
            const data = new Uint8ClampedArray(width * height * 4);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const at = (y * width + x) * 4;
                    if (image.kind === "flat") {
                        data.set(image.rgba, at);
                    } else if (image.kind === "columns") {
                        data.set(x % 2 === 0 ? image.rgba : image.other, at);
                    } else {
                        // A smooth gradient along both axes (SE-045 acceptance).
                        data[at] = Math.round((x * 255) / (width - 1));
                        data[at + 1] = Math.round((y * 255) / (height - 1));
                        data[at + 2] = Math.round(((x + y) * 255) / (width + height - 2));
                        data[at + 3] = 255;
                    }
                }
            }
            const bytes = png.encodePng({ width, height, data });
            return references.addReferenceLayerFromPng(bytes, options);
        },
        { image, options },
    );
}

/** Sets a layer's opacity through the active document's history (one step). */
export function setOpacity(page: Page, layerId: string, opacity: number): Promise<void> {
    return page.evaluate(
        async ({ layerId, opacity }) => {
            const layersPath = "/src/core/layers/index.ts";
            const layers = (await import(/* @vite-ignore */ layersPath)) as typeof CoreLayers;
            const state = window.__ngneTest!.sessions.getState();
            const document = state.documents.find((entry) => entry.id === state.activeId)!;
            const command = layers.setLayerOpacityCommand(document.session, layerId, opacity);
            if (command) document.history.execute(command);
        },
        { layerId, opacity },
    );
}

/** Shows or hides a layer through the active document's history (one step). */
export function setVisible(page: Page, layerId: string, visible: boolean): Promise<void> {
    return page.evaluate(
        async ({ layerId, visible }) => {
            const layersPath = "/src/core/layers/index.ts";
            const layers = (await import(/* @vite-ignore */ layersPath)) as typeof CoreLayers;
            const state = window.__ngneTest!.sessions.getState();
            const document = state.documents.find((entry) => entry.id === state.activeId)!;
            const command = layers.setLayerVisibleCommand(document.session, layerId, visible);
            if (command) document.history.execute(command);
        },
        { layerId, visible },
    );
}

/**
 * Changes a reference layer through `changeReference` (one step); resolves whether a step was
 * recorded.
 */
export function changeReference(
    page: Page,
    layerId: string,
    change: ReferenceChange,
): Promise<boolean> {
    return page.evaluate(
        async ({ layerId, change }) => {
            const referencesPath = "/src/app/references/references.ts";
            const references = (await import(
                /* @vite-ignore */ referencesPath
            )) as typeof AppReferences;
            return references.changeReference(layerId, change).changed;
        },
        { layerId, change },
    );
}

/**
 * Deletes a layer of the active document as Delete Layer does with it active and nothing
 * selected (one step, its source taken out of the store).
 */
export function deleteLayer(page: Page, layerId: string): Promise<void> {
    return page.evaluate((layerId) => {
        const hooks = window.__ngneTest!;
        const state = hooks.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        document.session.activeLayerId = layerId;
        state.touch(document.id);
        const command = hooks.commands.get("layer.delete")!;
        if (!command.enabled()) throw new Error("se-045: Delete Layer is disabled");
        void command.run();
    }, layerId);
}

/**
 * Writes `rgba` into one texel of the active cel's image through a patch command of the
 * history (`pixelPatchCommand`): one undo step. The cel must exist.
 */
export function patchTexel(
    page: Page,
    texel: { x: number; y: number },
    rgba: readonly number[],
): Promise<void> {
    return page.evaluate(
        async ({ texel, rgba }) => {
            const historyPath = "/src/core/history/index.ts";
            const history = (await import(/* @vite-ignore */ historyPath)) as typeof CoreHistory;
            const state = window.__ngneTest!.sessions.getState();
            const document = state.documents.find((entry) => entry.id === state.activeId)!;
            const { doc, activeLayerId, activeFrameId } = document.session;
            const cel = doc.cels.get(`${activeLayerId}:${activeFrameId}`);
            if (!cel) throw new Error("se-045: the active cel is empty");
            const pixels = { width: 1, height: 1, data: new Uint8ClampedArray(rgba) };
            document.history.execute(
                history.pixelPatchCommand(doc, {
                    label: "Patch",
                    imageId: cel.imageId,
                    x: texel.x,
                    y: texel.y,
                    pixels,
                }),
            );
        },
        { texel, rgba: [...rgba] },
    );
}

/** The reference layers of the active document, bottom to top, as the model holds them. */
export function referenceLayers(page: Page) {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        return document.session.doc.layers.flatMap((layer) =>
            layer.kind === "reference"
                ? [
                      {
                          id: layer.id,
                          name: layer.name,
                          visible: layer.visible,
                          locked: layer.locked,
                          opacity: layer.opacity,
                          x: layer.x,
                          y: layer.y,
                          scale: layer.scale,
                          placement: layer.placement,
                      },
                  ]
                : [],
        );
    });
}

/** The active document's undo count and layer count. */
export function historyState(page: Page): Promise<{ undo: number; layers: number }> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId)!;
        return { undo: document.history.undoCount, layers: document.session.doc.layers.length };
    });
}

/** NGNE's premultiplied source-over of `colour` at `alpha` (0..1) over an opaque backdrop. */
export function over(colour: readonly number[], alpha: number, under: Rgb): number[] {
    return [0, 1, 2].map(
        (channel) => (colour[channel] ?? 0) * alpha + under[channel]! * (1 - alpha),
    );
}
