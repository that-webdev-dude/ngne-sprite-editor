# NGNE Sprite Editor — Interface design

Status: **Ready for implementation — owner acknowledgements A1–A9 recorded** ([REVIEW.md](REVIEW.md)) · 2026-10-11

Related: [SPEC.md](SPEC.md) · static mockup: [design/mockup.html](design/mockup.html) (open in a
browser). The mockup illustrates layout, tokens and density; where it omits a control described
here, this document governs.

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
| o  |                                                      |            |
| o  |                                                      +------------+
| l  |                 viewport (NGNE canvas                |  Palette   |
| s  |                 + Canvas2D overlay)                  |            |
|    |                                                      +------------+
| 44 |                                                      |  Preview   | 264 right dock
+----+------------------------------------------------------+------------+
| |< < > >| (onion) [100 ms]  [ walk ============ ][ jump ==== ]          |
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
| Timeline    | default min(200 px, 28% of window height), resizable 120 px–50% | Transport, tag bar, layer rows × frame columns; Tab toggles (canvas focus) |
| Status bar  | 24 px                        | Cursor, size, zoom, frame, duration; right side: contextual hint |

Overflow rules (the layout must hold at the minimum window, 1280×720):

- **Tool rail**: when its content does not fit its height in one column it switches to two
  columns (72 px wide); it never scrolls and never clips a tool.
- **Right dock**: scrolls vertically as one column; section headers stay clickable to collapse.
  Default at window heights under 800 px: Palette collapsed.
- **Context bar**: options that do not fit move into a trailing overflow menu.
- **Document tabs**: shrink to 96 px, then scroll horizontally with an overflow menu.
- **Tag bar**: grows by one 18 px row per overlap level, up to three rows, then scrolls.
- Below 1280×720 the app shows a "window too small" notice instead of a broken layout.

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
| `--border`         | `#2a2a2e` | `#d0d0d4` | Hairlines between regions (decorative)      |
| `--border-strong`  | `#3a3a40` | `#b4b4ba` | Document outline, dividers inside controls  |
| `--border-input`   | `#70707a` | `#8a8a94` | Outline of inputs, selects, segmented controls (≥ 3:1 against their fill) |
| `--text`           | `#e7e7ea` | `#18181a` | Primary text                                |
| `--text-muted`     | `#9a9aa2` | `#5c5c66` | Labels, secondary content, hints, placeholders |
| `--text-faint`     | `#6b6b74` | `#8a8a94` | Disabled controls only                      |
| `--accent`         | `#83e8e1` | `#087f78` | Active tool, selection, focus ring, primary button |
| `--accent-contrast`| `#0f0f10` | `#ffffff` | Text on accent                              |
| `--danger`         | `#ff6b6b` | `#c92a2a` | Destructive confirm, errors                 |
| `--warn`           | `#f2c14e` | `#8a5a00` | Unsaved marker, warnings                    |

- The dark accent is NGNE's brand cyan. Accent appears on at most a few elements per screen.
- Contrast (WCAG 2.1 AA): `--text` and `--text-muted` on every background ≥ 4.5:1;
  `--accent-contrast` on `--accent` ≥ 4.5:1; `--warn` and `--danger` on `--bg-panel` ≥ 4.5:1;
  `--border-input` against `--bg-raised` ≥ 3:1. `--text-faint` is exempt because it is used
  only for disabled controls.
- Text placed on user colours (tag spans) is black or white, whichever has the higher contrast.
- Tag colours and palette swatches are user data and are the only other hues on screen.
- Transparency checkerboard: `#3a3a3a` / `#4a4a4a` (dark), `#c8c8c8` / `#ffffff` (light);
  user-configurable.

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
| Border         | 1 px                                    |
| Focus ring     | 2 px `--accent`, 1 px offset, keyboard focus only |
| Elevation      | Popovers and dialogs only: `0 8px 24px rgb(0 0 0 / 0.4)` |
| Motion         | 100 ms ease-out for hover/press; popovers 120 ms fade. The only animation over the canvas is the marching ants |
| Icons          | 16 px, 1.5 px stroke, `currentColor`    |

`prefers-reduced-motion`: transitions off, marching ants static (dashed, not animated).

## 4. Components

