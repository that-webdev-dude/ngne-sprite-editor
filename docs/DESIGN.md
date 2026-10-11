# NGNE Sprite Editor — Interface design

Status: **Draft — pending independent review** · 2026-10-11

Related: [SPEC.md](SPEC.md) · static mockup: [design/mockup.html](design/mockup.html) (open in a browser)

## 1. Principles

1. **The artwork is the only colour.** Chrome is neutral grey with no hue cast, so it never
   biases colour judgement. One accent, used only for selection, focus and the active tool.
2. **Dense, quiet, flat.** 1 px hairlines instead of shadows and cards. No gradients, no
   decorative icons, no panel titles that restate the obvious.
3. **Canvas first.** Panels are narrow and collapsible; the viewport takes every remaining pixel.
4. **Aseprite's map, modern manners.** Same regions and shortcuts an Aseprite user expects;
   vector type, real menus, a command palette, keyboard-reachable everything.
5. **State is visible.** Active layer, frame, tool, zoom, cursor position and unsaved status are
   always on screen; nothing important hides in a mode.

## 2. Layout

```text
+------------------------------------------------------------------------+
| File Edit Sprite Layer Frame Select View     hero.ngsprite *     Ctrl K | 36  menu bar
+----+------------------------------------------------------+------------+
|    | Pencil   Size [ 1 ]  Shape [o]  Pixel-perfect [x]    |  Colour    | 36  context bar
| T  +------------------------------------------------------+  picker    |
| o  |                                                      |  FG / BG   |
| o  |                                                      +------------+
| l  |                 viewport (NGNE canvas                |  Palette   |
| s  |                 + Canvas2D overlay)                  |            |
|    |                                                      +------------+
| 44 |                                                      |  Preview   | 264 right dock
+----+------------------------------------------------------+------------+
| |< < > >|  12 fps   [ walk ============ ][ jump ==== ]                  |
| Layers            1    2    3    4    5    6    7    8                  | 200 timeline
| (o)(a) Outline    #    #    #    #    -    -    #    #                  |
| (o)(a) Body       #    #====#    #    #    #    #    #                  |
+------------------------------------------------------------------------+
| 14, 9   32 x 32   12x   Frame 3/8   100 ms        Shift: constrain line | 24  status bar
+------------------------------------------------------------------------+
```

| Region      | Size                         | Behaviour                                                     |
| ----------- | ---------------------------- | ------------------------------------------------------------- |
| Menu bar    | 36 px                        | Menus, document tabs (centre), command palette trigger        |
| Tool rail   | 44 px wide                   | One column of 28 px icon buttons, grouped by separators       |
| Context bar | 36 px                        | Options for the active tool only                              |
| Viewport    | flexible                     | Workspace colour around the document; no scrollbars           |
| Right dock  | 264 px, resizable 220–360    | Colour, Palette, Preview; each section collapsible            |
| Timeline    | 200 px, resizable 120–50%    | Transport, tag bar, layer rows × frame columns; Tab toggles   |
| Status bar  | 24 px                        | Cursor, size, zoom, frame, duration; right side: contextual hint |

Below 1024×640 the app shows a "window too small" notice instead of a broken layout.

## 3. Tokens

All colour, spacing, radius and type values are CSS custom properties on `:root`; components use
tokens only. Dark is the default; light is a full second set under `[data-theme="light"]`.

### 3.1 Colour

