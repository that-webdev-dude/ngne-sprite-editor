import { formatChord } from "../../app/commands/chord";
import "./chord.css";

/** A key chord as a key cap: the canonical chord in `data-chord`, shown as menus show it. */
export function Chord({ chord }: { chord: string }) {
    return (
        <kbd className="ui-chord" data-chord={chord}>
            {formatChord(chord)}
        </kbd>
    );
}