| Component        | Notes                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| Menu bar         | Radix Menubar; shortcuts right-aligned in `--text-muted`; disabled items stay visible   |
| Command palette  | Ctrl+K; fuzzy search over the command registry; shows menu, shortcut and disabled state (disabled commands are listed, inert); the commands last run from it come first (kept in `localStorage`); Enter runs |
| Tool button      | 28 px; active = accent icon on `--bg-active`; tooltip with name and key after 400 ms    |
| Icon button      | 24 px; hover `--bg-raised`; `aria-label` required                                       |
| Number field     | Scrub by dragging the label; arrow keys ±1, Shift ±10; unit suffix muted                |
| Slider           | 2 px track, 10 px thumb inside a 24 px hit area; value in an adjacent number field      |
| Toggle           | Icon button with `aria-pressed`; no switches                                            |
| Select           | Radix Select; same metrics as number field                                              |
| Dialog           | Centred. Standard: max 560 px. Large (Import PNG, Export): max 960 px, max 86% of window height, body scrolls. Title, body, right-aligned actions; primary action accent-filled |
| Popover          | Colour picker, layer properties, onion-skin settings; closes on Escape and outside click |
| Context menu     | Right-click on layers, frames, cels and tags. Not on the canvas or on swatches, where the right button means background colour; swatch actions live in the palette's overflow menu and on the Menu key |
| Toast            | Bottom-centre, one line, 4 s (errors stay until dismissed)                              |
| Splitter         | 8 px hit area, 1 px visible line; double-click resets                                   |

Message channels: a **toast** reports the result of an explicit command (saved, exported,
import failed) and asynchronous failures; the **status bar** shows transient tool feedback
(layer locked, selection size) and hints; a **dialog** is used only when a decision is needed.
An error boundary around each region replaces a crashed panel with a one-line message and a
Reload action, leaving the rest of the app usable.

## 5. Panels

### 5.1 Tool rail

Groups, top to bottom: draw (pencil, eraser, bucket, eyedropper) · shapes (line, rectangle,
ellipse) · select (marquee, lasso, wand, move) · navigate (hand, zoom). Tools with variants
(rectangle/ellipse marquee, lasso/polygon lasso; eraser/spray, ellipse/curve, and
rectangle/contour/polygon, SE-065) show a corner mark; press-and-hold or repeat the key to
switch. The variants of SE-065 sit in the rail's 13 slots so that B and L, the keys used most,
stay idempotent: the spray (Shift+B) joins the eraser and the curve (Shift+L) the ellipse,
whose keys have other letters, while the contour (D) and the polygon (Shift+D) share the
rectangle's slot and switch between each other as the marquees do (Aseprite's groups would put
the spray with the pencil and the curve with the line; SE-065 review). Such a button shows the
variant selected last (its icon, name and key) and
selects it on a click. A press held 300 ms, a right click or the Menu key (Shift+F10) opens the
menu of the slot's variants beside the button — icon, name and key, the shown one checked — and
a choice there selects it (a release over an item after the held press chooses it too; a
release over the button selects nothing). The menu is not modal: a press outside closes it and
acts where it lands. Chosen with the pointer, the focus goes to the viewport; from the keyboard,
back to the button. A tool's key pressed again while that tool is selected selects the next of
its slot's variants whose key is the same letter, so M and Shift+M each switch between the two
marquees, and a key never switches to a variant of another letter (SE-031). Run from the
palette or a menu, a tool's command selects exactly that tool. Foreground/background chips sit
at the bottom with swap (X) and a reset button; these are the only FG/BG chips in the
interface. The chips are one 28 px button, the
foreground over the upper left of the background as in the mockup, that swaps them as X does;
the reset button (24 px icon) restores black on white. One column stacks them, two columns put
them side by side. The rail has one column when the planned content stacked in one column fits
its height — every tool slot of the registry in its groups, the separators, and the chips over
the reset button — and two columns otherwise, whatever is rendered (a rail whose content
failed keeps the layout). At 1280×720 with the default timeline it does not fit (SE-016).

### 5.2 Context bar

Shows only the active tool's options, left-aligned, in a fixed order: size · shape · mode
toggles · tolerance · ink · opacity. The spray's radius and density follow the shape (SE-065).
A change made while the curve or the polygon is open shows here but applies from the next one:
a gesture keeps the options of its first press (SE-065 review). Selection tools show
add/subtract/intersect toggles: one
segmented control, Mode, of Replace, Add, Subtract and Intersect (SE-031); Shift, Alt and
Shift+Alt at the press stand in for it for one gesture.
With a floating selection it switches to transform fields (X, Y, W, H, angle) and Apply / Cancel.

### 5.3 Colour

Square saturation/value field with a hue strip and alpha strip (each 10 px tall inside a 24 px
hit area); hex field; H S V / R G B fields toggled by a small segmented control. The panel edits
the foreground colour; holding the right button or pressing X first edits the background. No
colour-wheel variants, no harmony tools.

