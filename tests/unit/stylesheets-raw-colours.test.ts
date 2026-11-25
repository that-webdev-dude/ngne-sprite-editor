import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkStylesheets } from "@ngne/editor-ui/styles/check";

// The editor's own stylesheets hold no raw colour value (DESIGN §3.1): every colour comes from
// the design tokens of @ngne/editor-ui. The package's check reads each stylesheet under `src`
// and throws, listing every offence as file:line, when one holds a hex colour, a colour
// function or a named colour.

describe("the editor's stylesheets", () => {
    it("hold no raw colour value", () => {
        expect(() => checkStylesheets(globSync("src/**/*.css"))).not.toThrow();
    });
});
