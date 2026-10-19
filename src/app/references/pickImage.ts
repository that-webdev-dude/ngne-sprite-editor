// The PNG file a reference layer is made from (SE-045): a file input, clicked. It touches the
// page only when called, so the command module that imports it loads in Node.

/** A PNG file the user chose: its name and its bytes. */
export interface PickedImage {
    readonly name: string;
    read(): Promise<Uint8Array>;
}

/** Asks for one PNG file; resolves null when the user cancels (Chrome fires `cancel`). */
export function pickPngFile(): Promise<PickedImage | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,.png";
        input.hidden = true;
        input.dataset.referenceFileInput = "";
        const finish = (file: File | null) => {
            input.remove();
            resolve(
                file
                    ? {
                          name: file.name,
                          read: async () => new Uint8Array(await file.arrayBuffer()),
                      }
                    : null,
            );
        };
        input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
        input.addEventListener("cancel", () => finish(null), { once: true });
        document.body.append(input);
        input.click();
    });
}

/** The layer name a file gives: its name without the extension. */
export function layerNameOf(fileName: string): string {
    return fileName.replace(/\.png$/i, "").trim() || "Reference";
}
