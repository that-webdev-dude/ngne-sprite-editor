import type { PickedImage } from "../references/pickImage";

// The PNG files File → Import PNG reads (SE-044): a file input that takes several files,
// clicked. It touches the page only when called, so the modules that import it load in Node.

/** Asks for PNG files; resolves null when the user cancels (Chrome fires `cancel`). */
export function pickPngFiles(): Promise<PickedImage[] | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,.png";
        input.multiple = true;
        input.hidden = true;
        input.dataset.importFileInput = "";
        const finish = (files: readonly File[] | null) => {
            input.remove();
            resolve(
                files && files.length > 0
                    ? files.map((file) => ({
                          name: file.name,
                          read: async () => new Uint8Array(await file.arrayBuffer()),
                      }))
                    : null,
            );
        };
        input.addEventListener("change", () => finish(Array.from(input.files ?? [])), {
            once: true,
        });
        input.addEventListener("cancel", () => finish(null), { once: true });
        document.body.append(input);
        input.click();
    });
}

/** Whether a file's name says it is a PNG image. */
export function isPngName(name: string): boolean {
    return /\.png$/i.test(name.trim());
}

/** The name a document or a layer takes from a file: its name without the extension. */
export function baseNameOf(fileName: string, fallback: string): string {
    return fileName.replace(/\.[^./\\]*$/, "").trim() || fallback;
}
