import type { LucideIcon } from "lucide-react";

/** DESIGN §3.3: icons are 16 px with a 1.5 px stroke in `currentColor`. */
export const ICON_SIZE = 16;
export const ICON_STROKE = 1.5;

/** A lucide icon at the interface's size and stroke; decorative, so hidden from assistive tech. */
export function Icon({ icon: Glyph }: { icon: LucideIcon }) {
    return <Glyph size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />;
}