- While the right button is held in the field or a strip, the panel shows the background and
  the drag, and any key pressed meanwhile, edits it; at the release the panel shows the
  foreground again (SE-016).
- Fields: H in degrees (0–360), S and V in percent, or R G B (0–255); the hex field shows
  "#RRGGBB", or "#RRGGBBAA" for a colour that is not opaque, and takes 3, 4, 6 or 8 digits.
  Alpha is set with its strip or the hex field.
- Keys: on the field ← → change saturation and ↑ ↓ value; on the strips ← → (and ↑ ↓) change
  hue or alpha; one step is 1% / 1° / 1, ten with Shift; Home and End go to the ends (on the
  field, of saturation); Page Up and Page Down step by ten.
- Handles are a ring of `--text` inside `--bg-workspace`, so they show on any colour in either
  theme.

### 5.4 Palette

Grid of 16 px swatches, no gaps, 1 px `--border` around the grid; vertical scroll when it
exceeds eight rows. Left-click sets foreground, right-click background. The swatch matching the
foreground colour has a 2 px accent outline. Header: palette name (menu of presets), add current
colour, and an overflow menu (remove, edit, import, export, from sprite, sort, replace colour).
The outline lies inside the swatch, as in the mockup, on the first swatch of the foreground's
colour. With no document open the section is empty and its header has no controls. Every change
of the palette is one undo step of the document (SPEC §7.1, Palette). SE-016 made the grid,
SE-060 the rest:

- **Grid.** As many columns as fit the section, less the scroll bar's width while it scrolls,
  so the grid never overflows sideways at any dock width. The grid is one tab stop: the arrow
  keys move the focus, Home and End go to the ends, Enter sets the foreground and Shift+Enter
  the background (no Space); the `canvas` letter and digit keys still act from a focused swatch,
  the grid not being a typeahead role. The *current swatch* is the grid's tab stop: the swatch
  last pressed, with either button, or reached with the keys. Remove and Edit act on it. It
  carries a 6 px dot in its centre, `--text` in a 1 px `--bg-workspace` ring, so it shows on any
  colour in either theme, apart from the foreground's outline and inside it when one swatch is
  both.
- **Reorder.** A left drag moves a swatch: the grid shows the order the drop makes, a release
  over the grid moves it, Escape or a release outside the grid leaves the order, and so does a
  change of the palette during the drag (an undo, say); the grid does not scroll by itself
  during the drag (the wheel scrolls it). Ctrl+← and Ctrl+→ on a focused swatch move it one
  place, Ctrl+↑ and Ctrl+↓ one row; the focus goes with it.
- **Header.** The palette name, cut short with an ellipsis, opens the menu of the preset
  palettes (SPEC §2.3, §8) by name; one replaces the palette's name and colours. The add
  button appends the foreground, which becomes the current swatch; it is disabled while the
  palette holds the foreground or 256 colours. The overflow menu ("Swatch actions") holds
  Remove Colour and Edit Colour…, then Palette from Sprite; it is the registry's context menu
  `palette`, in groups of hundreds (100 remove and edit, 300 from sprite), leaving the 200s to
  import and export and the 400s to sort and replace colour. The Menu key or Shift+F10 on a
  swatch opens it, and the swatch has the focus again after it closes.
- **Edit.** Edit Colour…, or a double click on a swatch, opens the picker of §5.3 in a popover
  left of the grid, level with the swatch. It edits the swatch's colour only, with either
  button; the swatch shows the colour as it changes, and the palette takes it in one undo step
  when the popover closes — by Escape, a press outside, or the focus leaving it. A press outside
  applies the edit before it does anything else (a stroke it begins on the canvas comes after
  the edit), applying text typed in a field as leaving the field would; Escape drops such text.
  The edit is applied as well when its document stops being the active one (to that document)
  and when the panel leaves the page. It is applied through the command Apply Colour Edit. The
  foreground and background keep their colours: a swatch is not a reference to them.

### 5.5 Preview

The NGNE preview canvas, centred, scaled by a whole number of device pixels to fit. Under it:
animation select, play/pause, speed. The header reads "Preview · NGNE" to signal that this is the
engine drawing the export. A background chip cycles dark / light / mid grey. When the document is
too large to preview, the canvas area shows that message instead.

### 5.6 Timeline

- Left column (200 px): per layer — visibility, lock, name (double-click renames), opacity on
  hover. Reference layers sit in a separate bottom group labelled "Reference".
