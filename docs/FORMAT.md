# NGNE Sprite Editor — File formats

The formats the editor reads and writes, each specified precisely enough for another program to
do the same. [SPEC.md](SPEC.md) says what the editor does with them; where the two differ on the
content of a file, this document governs.

| Format              | File                 | Version | Section |
| ------------------- | -------------------- | ------- | ------- |
| NGNE sprite project | `<name>.ngsprite`    | 1       | [1](#1-sprite-project-ngsprite-version-1) |

Stability (SPEC §10): a format may still change until the 1.0.0 release of the editor. From that
release on, any change to a format needs a new version number and a migration from the version
before it.

## Conventions

These hold for every format in this document.

- **JSON** is UTF-8 text as in RFC 8259, without a byte order mark; a reader skips one. Member
  names are unique within an object. The order of members and white space carry no meaning.
- Every member a table lists is **required**, and an object has **no other member**: a reader
  refuses a file with a missing or an unknown member. Nothing has a default.
- **integer** means a JSON number with an integral value inside the stated range (`3`, `3.0`
  and `3e0` are the same integer). **number** means a JSON number that an IEEE 754 double
  holds as a finite value, inside the stated range when there is one. Ranges include both ends.
- **string** means any JSON string, the empty one included, unless stated otherwise.
- A **colour** is a string `#rrggbbaa`: `#` and eight hexadecimal digits for red, green, blue
  and alpha, 8 bits each, alpha not premultiplied. The editor writes lowercase digits and reads
  both cases.

## 1. Sprite project (`.ngsprite`), version 1

One file holds one document of SPEC §5.1 with everything needed to open it again: its
structure, the pixels of its cels, the original files of its reference images, and a small
picture of it. It holds no session state (selection, active layer and frame) and no undo
history.

- File extension: `.ngsprite`.
- Implementation: `src/core/project` (`serialize`, `deserialize`).
- A file of this version, kept as a test fixture: `tests/unit/se-040-fixtures/golden-v1.ngsprite`.

### 1.1 Container

The file is a zip archive (PKWARE APPNOTE) with these restrictions. A reader refuses an archive
that breaks one of them.

- One disk; no zip64 records. An archive therefore has at most 65 535 entries and is smaller
  than 4 GiB.
- The central directory ends exactly where the end-of-central-directory record starts, and that
  record with its comment ends the file.
- An entry that is read is not encrypted and uses compression method 0 (stored) or 8 (deflate).
- No two entries have the same name. Names are compared byte for byte, as UTF-8; `/` separates
  a folder from a name.
- The directory is authoritative: an entry's name, sizes, CRC-32 and method are taken from its
  central directory record, and its data starts after the local header that record points to.
  The local header must carry the same name. Its other fields, a data descriptor, extra fields,
  comments, time stamps and file attributes are not interpreted.
- The CRC-32 of every entry that is read must match its data, and the data must have exactly
  the uncompressed size the directory states.

Entries may appear in any order. A reader finds them by name and ignores every entry this
document does not name (for example folder entries, or files an archiving tool adds).

What the editor writes, beyond those rules:

- The entries of §1.2 in the order of that table; images in the order of `cels` (§1.4), reference
  sources in the order of `layers`.
- `manifest.json` and `doc.json` deflated; every `.png` entry stored, since PNG data is
  compressed already.
- Time stamp 1980-01-01 00:00:00 on every entry (DOS date `0x0021`, time `0x0000`); no extra
  fields, comments, flags or file attributes.
- The same document always gives the same bytes, at any time and in any time zone. This is a
  property of one version of the editor, not of the format: another writer need not reproduce
  the bytes, and a later version of the editor may compress differently.

### 1.2 Entries

| Entry                     | Content                                             | Section |
| ------------------------- | --------------------------------------------------- | ------- |
| `manifest.json`           | Format name and version                             | §1.3    |
| `doc.json`                | The document without its pixels                     | §1.4    |
| `images/<imageId>.png`    | The pixels of one image; one entry per image        | §1.5    |
| `refs/<sourceId>.png`     | The original file of one reference image            | §1.6    |
| `thumb.png`               | A picture of the first frame, at most 128 px a side | §1.7    |

`<imageId>` and `<sourceId>` are IDs (§1.4) taken from `doc.json`. All entries are required
except `thumb.png`, which a reader does not need (§1.7).

### 1.3 `manifest.json`

```json
{
    "format": "ngne-sprite-project",
    "version": 1,
    "generator": "ngne-sprite-editor 1.0.0"
}
```

| Member      | Type    | Value                                                                 |
| ----------- | ------- | --------------------------------------------------------------------- |
| `format`    | string  | `"ngne-sprite-project"`                                               |
| `version`   | integer | The schema version of the file, at least 1. This section specifies 1  |
| `generator` | string  | Name and version of the program that wrote the file. Informative only |

`format` and `version` keep this meaning in every version of the format, and a reader checks
them before anything else in the file:

1. `format` is not `"ngne-sprite-project"`: the file is not a sprite project.
2. `version` is above the newest version the reader knows: it refuses the file and says so,
   naming both versions. It does not look at the rest of the file, which may be laid out in a
   way it cannot know.
3. `version` is below that: the reader migrates `doc.json` (§1.10).

### 1.4 `doc.json`

The document model of SPEC §5.1. Two things differ from the model in memory: the pixels are
not here but in the image entries, and colours are strings.

**ID.** A string of 1 to 64 characters from `A`–`Z`, `a`–`z`, `0`–`9`, `_` and `-`,
case-sensitive. The editor writes UUIDs (`3f0c9d1e-6c1a-4b7e-9c55-0d2f1a7b8e21`). The ID of the
document and the IDs of all its layers, frames, tags and images are distinct from one another.
Source IDs are a namespace of their own. No two image IDs, and no two source IDs, differ only
in the case of their letters, so the entries they name can be unpacked to a file system that
ignores case.

**Document** (the top-level object)

| Member           | Type            | Constraint                              | Meaning |
| ---------------- | --------------- | --------------------------------------- | ------- |
| `id`             | ID              |                                         | Identity of the document |
| `name`           | string          | At least one character that is not white space¹ | Name of the sprite; base name of its exports |
| `width`          | integer         | 1..1024                                 | Canvas width in pixels |
| `height`         | integer         | 1..1024                                 | Canvas height in pixels |
| `colorMode`      | string          | `"rgba"`                                | The only colour mode of version 1 |
| `layers`         | array of Layer  | At most 1024; see below                 | The layer stack, bottom to top |
| `frames`         | array of Frame  | 1 to 65 535                             | The frames in playback order |
| `cels`           | array of Cel    |                                         | The cels that are not empty |
| `tags`           | array of Tag    | At most 1024                            | The tags in the order they were created |
| `palette`        | Palette         |                                         | The palette of the document |
| `pivot`          | object          | `x`, `y`: number 0..1                   | Pivot, normalized to the canvas: `0, 0` is its top-left corner, `1, 1` its bottom-right |
| `settings`       | Settings        |                                         | View preferences |
| `exportSettings` | ExportSettings  |                                         | Output preferences |

¹ White space as ECMAScript's `String.prototype.trim` removes it: the Unicode space separators
(category Zs), tab, line feed, vertical tab, form feed, carriage return, U+2028, U+2029 and
U+FEFF.

`layers` has at least one pixel layer and at most four reference layers.

**Layer.** `kind` decides which members a layer has.

| Member      | Type    | Constraint                 | Meaning |
| ----------- | ------- | -------------------------- | ------- |
| `id`        | ID      |                            |         |
| `kind`      | string  | `"pixel"` or `"reference"` |         |
| `name`      | string  |                            |         |
| `visible`   | boolean |                            |         |
| `locked`    | boolean |                            |         |
| `opacity`   | integer | 0..255                     | 255 is opaque |

A pixel layer has in addition:

| Member  | Type   | Constraint | Meaning |
| ------- | ------ | ---------- | ------- |
| `blend` | string | One of `"normal"`, `"multiply"`, `"screen"`, `"overlay"`, `"darken"`, `"lighten"`, `"color-dodge"`, `"color-burn"`, `"hard-light"`, `"soft-light"`, `"difference"`, `"exclusion"`, `"hue"`, `"saturation"`, `"color"`, `"luminosity"`, `"addition"`, `"subtract"`, `"divide"` | Blend mode of the layer over those below it |

A reference layer has in addition:

| Member      | Type   | Constraint              | Meaning |
| ----------- | ------ | ----------------------- | ------- |
| `sourceId`  | ID     | Names `refs/<sourceId>.png` | The image shown. Several layers may name one source |
| `x`, `y`    | number |                         | Top-left corner of the image in document pixels; fractions and positions outside the canvas are allowed |
| `scale`     | number | Above 0                 | Document pixels per pixel of the source image |
| `placement` | string | `"behind"` or `"front"` | Drawn behind or in front of all pixel layers |

A reference layer has no cels. Its place in `layers` among the pixel layers does not affect how
it is drawn.

**Frame**

| Member       | Type    | Constraint | Meaning |
| ------------ | ------- | ---------- | ------- |
| `id`         | ID      |            |         |
| `durationMs` | integer | 1..65535   | How long the frame is shown, in milliseconds |

**Cel.** The image of one pixel layer at one frame.

| Member    | Type    | Constraint                               | Meaning |
| --------- | ------- | ---------------------------------------- | ------- |
| `layerId` | ID      | The `id` of a pixel layer in `layers`    |         |
| `frameId` | ID      | The `id` of a frame in `frames`          |         |
| `imageId` | ID      | Names `images/<imageId>.png`             | The pixels of the cel |
| `opacity` | integer | 0..255                                   | Multiplied with the layer's opacity |

No two cels have the same `layerId` and `frameId`. A layer and frame without a cel is an empty
cel. Cels with the same `imageId` are **linked**: they share one image, stored once. The image
IDs of a document are exactly the `imageId` values of its cels. The editor writes the cels by
layer, bottom to top, then by frame; a reader accepts any order.

**Tag.** A named range of frames.

| Member        | Type    | Constraint                                 | Meaning |
| ------------- | ------- | ------------------------------------------ | ------- |
| `id`          | ID      |                                            |         |
| `name`        | string  |                                            |         |
| `color`       | colour  |                                            | Colour of the tag in the timeline |
| `fromFrameId` | ID      | The `id` of a frame                        | First frame of the range |
| `toFrameId`   | ID      | The `id` of a frame, not before the first  | Last frame of the range |
| `direction`   | string  | `"forward"`, `"reverse"` or `"pingpong"`   |         |
| `repeat`      | integer | 0..65535                                   | How often the range plays; 0 plays without end |

**Palette**

| Member   | Type            | Constraint  | Meaning |
| -------- | --------------- | ----------- | ------- |
| `name`   | string          |             |         |
| `colors` | array of colour | At most 256 | Entries may repeat |

**Settings.** View preferences of the document (SPEC §5.1 `DocSettings`).

| Member               | Type    | Constraint                        | Meaning |
| -------------------- | ------- | --------------------------------- | ------- |
| `grid.width`         | integer | 1..1024                           | Width of a grid cell in pixels |
| `grid.height`        | integer | 1..1024                           | Height of a grid cell in pixels |
| `grid.offsetX`       | integer | −1024..1024                       | Offset of the grid from the canvas origin |
| `grid.offsetY`       | integer | −1024..1024                       |         |
| `grid.visible`       | boolean |                                   |         |
| `pixelGrid`          | boolean |                                   | Whether the pixel grid shows at high zoom |
| `onion.enabled`      | boolean |                                   | Onion skin |
| `onion.before`       | integer | 0..3                              | Frames shown before the current one |
| `onion.after`        | integer | 0..3                              | Frames shown after it |
| `onion.opacity`      | integer | 0..255                            | Opacity of the nearest onion frame |
| `onion.falloff`      | number  | 0..1                              | Factor on the opacity for each further frame |
| `onion.tint`         | boolean |                                   |         |
| `onion.placement`    | string  | `"behind"` or `"front"`           |         |
| `onion.withinTag`    | boolean |                                   | Limit the onion frames to the active tag |
| `symmetry.mode`      | string  | `"none"`, `"x"`, `"y"` or `"both"` |        |
| `symmetry.axisX`     | integer | 0..2048                           | Position of the vertical axis in half pixels from the left edge |
| `symmetry.axisY`     | integer | 0..2048                           | Position of the horizontal axis in half pixels from the top edge |
| `tiled`              | string  | `"none"`, `"x"`, `"y"` or `"both"` | Tiled mode |

`grid`, `onion` and `symmetry` are objects; the table writes their members with a dot.

**ExportSettings.** Output preferences of the document (SPEC §5.1, §9).

| Member               | Type              | Constraint                         | Meaning |
| -------------------- | ----------------- | ---------------------------------- | ------- |
| `layout`             | string            | `"grid"`, `"row"` or `"column"`    | Atlas layout |
| `padding`            | integer           | 0..8                               | Pixels between atlas rectangles |
| `extrude`            | integer           | 0..2                               | Pixels of edge replication |
| `trim`               | boolean           |                                    | Trim transparent borders |
| `mergeDuplicates`    | boolean           |                                    | Identical frames share a rectangle |
| `frames`             | string or object  | `"all"`, or `{ "tagId": ID }` with the `id` of a tag | Which frames are exported |
| `files.spritesTs`    | boolean           |                                    | Write `<name>.sprites.ts` |
| `files.previewConfig` | boolean          |                                    | Write `<name>.preview.config.mjs` |
| `files.asepriteJson` | string            | `"none"`, `"array"` or `"hash"`    | Write `<name>.aseprite.json` |
| `exportOnSave`       | boolean           |                                    | Export again on every save |

`files` is an object; the table writes its members with a dot.

### 1.5 Images

For every `imageId` among the cels there is one entry `images/<imageId>.png`. It is a PNG file
with:

- colour type 6 (RGB with alpha), bit depth 8, no interlacing;
- the width and height of the document.

Its samples are the pixels of the image: red, green, blue, alpha, alpha not premultiplied, as
stored, without colour conversion. A reader ignores gamma, colour profile and every other
ancillary chunk. The colour of a pixel with alpha 0 is part of the image and is preserved.

The editor writes no chunk besides IHDR, IDAT and IEND.

### 1.6 Reference sources

For every `sourceId` among the reference layers there is one entry `refs/<sourceId>.png`: the
file of the reference image exactly as the user gave it, byte for byte. It starts with the PNG
signature. Nothing else of it is checked when a project is read, and it is never rewritten: a
reader hands the bytes on, and whoever displays the image decodes them.

### 1.7 Thumbnail

`thumb.png` is a picture of the document for programs that list project files: the composite of
the first frame (SPEC §5.3: its visible pixel layers; no reference layer), as an 8-bit RGBA PNG.

- When neither side of the canvas exceeds 128 px, it has the size of the canvas. A small sprite
  is not enlarged.
- Otherwise it is scaled down by nearest neighbour so that the longer side is 128 px and the
  other is `max(1, round(side × 128 / longer side))`. Pixel `(x, y)` of a thumbnail of
  `w × h` shows canvas pixel
  `(floor((x + 0.5) × width / w), floor((y + 0.5) × height / h))`.

A writer includes it. A reader of the project does not need it, does not check it, and reads a
file without it.

### 1.8 Limits

A writer does not exceed them; a reader checks each one before it inflates, decodes or
allocates what the limit is about, and refuses the file.

| What                                              | Limit |
| ------------------------------------------------- | ----- |
| `manifest.json`, uncompressed                     | 64 KiB (65 536 bytes) |
| `doc.json`, uncompressed                          | 16 MiB (16 777 216 bytes) |
| One `images/<imageId>.png`, uncompressed          | `height × (4 × width + 1) + 65 536` bytes: the scanlines of the image without compression, plus 64 KiB |
| One `refs/<sourceId>.png`, uncompressed           | 64 MiB (67 108 864 bytes) |
| Pixel data: images × `width` × `height` × 4       | 1 GiB (1 073 741 824 bytes) |
| All entries of the project together, uncompressed | 2 GiB (2 147 483 648 bytes) |
| Entries in the archive                            | 65 535 |
| Layers                                            | 1024, of which at most 4 reference layers |
| Frames                                            | 65 535 |
| Tags                                              | 1024 |
| Palette colours                                   | 256 |
| Length of an ID                                   | 64 characters |

"Uncompressed" is the size of an entry's content, whatever its compression method.

### 1.9 Reading

A file is untrusted. A reader checks everything before it uses it, in this order, and stops at
the first problem; it returns a whole document or none.

1. The container (§1.1).
2. `manifest.json`: present, within its limit, intact, valid JSON; then the three steps of §1.3.
3. `doc.json`: present, within its limit, intact, valid JSON; migrated when it is of an older
   version; then every member against §1.4: none missing, none unknown, each of its type and
   inside its range, every ID well-formed, every cel on a pixel layer and a frame that exist,
   no two cels on the same pair.
4. The pixel data limit of §1.8, from the number of images and the size of the canvas.
5. Every image: its entry present and within its limit; its PNG header (colour type, bit depth,
   interlacing, width, height) against §1.5, before the image is decoded; then the image data.
6. The invariants of the document that span several members (SPEC §5.1): at least one pixel
   layer and one frame, at most four reference layers, distinct IDs, tag endpoints that exist
   and are in order, an `exportSettings.frames` tag that exists.
7. Every reference source: its entry present, within its limit, intact, a PNG signature.

The editor's reader reports each problem as a `ProjectError` with a code for its kind and the
name of the entry at fault (`src/core/project/errors.ts`).

The editor's writer makes the checks of steps 3 to 7 on the document it is asked to save and
refuses one that fails, so a file it writes can be read. It leaves out what no layer, frame or
cel of the document reaches: a cel under a key that names no pixel layer and frame, an image no
cel uses, a reference source no layer names.

### 1.10 Versions and migrations

A change to this format after it is frozen gets the next version number. A reader of version N
reads every version from 1 to N: for an older file it rewrites the parsed `doc.json` step by
step, with one migration from each version to the next, and then checks the result as
version N. Version 1 is the first version and has no migration.
(`src/core/project/migrations.ts`.)

A file is always written in the newest version.

### 1.11 Example

A document of 4 × 3 pixels with a reference layer and two pixel layers, two frames, a linked
cel and one tag. Its archive holds `manifest.json` (§1.3), this `doc.json`,
`images/image-bg.png`, `images/image-body.png`, `refs/source-sketch.png` and `thumb.png`.

```json
{
    "id": "doc-hero",
    "name": "Hero",
    "width": 4,
    "height": 3,
    "colorMode": "rgba",
    "layers": [
        {
            "id": "layer-ref",
            "kind": "reference",
            "name": "Sketch",
            "visible": true,
            "locked": true,
            "opacity": 128,
            "sourceId": "source-sketch",
            "x": -1.5,
            "y": 0.25,
            "scale": 0.125,
            "placement": "behind"
        },
        {
            "id": "layer-bg",
            "kind": "pixel",
            "name": "Background",
            "visible": true,
            "locked": false,
            "opacity": 255,
            "blend": "normal"
        },
        {
            "id": "layer-body",
            "kind": "pixel",
            "name": "Body",
            "visible": true,
            "locked": false,
            "opacity": 200,
            "blend": "multiply"
        }
    ],
    "frames": [
        { "id": "frame-1", "durationMs": 100 },
        { "id": "frame-2", "durationMs": 80 }
    ],
    "cels": [
        { "layerId": "layer-bg", "frameId": "frame-1", "imageId": "image-bg", "opacity": 255 },
        { "layerId": "layer-bg", "frameId": "frame-2", "imageId": "image-bg", "opacity": 255 },
        { "layerId": "layer-body", "frameId": "frame-1", "imageId": "image-body", "opacity": 255 }
    ],
    "tags": [
        {
            "id": "tag-idle",
            "name": "idle",
            "color": "#3cb371ff",
            "fromFrameId": "frame-1",
            "toFrameId": "frame-2",
            "direction": "pingpong",
            "repeat": 0
        }
    ],
    "palette": { "name": "Hero", "colors": ["#00000000", "#ffffffff", "#ff8000ff"] },
    "pivot": { "x": 0.5, "y": 1 },
    "settings": {
        "grid": { "width": 16, "height": 16, "offsetX": 0, "offsetY": 0, "visible": false },
        "pixelGrid": true,
        "onion": {
            "enabled": false,
            "before": 1,
            "after": 1,
            "opacity": 128,
            "falloff": 0.5,
            "tint": false,
            "placement": "behind",
            "withinTag": false
        },
        "symmetry": { "mode": "none", "axisX": 4, "axisY": 3 },
        "tiled": "none"
    },
    "exportSettings": {
        "layout": "grid",
        "padding": 1,
        "extrude": 0,
        "trim": false,
        "mergeDuplicates": true,
        "frames": { "tagId": "tag-idle" },
        "files": { "spritesTs": true, "previewConfig": true, "asepriteJson": "none" },
        "exportOnSave": false
    }
}
```

The background has one image at both frames (linked cels); the body has a cel at the first
frame only.
