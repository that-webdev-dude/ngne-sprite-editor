import { Eraser, Grid2x2, Hand, Layers, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "../primitives/Button";
import { ContextMenu } from "../primitives/ContextMenu";
import type { ContextMenuEntry } from "../primitives/ContextMenu";
import { Dialog } from "../primitives/Dialog";
import { Icon } from "../primitives/Icon";
import { IconButton } from "../primitives/IconButton";
import { NumberField } from "../primitives/NumberField";
import { Popover } from "../primitives/Popover";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Select } from "../primitives/Select";
import { Slider } from "../primitives/Slider";
import { Splitter } from "../primitives/Splitter";
import { Toggle } from "../primitives/Toggle";
import { ToolButton } from "../primitives/ToolButton";
import { Tooltip } from "../primitives/Tooltip";
import { RegionBoundary } from "../shell/RegionBoundary";
import { setTheme, useTheme } from "../theme/theme";
import { toast } from "../toast/toast";
import "./gallery.css";

const TOOLS = [
    { id: "pencil", label: "Pencil", shortcut: "B", icon: Pencil },
    { id: "eraser", label: "Eraser", shortcut: "E", icon: Eraser },
    { id: "hand", label: "Hand", shortcut: "H", icon: Hand },
] as const;

const INKS = [
    { value: "simple", label: "Simple" },
    { value: "alpha", label: "Alpha compositing" },
    { value: "lock", label: "Lock alpha" },
] as const;

const SHAPES = [
    { value: "square", label: "Square" },
    { value: "circle", label: "Circle" },
] as const;

const THEMES = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
] as const;

const SPLIT = { default: 160, min: 80, max: 320 } as const;

function Demo({ id, title, children }: { id: string; title: string; children: ReactNode }) {
    return (
        <section className="gallery__demo" data-demo={id}>
            <h2 className="gallery__title">{title}</h2>
            <div className="gallery__row">{children}</div>
        </section>
    );
}

function Readout({ name, children }: { name: string; children: ReactNode }) {
    return (
        <output className="gallery__readout" data-readout={name}>
            {children}
        </output>
    );
}

function Fragile({ broken }: { broken: boolean }) {
    if (broken) throw new Error("Gallery: the demo panel was asked to fail.");
    return <span>Panel content</span>;
}