- Header row: frame numbers; the tag bar sits above it with coloured spans and tag names.
- Cells: 24 px wide in 28 px rows. Empty cel = small hollow dot; filled cel = solid dot; linked
  cels are joined by a line. Active cell has an accent outline; the active frame column and
  layer row are tinted with `--bg-raised`.
- Transport on the left of the tag bar: first, previous, play/pause, next, last, onion-skin
  toggle (its popover holds the settings). The frame duration field sits in the head of the
  layer column, beside the frame numbers, with New Layer (+) at its right: the six transport
  buttons leave it no room in 200 px (SE-022).
- Drag frames or layers to reorder; drag cels to move, Ctrl-drag to copy.

Behaviour (SE-022):

- While no document is open the panel is empty. Rows are the pixel layers, top of the stack
  first; the transport, the tag bar and the frame numbers stay in place while the grid scrolls
  under them, and the layer column stays at the left. The grid has thin scroll bars; the wheel
  (Shift+wheel across) and the keys scroll it too, and the active cell is kept in full view
  below and beside the parts that stay in place, whatever their size (a tag bar of several
  rows). The panel draws a change of the document once the canvas has had its next two
  animation frames, so it never delays the canvas (principle 3); what the next key acts on
  follows at once: the active cell (its tab stop, outline and focus) and the duration field.
- The visibility and lock toggles show their state by their icon (open or struck eye, open or
  closed lock), with no pressed background. They act on their row's layer without making it
  active.
- The opacity value (0–255) is shown in the row on hover and keyboard focus, and always when
  it is below 255; it opens the layer properties popover beside the row. Layer → Layer
  Properties… opens it for the active layer. The popover applies its name and opacity when it
  closes (Enter, Escape or a press outside), in one undo step; an empty name is not applied.
  Escape applies too, as in the swatch editor (§5.4, REVIEW E91): the popover has no Cancel,
  and nothing changes while it is open (no live opacity preview). A floating selection is
  applied first; while the layer's document cannot take the edit (a stroke), the popover stays
  open with its values.
- Rename in place: a double-click on the name, or the command Rename Layer, turns it into a
  field of at most 255 characters (SPEC §5.1). Enter or leaving the field applies the name (one
  undo step); Escape keeps the old one, as in any text field. A press anywhere outside the
  field applies it before the press does anything else. A floating selection is applied
  first; while the document cannot take the edit, the field stays.
- The duration field acts on the frames it showed when it took the focus (SPEC §7.4), until it
  loses it. A press anywhere outside it applies what was typed before the press does anything
  else: a click on another frame selects that frame afterwards, and a press on the canvas
  strokes after the duration is set. When those frames' durations differ the field shows "—",
  and a value typed or stepped there applies to all of them.
- A click on a cel, a frame number or a layer's name makes it active and selects it. Shift
  selects the range from the last item clicked without Shift (a rectangle of cels), Ctrl adds
  or removes one. A selection holds while the cel it was made at stays the active cel: the
  arrow keys, new frames and layers end it, and it does not come back when that cel is active
  again. Undo and redo end it too, even when they leave the active cel where it is. Selected
  cells, frame numbers and rows are tinted with `--bg-active`.
- The grid is one tab stop, its active cell; F6 enters the timeline there. Of the row headers
  only the active row's controls (visibility, lock, opacity) are in the tab order, just before
  the active cell; another row's are reached by moving the active cell there (↑ ↓) or by the
  pointer. So Tab from the active cell leaves the grid, and Shift+Tab passes those three and
  the column head (duration, New Layer), whatever the number of layers. While a cell has focus,
  ← → ↑ ↓ Home End move the active cell and the focus follows it, scrolled into view. A press
  on a frame number or a layer name gives the focus to the cell it makes active.
- Tab (viewport focused) and View → Hide Timeline hide the panel; the viewport takes its rows.
  The panel is shown again at every start.

### 5.7 Status bar

Left to right: cursor `x, y` · document size · zoom with a "Fit" button after it · frame
`n/total` · frame duration · selection size when one exists. Right: one-line hint for the active tool's modifiers, or
transient tool feedback in `--warn`.

## 6. Viewport

- Workspace is `--bg-workspace`; the document has a 1 px `--border-strong` outline outside its
  bounds and no drop shadow.
- Pixel grid appears at ≥ 8× as 1 px lines at 12% white/black; tile grid at 25%. White in the
  dark theme, black in the light theme; a line is the first device pixel of each texel or tile.
