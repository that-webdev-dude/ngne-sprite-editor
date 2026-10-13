import { bundle } from "../../../src/core/export";
import { FIXTURES, toBase64 } from "../se-053-documents";

// SE-053 export page: `bundle()` run in the browser, where the editor runs it, on the
// fixture documents of tests/e2e/se-053-documents.ts. The spec writes the bytes to disk as an
// export does, and every conformance check reads the bundle from those files.

window.__se053Export = (fixture) =>
    bundle(FIXTURES[fixture].build()).files.map((file) => ({
        name: file.name,
        data: toBase64(file.bytes),
    }));

const status = document.querySelector("#status");
if (status) status.textContent = "ready";
