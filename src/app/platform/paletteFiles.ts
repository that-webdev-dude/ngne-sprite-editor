/**
 * Choosing a palette file to import (SE-066): the open picker of File System Access where the
 * browser has it, otherwise a file input, as `projectFiles.ts` opens a project. The picker
 * offers the palette formats of `core/palettes`. Exports of a palette are saved through the
 * export platform (`exportFiles.ts`, `ExportPlatform.chooseFile`). Like the other platform
 * modules, this touches the page only when it is called, so modules that import it also load
 * in Node.
 */
import { PALETTE_FORMATS } from "../../core/palettes";

/** A palette file the user chose: its name, its size and its bytes. */
export interface ChosenPaletteFile {
    readonly name: string;
    /** Its size in bytes, known before it is read. */
    readonly size: number;
    read(): Promise<Uint8Array>;
}

/** Asks for a palette file; null when the user cancels. */
export type ChoosePaletteFile = () => Promise<ChosenPaletteFile | null>;

/** The pickers remember the last folder under this id. */
const PICKER_ID = "ngne-sprite-palette";

const EXTENSIONS = Object.values(PALETTE_FORMATS).map((info) => info.extension);

/** What the open picker offers: one entry of every palette format. */
const PICKER_TYPES = [
    {
        description: "Palette file",
        accept: {
            "text/plain": EXTENSIONS.filter((extension) => extension !== ".png"),
            "image/png": [".png"],
        },
    },
];

interface NativeFile {
    readonly name: string;
    getFile(): Promise<File>;
}

interface OpenPickerWindow {
    showOpenFilePicker?(options: {
        id: string;
        types: typeof PICKER_TYPES;
        multiple: boolean;
    }): Promise<NativeFile[]>;
}

function chosen(file: File): ChosenPaletteFile {
    return {
        name: file.name,
        size: file.size,
        read: async () => new Uint8Array(await file.arrayBuffer()),
    };
}

/** A file input, clicked; resolves null when the user cancels (Chrome fires `cancel`). */
function inputToOpen(): Promise<ChosenPaletteFile | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = EXTENSIONS.join(",");
        input.hidden = true;
        input.dataset.paletteFileInput = "";
        const finish = (file: File | null) => {
            input.remove();
            resolve(file ? chosen(file) : null);
        };
        input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
        input.addEventListener("cancel", () => finish(null), { once: true });
        document.body.append(input);
        input.click();
    });
}

/** The page's way to choose a palette file. */
export const choosePaletteFile: ChoosePaletteFile = async () => {
    const show = (window as unknown as OpenPickerWindow).showOpenFilePicker;
    if (typeof show !== "function") return inputToOpen();
    let handles: NativeFile[];
    try {
        handles = await show.call(window, { id: PICKER_ID, types: PICKER_TYPES, multiple: false });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return null;
        throw error;
    }
    const [native] = handles;
    return native ? chosen(await native.getFile()) : null;
};