| Token              | Dark      | Light     | Use                                         |
| ------------------ | --------- | --------- | ------------------------------------------- |
| `--bg-workspace`   | `#0f0f10` | `#d9d9db` | Area around the document                    |
| `--bg-panel`       | `#18181a` | `#f4f4f5` | Panels, bars                                |
| `--bg-raised`      | `#222225` | `#ffffff` | Inputs, hovered rows, popovers              |
| `--bg-active`      | `#2c2c30` | `#e6e6e9` | Pressed, selected row                       |
| `--border`         | `#2a2a2e` | `#d0d0d4` | Hairlines between regions                   |
| `--border-strong`  | `#3a3a40` | `#b4b4ba` | Input outlines                              |
| `--text`           | `#e7e7ea` | `#18181a` | Primary text                                |
| `--text-muted`     | `#9a9aa2` | `#5c5c66` | Labels, secondary                           |
| `--text-faint`     | `#6b6b74` | `#8a8a94` | Disabled, placeholders                      |
| `--accent`         | `#83e8e1` | `#0b8f87` | Active tool, selection, focus ring          |
| `--accent-contrast`| `#0f0f10` | `#ffffff` | Text on accent                              |
| `--danger`         | `#ff6b6b` | `#c92a2a` | Destructive confirm, errors                 |
| `--warn`           | `#f2c14e` | `#9a6700` | Unsaved marker, warnings                    |

- The accent is NGNE's brand cyan. It appears on at most a few elements per screen.
- Text on panel backgrounds meets WCAG AA (≥ 4.5:1); `--text-muted` is ≥ 4.5:1 on `--bg-panel`.
- Tag colours and palette swatches are user data and are the only other hues on screen.
- Transparency checkerboard: `#3a3a3a` / `#4a4a4a` (dark), `#c8c8c8` / `#ffffff` (light); user-configurable.

### 3.2 Type

- UI: `Inter, "Segoe UI", system-ui, sans-serif`. No web-font download; Inter is used if installed.
- Numeric readouts: same family with `font-variant-numeric: tabular-nums`.
- Sizes: 12 px body and controls, 11 px labels and status bar, 13 px dialog titles. Line height 16 px.
- Weights: 400 body, 500 active/selected and titles. No bold, no uppercase labels.

### 3.3 Space, shape, motion

| Token          | Value                                   |
| -------------- | --------------------------------------- |
| Spacing scale  | 2, 4, 8, 12, 16, 24 px                  |
| Control height | 24 px (inputs, buttons), 28 px (tool buttons, rows) |
| Radius         | 4 px controls, 6 px popovers and dialogs, 0 for regions |
| Border         | 1 px, `--border`                        |
| Focus ring     | 2 px `--accent`, 1 px offset, keyboard focus only |
| Elevation      | Popovers and dialogs only: `0 8px 24px rgb(0 0 0 / 0.4)` |
| Motion         | 100 ms ease-out for hover/press; popovers 120 ms fade; none on the canvas |
| Icons          | 16 px, 1.5 px stroke, `currentColor`    |

`prefers-reduced-motion`: transitions off, marching ants static (dashed, not animated).

## 4. Components

| Component        | Notes                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| Menu bar         | Radix Menubar; shortcuts right-aligned in `--text-muted`; disabled items stay visible   |
| Command palette  | Ctrl+K; fuzzy search over the command registry; shows shortcut; Enter runs              |
| Tool button      | 28 px; active = accent icon on `--bg-active`; tooltip with name and key after 400 ms    |
| Icon button      | 24 px; hover `--bg-raised`; `aria-label` required                                       |
| Number field     | Scrub by dragging the label; arrow keys ±1, Shift ±10; unit suffix muted                |
| Slider           | 2 px track, 10 px thumb; value shown in an adjacent number field                        |
| Toggle           | Icon button with `aria-pressed`; no switches                                            |
| Select           | Radix Select; same metrics as number field                                              |
| Dialog           | Centre, max 560 px; title, body, right-aligned actions; primary action is accent-filled |
| Popover          | Colour picker, tag editor, layer properties; closes on Escape and outside click         |
| Context menu     | Right-click on layers, frames, cels, tags, swatches, canvas                             |
| Toast            | Bottom-centre, one line, 4 s; used for export results and non-blocking errors           |
| Splitter         | 4 px hit area, 1 px visible line; double-click resets                                   |

## 5. Panels

### 5.1 Tool rail

Groups, top to bottom: draw (pencil, eraser, bucket, eyedropper) · shapes (line, rectangle,
ellipse) · select (marquee, lasso, wand, move) · navigate (hand, zoom). Tools with variants
(rectangle/ellipse marquee, lasso/polygon lasso) show a corner mark; press-and-hold or repeat
the key to switch. Foreground/background swatches sit at the bottom with swap (X) and reset (D).