- Selection: 1 px marching ants, black and white dashes, 4 px period, 8 steps per second.
  They lie on the device pixels outside the selection that touch a selected texel, diagonally
  too: a 1 px ring just outside the selected texels on every side, around a hole as well, as
  the document outline lies outside the document; where the selection reaches the document's
  edge they lie over the outline. A dash is 2 device pixels by the sum x + y of the overlay
  pixel (black where (x + y − phase) mod 4 < 2), so every row and column of the ring repeats
  every 4 px, round corners too; a step moves the phase on by one. Below 1× a run that rounds
  to nothing keeps 1 px. A draw layer of order 500, over the grids and under the brush cursor;
  its timer exists only while the active document has a selection and motion is allowed
  (SE-030).
- Pending selection: while a selection tool's gesture is in progress, the pixels it would
  select show as the ants show a selection — the same ring and dashes, drawn by the same
  painter — standing still at phase 0, over the ants of the selection there is (draw layer
  order 600) (SE-031).
- Brush cursor: 1 px outline of the brush footprint snapped to pixels, two-tone so it shows on
  any content (black just outside the footprint, white outside that; an inverted outline cannot
  be drawn on the overlay, which does not hold NGNE's pixels); a paint tool that draws a brush
  outline hides the system cursor over the document.
- Zoom readout and "fit" live in the status bar, not as floating buttons over the canvas.
- Empty state (no document open): centred in the workspace — New sprite, Open, Import PNG and
  the recent files list, as plain text buttons; no illustration.

## 7. Dialogs and other surfaces

| Surface         | Kind     | Content                                                                         |
| --------------- | -------- | ------------------------------------------------------------------------------- |
| New sprite      | Dialog   | Width, height, presets (16, 32, 48, 64, 128), name                              |
| Sprite properties | Dialog | Name, pivot (3×3 presets and numeric X/Y), grid size and offset                 |
| Import PNG      | Large dialog | Left: source with crop/grid overlay. Right: result at target size, zoomable. Below: the steps of SPEC §8 as one compact form; a result line "8 frames · 32×32 · 16 colours" |
| Drop chooser    | Popover at the drop point | "Import as sprite", "Add as reference", "Both" (single image only) |
| Export          | Large dialog | Bundle options (SPEC §9.4), file toggles, frames (all / one tag), pivot (edits the same value as Sprite properties), atlas thumbnail with rectangles, resulting file list with sizes, final frame/animation IDs, destination folder, "Export on save" |
| Overwrite confirm | Dialog | Lists existing files in the chosen folder once per folder                       |
| Canvas / Sprite size | Dialog | Numeric fields, anchor grid, resample method                                |
| Tag             | Dialog   | Name, colour, range, direction, repeat                                          |
| Layer properties | Popover | Name, opacity, blend mode; for reference layers: X, Y, scale, placement         |
| Cel properties  | Popover  | Cel opacity; linked state with Unlink                                           |
| Onion skin      | Popover  | Frames before/after, opacity, falloff, tint, placement, within tag              |
| Replace colour  | Dialog   | From, to, tolerance, scope (selection, cel, frame, sprite)                      |
| Recovery        | Dialog on launch | Recoverable documents with name, time, thumbnail; Recover / Discard     |
| Preferences     | Dialog   | Theme, checkerboard, grid, onion skin defaults, import defaults, autosave. A change applies at once; actions are Restore defaults and Close |
| Shortcut sheet  | Dialog   | Generated from the command registry, grouped by menu; commands outside the menus under "Other" |
| WebGPU required | Full window | What is missing, supported browsers, how to enable acceleration              |

Only actions that undo cannot reverse confirm once: closing or replacing an unsaved document,
discarding a recovery snapshot, overwriting files in an export folder. Everything else,
including deleting layers and frames, relies on undo.

## 8. Accessibility

- Every command is reachable by keyboard via menu or palette; visible focus on all controls.
  F6 / Shift+F6 cycle regions; Tab toggles the timeline only while the canvas has focus.
- Radix primitives supply roles, focus trapping and typeahead for menus and dialogs.
- Icon-only controls carry `aria-label` and a tooltip.
- Text contrast per §3.1 in both themes.
- Pointer targets are at least 24×24 px. Exceptions, each also operable from the keyboard:
  palette swatches (16 px, arrow-key navigation), timeline cells (24×28), splitters (8 px,
  keyboard resize with arrow keys when focused).
- Layout is verified at 1280×720 and at 125% browser zoom on a 1920×1080 display.
- The canvas itself is a pointer surface and is not screen-reader operable; this is stated in
  the README rather than faked.
