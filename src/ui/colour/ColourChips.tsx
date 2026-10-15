import { RotateCcw } from "lucide-react";
import { useId } from "react";
import { RESET_COLOURS, SWAP_COLOURS } from "../../app/colour/colour.commands";
import { useEditor } from "../../app/state/editor";
import { formatHex } from "../../core/color";
import { runCommand } from "../commands/runCommand";
import { Icon } from "../primitives/Icon";
import { IconButton } from "../primitives/IconButton";
import { Tooltip } from "../primitives/Tooltip";
import { cssColour } from "./pickerMath";
import "./colourChips.css";

/**
 * The foreground and background chips at the bottom of the tool rail, with the reset button
 * (DESIGN §5.1): the only FG/BG chips of the interface. The chips are one 28 px button that
 * swaps the two colours, as X does; the reset button restores black on white. Both run the
 * registry's commands. Rendered as two children of the rail footer, which stacks them in one
 * column and puts them side by side in two.
 */
export function ColourChips() {
    const foreground = useEditor((state) => state.foreground);
    const background = useEditor((state) => state.background);
    const describedBy = useId();
    const chip = (slot: "foreground" | "background", colour: number) => (
        <span
            className={`colour-chips__chip colour-chips__chip--${slot}`}
            data-colour-chip={slot}
            data-colour={formatHex(colour, true)}
        >
            <span className="colour-chips__fill" style={{ background: cssColour(colour) }} />
        </span>
    );
    return (
        <>
            <Tooltip label="Swap colours" shortcut="X" side="right">
                <button
                    type="button"
                    className="colour-chips"
                    aria-label="Swap colours"
                    aria-describedby={describedBy}
                    data-colour-chips=""
                    onClick={() => runCommand(SWAP_COLOURS)}
                >
                    {chip("background", background)}
                    {chip("foreground", foreground)}
                    <span id={describedBy} className="ui-visually-hidden">
                        {`Foreground ${formatHex(foreground)}, background ${formatHex(background)}`}
                    </span>
                </button>
            </Tooltip>
            <IconButton
                label="Reset colours"
                tooltipSide="right"
                data-colour-reset=""
                onClick={() => runCommand(RESET_COLOURS)}
            >
                <Icon icon={RotateCcw} />
            </IconButton>
        </>
    );
}