### 5.2 Context bar

Shows only the active tool's options, left-aligned, in a fixed order: size · shape · mode
toggles · tolerance · ink · opacity. Selection tools show add/subtract/intersect toggles.
With a floating selection it switches to transform fields (X, Y, W, H, angle) and Apply / Cancel.

### 5.3 Colour

Square saturation/value field with a hue strip and alpha strip; hex field; H S V / R G B fields
toggled by a small segmented control. Foreground and background chips above. No colour-wheel
variants, no harmony tools.

### 5.4 Palette

Grid of 16 px swatches, no gaps, 1 px `--border` around the grid. Left-click sets foreground,
right-click background. The swatch matching the foreground colour has a 2 px accent outline.
Header: palette name (menu of presets), add current colour, and an overflow menu (import,
export, from sprite, sort).

### 5.5 Preview

The NGNE preview canvas, centred, integer-scaled to fit. Under it: animation select, play/pause,
speed. The header reads "Preview · NGNE" to signal that this is the engine drawing the export.
Background chip cycles dark / light / mid grey.

### 5.6 Timeline

- Left column (200 px): per layer — visibility, lock, name (double-click renames), opacity on
  hover. Reference layers sit in a separate bottom group labelled "Reference".
- Header row: frame numbers; the tag bar sits above it with coloured spans and tag names.
- Cells: 24×24 px. Empty cel = small hollow dot; filled cel = solid dot; linked cels are joined
  by a line. Active cell has an accent outline; the active frame column and layer row are
  tinted with `--bg-raised`.
- Transport on the left of the tag bar: first, previous, play/pause, next, last, onion-skin
  toggle, frame duration field.
- Drag frames or layers to reorder; drag cels to move, Ctrl-drag to copy.

### 5.7 Status bar

Left to right: cursor `x, y` · document size · zoom · frame `n/total` · frame duration ·
selection size when one exists. Right: one-line hint for the active tool's modifiers. Errors
that do not need a dialog also appear here in `--warn`.

## 6. Viewport

- Workspace is `--bg-workspace`; the document has a 1 px `--border-strong` outline outside its
  bounds and no drop shadow.
- Pixel grid appears at ≥ 8× as 1 px lines at 12% white/black; tile grid at 25%.
- Selection: 1 px marching ants, black and white dashes, 4 px period, 8 steps per second.
- Brush cursor: 1 px outline of the brush footprint snapped to pixels, inverted against content;
  the system cursor is hidden over the canvas while a paint tool is active.
- Zoom readout and "fit" live in the status bar, not as floating buttons over the canvas.

## 7. Dialogs

| Dialog          | Content                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| New sprite      | Width, height, presets (16, 32, 48, 64, 128), name                                       |
| Import PNG      | Left: source with crop/grid overlay. Right: result at target size, zoomable. Below: the nine steps of SPEC §8 as one compact form; a result line "8 frames · 32×32 · 16 colours" |
| Export          | Bundle options (SPEC §9.4), resulting file list with sizes, final frame/animation IDs, destination folder, "Export on save" |
| Canvas / Sprite size | Numeric fields, anchor grid, resample method                                        |
| Tag             | Name, colour, range, direction, repeat                                                   |
| Preferences     | Theme, checkerboard, grid, onion skin defaults, shortcut sheet                           |
| WebGPU required | Full-window notice: what is missing, supported browsers, how to enable acceleration      |

Destructive actions (delete layer with content, close unsaved document) confirm once; everything
else relies on undo.

## 8. Accessibility

- Every command is reachable by keyboard via menu or palette; visible focus on all controls.
- Radix primitives supply roles, focus trapping and typeahead for menus and dialogs.
- Icon-only controls carry `aria-label` and a tooltip.
- Text contrast AA in both themes; hit targets ≥ 24×24 px.
- The canvas itself is a pointer surface and is not screen-reader operable; this is stated in
  the README rather than faked.
