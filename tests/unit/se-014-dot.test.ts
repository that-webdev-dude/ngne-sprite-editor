import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { dotTool } from "../../src/app/tools/dot/dot.tools";
import { toolModulePaths, toolRegistry } from "../../src/app/tools/toolRegistry";
import { celImage } from "./se-010-support";
import { createDocument, sequentialIds } from "../../src/core/model";
import { harness, rgbaAt, stroke } from "./se-014-support";

// SE-014: the development-only "dot" tool of `src/app/tools/dot`. The other SE-014 tests use a
// tool of their own (`dotFixture`); SE-015 deletes this file together with the module.

describe("the development dot tool", () => {
    it("is discovered and registered in development builds, with no rail slot and no key", () => {
        const modules = readdirSync(new URL("../../src/", import.meta.url), {
            recursive: true,
            encoding: "utf8",
        }).map((path) => path.replaceAll("\\", "/"));
        expect(modules).toContain("app/tools/dot/dot.tools.ts");
        expect(toolModulePaths).toContain("./dot/dot.tools.ts");
        // Development builds only (Vitest runs as one).
        expect(import.meta.env.DEV).toBe(true);
        const dot = toolRegistry.get("dot");
        expect(dot).toMatchObject({ paints: true, railOrder: undefined, shortcut: undefined });
        expect(dot?.options.map((option) => option.key)).toEqual(["alpha"]);
        expect(toolRegistry.railSlots().map((slot) => slot.id)).not.toContain("dot");
        // A command for the palette, and no key.
        expect(appCommands.get("tool.dot")?.shortcuts).toEqual([]);
    });

    it("writes one pixel per sample in the button's colour, its alpha scaled by the Alpha option", () => {
        const h = harness([dotTool]);
        h.tools.select("dot");
        const { session, history } = h.open(
            createDocument({ name: "dot", width: 8, height: 6 }, sequentialIds("dot-")),
        );
        h.editor.getState().setForeground(0x10203080);
        h.tools.setOption(h.tools.active()!, "alpha", 128);
        stroke(h, [
            { x: 0, y: 0 },
            { x: 2, y: 1 },
        ]);
        expect(history.undoLabel).toBe("Dot");
        const image = celImage(session.doc, session.activeLayerId, session.activeFrameId);
        expect(rgbaAt(image, 0, 0)).toEqual([0x10, 0x20, 0x30, 64]);
        expect(rgbaAt(image, 2, 1)).toEqual([0x10, 0x20, 0x30, 64]);
        // Nothing between two samples.
        expect(rgbaAt(image, 1, 0)).toEqual([0, 0, 0, 0]);
        expect(rgbaAt(image, 1, 1)).toEqual([0, 0, 0, 0]);
        h.tools.setOption(h.tools.active()!, "alpha", 255);
        stroke(h, [{ x: 3, y: 3 }], { button: 2 });
        expect(rgbaAt(image, 3, 3)).toEqual([255, 255, 255, 255]);
    });
});