/** Development route `/gallery`: every primitive of DESIGN §4, in the theme chosen at the top. */
export function Gallery() {
    const theme = useTheme();
    const [clicks, setClicks] = useState(0);
    const [added, setAdded] = useState(0);
    const [tool, setTool] = useState<(typeof TOOLS)[number]["id"]>("pencil");
    const [size, setSize] = useState(1);
    const [opacity, setOpacity] = useState(100);
    const [tolerance, setTolerance] = useState(32);
    const [grid, setGrid] = useState(false);
    const [pixelPerfect, setPixelPerfect] = useState(true);
    const [ink, setInk] = useState<(typeof INKS)[number]["value"]>("simple");
    const [shape, setShape] = useState<(typeof SHAPES)[number]["value"]>("square");
    const [dialog, setDialog] = useState<"standard" | "large" | null>(null);
    const [spriteSize, setSpriteSize] = useState(32);
    const [onion, setOnion] = useState(2);
    const [action, setAction] = useState("none");
    const [split, setSplit] = useState<number>(SPLIT.default);
    const [broken, setBroken] = useState(false);

    const menu: ContextMenuEntry[] = [
        { id: "duplicate", label: "Duplicate", onSelect: () => setAction("Duplicate") },
        { id: "rename", label: "Rename", shortcut: "F2", onSelect: () => setAction("Rename") },
        { type: "separator", id: "separator" },
        { id: "merge", label: "Merge down", disabled: true, onSelect: () => setAction("Merge") },
        { id: "delete", label: "Delete", onSelect: () => setAction("Delete") },
    ];

    return (
        <div className="gallery">
            <header className="gallery__header">
                <h1 className="gallery__heading">Interface gallery</h1>
                <SegmentedControl
                    label="Theme"
                    value={theme}
                    onChange={setTheme}
                    options={THEMES}
                />
            </header>
            <main className="gallery__grid">
                <Demo id="button" title="Button">
                    <Button onClick={() => setClicks(clicks + 1)}>Default</Button>
                    <Button variant="primary" onClick={() => setClicks(clicks + 1)}>
                        Primary
                    </Button>
                    <Button variant="danger" onClick={() => setClicks(clicks + 1)}>
                        Discard
                    </Button>
                    <Button disabled>Disabled</Button>
                    <Readout name="clicks">Clicks: {clicks}</Readout>
                </Demo>

                <Demo id="icon-button" title="Icon button">
                    <IconButton
                        label="Add frame"
                        shortcut="Alt+N"
                        onClick={() => setAdded(added + 1)}
                    >
                        <Icon icon={Plus} />
                    </IconButton>
                    <IconButton label="New layer" disabled>
                        <Icon icon={Layers} />
                    </IconButton>
                    <Readout name="added">Added: {added}</Readout>
                </Demo>

                <Demo id="tool-button" title="Tool button">
                    {TOOLS.map((entry) => (
                        <ToolButton
                            key={entry.id}
                            label={entry.label}
                            shortcut={entry.shortcut}
                            active={tool === entry.id}
                            onClick={() => setTool(entry.id)}
                        >
                            <Icon icon={entry.icon} />
                        </ToolButton>
                    ))}
                    <Readout name="tool">Active: {tool}</Readout>
                </Demo>

                <Demo id="number-field" title="Number field">
                    <NumberField
                        label="Size"
                        value={size}
                        onChange={setSize}
                        min={1}
                        max={64}
                        unit="px"
                    />
                    <NumberField
                        label="Opacity"
                        value={opacity}
                        onChange={setOpacity}
                        min={0}
                        max={100}
                        unit="%"
                    />
                    <NumberField label="Locked" value={8} onChange={() => {}} unit="px" disabled />
                </Demo>

                <Demo id="slider" title="Slider">
                    <Slider
                        label="Tolerance"
                        value={tolerance}
                        onChange={setTolerance}
                        min={0}
                        max={255}
                    />
                    <Slider label="Locked" value={40} onChange={() => {}} disabled />
                </Demo>

                <Demo id="toggle" title="Toggle">
                    <Toggle label="Pixel grid" pressed={grid} onPressedChange={setGrid}>
                        <Icon icon={Grid2x2} />
                    </Toggle>
                    <Toggle
                        label="Pixel-perfect"
                        showLabel
                        pressed={pixelPerfect}
                        onPressedChange={setPixelPerfect}
                    />
                    <Toggle
                        label="Symmetry"
                        showLabel
                        pressed={false}
                        onPressedChange={() => {}}
                        disabled
                    />
                </Demo>

                <Demo id="select" title="Select">
                    <Select label="Ink" value={ink} onChange={setInk} options={INKS} />
                    <Select
                        label="Locked"
                        value="simple"
                        onChange={() => {}}
                        options={INKS}
                        disabled
                    />
                </Demo>

                <Demo id="segmented" title="Segmented control">
                    <SegmentedControl
                        label="Brush shape"
                        value={shape}
                        onChange={setShape}
                        options={SHAPES}
                    />
                    <Readout name="shape">Shape: {shape}</Readout>
                </Demo>

                <Demo id="dialog" title="Dialog">
                    <Button onClick={() => setDialog("standard")}>Open dialog</Button>
                    <Button onClick={() => setDialog("large")}>Open large dialog</Button>
                    <Dialog
                        open={dialog === "standard"}
                        onOpenChange={(open) => setDialog(open ? "standard" : null)}
                        title="New sprite"
                        actions={
                            <>
                                <Button onClick={() => setDialog(null)}>Cancel</Button>
                                <Button variant="primary" onClick={() => setDialog(null)}>
                                    Create
                                </Button>
                            </>
                        }
                    >
                        <div className="gallery__row">
                            <NumberField
                                label="Width"
                                value={spriteSize}
                                onChange={setSpriteSize}
                                min={1}
                                max={1024}
                                unit="px"
                            />
                            <NumberField
                                label="Height"
                                value={spriteSize}
                                onChange={setSpriteSize}
                                min={1}
                                max={1024}
                                unit="px"
                            />
                        </div>
                    </Dialog>
                    <Dialog
                        open={dialog === "large"}
                        onOpenChange={(open) => setDialog(open ? "large" : null)}
                        title="Export"
                        size="large"
                        actions={
                            <>
                                <Button onClick={() => setDialog(null)}>Cancel</Button>
                                <Button variant="primary" onClick={() => setDialog(null)}>
                                    Export
                                </Button>
                            </>
                        }
                    >
                        <div className="gallery__column">
                            <Select label="Ink" value={ink} onChange={setInk} options={INKS} />
                            {Array.from({ length: 48 }, (_, index) => (
                                <p key={index}>hero_walk_{String(index).padStart(2, "0")}.png</p>
                            ))}
                        </div>
                    </Dialog>
                </Demo>

                <Demo id="popover" title="Popover">
                    <Popover label="Onion skin" trigger={<Button>Open popover</Button>}>
                        <NumberField
                            label="Frames before"
                            value={onion}
                            onChange={setOnion}
                            min={0}
                            max={8}
                        />
                        <Toggle
                            label="Within tag"
                            showLabel
                            pressed={grid}
                            onPressedChange={setGrid}
                        />
                    </Popover>
                </Demo>

                <Demo id="context-menu" title="Context menu">
                    <ContextMenu items={menu}>
                        <div
                            className="gallery__target"
                            tabIndex={0}
                            role="group"
                            aria-label="Layer"
                        >
                            Right-click, or focus and press the Menu key
                        </div>
                    </ContextMenu>
                    <Readout name="action">Last action: {action}</Readout>
                </Demo>

                <Demo id="tooltip" title="Tooltip">
                    <Tooltip label="Shown after 400 ms" shortcut="Ctrl+K">
                        <Button>Hover or focus</Button>
                    </Tooltip>
                </Demo>

                <Demo id="splitter" title="Splitter">
                    <div className="gallery__split">
                        <div className="gallery__pane" style={{ width: split }}>
                            Pane
                        </div>
                        <Splitter
                            orientation="vertical"
                            label="Resize pane"
                            value={split}
                            min={SPLIT.min}
                            max={SPLIT.max}
                            onChange={setSplit}
                            onReset={() => setSplit(SPLIT.default)}
                        />
                        <div className="gallery__pane gallery__pane--rest">Rest</div>
                    </div>
                    <Readout name="split">Width: {split}</Readout>
                </Demo>

                <Demo id="toast" title="Toast">
                    <Button onClick={() => toast.info("Saved hero.ngsprite")}>Show toast</Button>
                    <Button onClick={() => toast.error("Import failed: not a PNG file")}>
                        Show error toast
                    </Button>
                </Demo>

                <Demo id="boundary" title="Error boundary">
                    <Button onClick={() => setBroken(true)}>Break panel</Button>
                    <Button onClick={() => setBroken(false)}>Repair panel</Button>
                    <div className="gallery__panel">
                        <RegionBoundary name="Demo panel">
                            <Fragile broken={broken} />
                        </RegionBoundary>
                    </div>
                </Demo>
            </main>
        </div>
    );
}
