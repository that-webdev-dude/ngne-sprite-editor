"""PNG fixtures for the SE-005 decoder tests.

Usage, from the repository root:

    python tests/unit/se-005-fixtures/make_fixtures.py

Needs Python 3 and Pillow. The committed files were written with Python 3.13.14 and
Pillow 12.3.0. Nothing here imports or runs the code under test (src/core/png, fast-png).

How each file is produced (field "writer" in manifest.json)
- "pillow": Pillow encodes the source samples. Used for every colour type and bit depth
  Pillow can write.
- "manual": the writer in this file (struct + zlib). Pillow cannot write Adam7 interlacing,
  16-bit colour or 2/4-bit greyscale, and does not let the caller choose filters, chunk
  splits or extra chunks. These files rotate through the five filter types row by row.

How the expected pixels are established (field "rgba" in manifest.json, hex, row-major)
- `expected_rgba` converts the source samples to straight RGBA8 by the rules of the PNG
  specification: greyscale replicated to R, G and B; palette entries looked up, with alpha
  from tRNS; a tRNS colour key compared at the file's own bit depth; a sample of depth d
  mapped to the nearest value of v * 255 / (2^d - 1). No file is decoded to obtain them.
- Every file is then read back with Pillow's decoder and compared with the source samples
  (`verify_with_pillow`), so a wrongly written fixture stops the script. Pillow reduces
  16-bit colour to the high byte, so for those files the read-back is compared with the
  high bytes of the source samples; it checks sample order, filters and interlacing.

Output bytes can differ between zlib versions; the decoded pixels cannot.
"""

from __future__ import annotations

import json
import platform
import struct
import zlib
from dataclasses import dataclass, field
from pathlib import Path

import PIL
from PIL import Image

HERE = Path(__file__).resolve().parent
SIGNATURE = b"\x89PNG\r\n\x1a\n"

GREY, RGB, INDEXED, GREY_ALPHA, RGBA = 0, 2, 3, 4, 6
CHANNELS = {GREY: 1, RGB: 3, INDEXED: 1, GREY_ALPHA: 2, RGBA: 4}
# Adam7 passes: first column, first row, column step, row step.
ADAM7 = [
    (0, 0, 8, 8),
    (4, 0, 8, 8),
    (0, 4, 4, 8),
    (2, 0, 4, 4),
    (0, 2, 2, 4),
    (1, 0, 2, 2),
    (0, 1, 1, 2),
]

Pixel = tuple[int, ...]


@dataclass
class Fixture:
    name: str
    writer: str  # "pillow" or "manual"
    color_type: int
    bit_depth: int
    width: int
    height: int
    pixels: list[Pixel]  # row-major samples at the file's bit depth; (index,) when indexed
    interlace: bool = False
    palette: list[tuple[int, int, int]] | None = None
    palette_alpha: list[int] | None = None  # tRNS of an indexed image
    key: Pixel | None = None  # tRNS of a greyscale (1 sample) or RGB (3 samples) image
    idat_parts: int = 1  # manual writer: number of IDAT chunks
    before_idat: list[tuple[bytes, bytes]] = field(default_factory=list)
    after_idat: list[tuple[bytes, bytes]] = field(default_factory=list)


class Lcg:
    """Deterministic sample source that depends on no library state."""

    def __init__(self, seed: int) -> None:
        self.state = seed & 0xFFFFFFFF

    def below(self, bound: int) -> int:
        self.state = (self.state * 1664525 + 1013904223) & 0xFFFFFFFF
        return (self.state >> 8) % bound


def noise(seed: int, width: int, height: int, channels: int, top: int) -> list[Pixel]:
    rng = Lcg(seed)
    return [tuple(rng.below(top + 1) for _ in range(channels)) for _ in range(width * height)]


def with_pixels(pixels: list[Pixel], first: list[Pixel]) -> list[Pixel]:
    """Replaces the leading pixels with chosen values (extremes, keys, rounding probes)."""
    return first + pixels[len(first) :]


# --- expected pixels -----------------------------------------------------------------------


def to8(value: int, depth: int) -> int:
    """Nearest 8-bit value of value * 255 / (2^depth - 1). Exact for depths 1, 2, 4 and 8."""
    top = (1 << depth) - 1
    return (value * 255 * 2 + top) // (2 * top)


def expected_rgba(fx: Fixture) -> bytes:
    depth = fx.bit_depth
    out = bytearray()
    for px in fx.pixels:
        if fx.color_type == GREY:
            v = to8(px[0], depth)
            out += bytes((v, v, v, 0 if px == fx.key else 255))
        elif fx.color_type == RGB:
            out += bytes((*(to8(s, depth) for s in px), 0 if px == fx.key else 255))
        elif fx.color_type == INDEXED:
            assert fx.palette is not None
            alpha = fx.palette_alpha or []
            index = px[0]
            out += bytes((*fx.palette[index], alpha[index] if index < len(alpha) else 255))
        elif fx.color_type == GREY_ALPHA:
            v = to8(px[0], depth)
            out += bytes((v, v, v, to8(px[1], depth)))
        else:
            out += bytes(to8(s, depth) for s in px)
    return bytes(out)


# --- manual writer -------------------------------------------------------------------------


def chunk(kind: bytes, data: bytes = b"") -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def pack_row(samples: list[int], depth: int) -> bytes:
    if depth == 8:
        return bytes(samples)
    if depth == 16:
        return b"".join(struct.pack(">H", s) for s in samples)
    out = bytearray((len(samples) * depth + 7) // 8)
    for i, sample in enumerate(samples):
        bit = i * depth
        out[bit // 8] |= sample << (8 - depth - bit % 8)
    return bytes(out)


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def apply_filter(kind: int, row: bytes, prev: bytes, bpp: int) -> bytes:
    out = bytearray(len(row))
    for i, value in enumerate(row):
        a = row[i - bpp] if i >= bpp else 0
        b = prev[i]
        c = prev[i - bpp] if i >= bpp else 0
        predicted = (0, a, b, (a + b) >> 1, paeth(a, b, c))[kind]
        out[i] = (value - predicted) & 0xFF
    return bytes(out)


def scanlines(fx: Fixture) -> bytes:
    """Filtered scanlines, pass by pass when interlaced; row n uses filter type n % 5."""
    bpp = max(1, CHANNELS[fx.color_type] * fx.bit_depth // 8)
    passes = ADAM7 if fx.interlace else [(0, 0, 1, 1)]
    out = bytearray()
    row_number = 0
    for x0, y0, dx, dy in passes:
        xs = range(x0, fx.width, dx)
        ys = range(y0, fx.height, dy)
        if len(xs) == 0 or len(ys) == 0:
            continue
        prev = b""
        for y in ys:
            samples = [s for x in xs for s in fx.pixels[y * fx.width + x]]
            row = pack_row(samples, fx.bit_depth)
            if not prev:
                prev = bytes(len(row))
            kind = row_number % 5
            row_number += 1
            out.append(kind)
            out += apply_filter(kind, row, prev, bpp)
            prev = row
    return bytes(out)


def write_manual(fx: Fixture, path: Path) -> None:
    header = struct.pack(
        ">IIBBBBB", fx.width, fx.height, fx.bit_depth, fx.color_type, 0, 0, int(fx.interlace)
    )
    parts = [SIGNATURE, chunk(b"IHDR", header)]
    parts += [chunk(kind, data) for kind, data in fx.before_idat]
    if fx.palette is not None:
        parts.append(chunk(b"PLTE", bytes(c for rgb in fx.palette for c in rgb)))
        if fx.palette_alpha:
            parts.append(chunk(b"tRNS", bytes(fx.palette_alpha)))
    if fx.key is not None:
        parts.append(chunk(b"tRNS", b"".join(struct.pack(">H", s) for s in fx.key)))
    stream = zlib.compress(scanlines(fx), 9)
    step = -(-len(stream) // fx.idat_parts)
    parts += [chunk(b"IDAT", stream[i : i + step]) for i in range(0, len(stream), step)]
    parts += [chunk(kind, data) for kind, data in fx.after_idat]
    parts.append(chunk(b"IEND"))
    path.write_bytes(b"".join(parts))


# --- Pillow writer and read-back ------------------------------------------------------------


def write_pillow(fx: Fixture, path: Path) -> None:
    size = (fx.width, fx.height)
    flat = [s for px in fx.pixels for s in px]
    kind = (fx.color_type, fx.bit_depth)
    options: dict[str, object] = {}
    if kind == (GREY, 1):
        grey = Image.frombytes("L", size, bytes(255 * s for s in flat))
        im = grey.convert("1", dither=Image.Dither.NONE)
    elif kind == (GREY, 8):
        im = Image.frombytes("L", size, bytes(flat))
    elif kind == (GREY, 16):
        im = Image.frombytes("I;16", size, b"".join(struct.pack("<H", s) for s in flat))
    elif kind == (GREY_ALPHA, 8):
        im = Image.frombytes("LA", size, bytes(flat))
    elif kind == (RGB, 8):
        im = Image.frombytes("RGB", size, bytes(flat))
    elif kind == (RGBA, 8):
        im = Image.frombytes("RGBA", size, bytes(flat))
    elif fx.color_type == INDEXED:
        # Pillow picks the bit depth from the palette length; checked against the header below.
        assert fx.palette is not None
        im = Image.frombytes("P", size, bytes(flat))
        im.putpalette([c for rgb in fx.palette for c in rgb])
        if fx.palette_alpha:
            options["transparency"] = bytes(fx.palette_alpha)
    else:
        raise ValueError(f"{fx.name}: Pillow cannot write this type")
    if fx.key is not None:
        options["transparency"] = fx.key[0] if fx.color_type == GREY else fx.key
    im.save(path, format="PNG", **options)


def check(condition: bool, fx: Fixture, what: str) -> None:
    if not condition:
        raise SystemExit(f"{fx.name}: {what}")


def verify_header(path: Path, fx: Fixture) -> None:
    data = path.read_bytes()
    check(data[:8] == SIGNATURE and data[12:16] == b"IHDR", fx, "not a PNG")
    header = struct.unpack(">IIBBBBB", data[16:29])
    wanted = (fx.width, fx.height, fx.bit_depth, fx.color_type, 0, 0, int(fx.interlace))
    check(header == wanted, fx, f"header {header}, wanted {wanted}")


def verify_with_pillow(path: Path, fx: Fixture, expected: bytes) -> None:
    with Image.open(path) as im:
        im.load()
        raw = im.tobytes()
        if fx.key is not None:
            key = fx.key[0] if fx.color_type == GREY else fx.key
            check(im.info.get("transparency") == key, fx, "Pillow reads another tRNS key")
        if fx.bit_depth == 16 and fx.color_type == GREY:
            got = list(struct.unpack(f"<{len(raw) // 2}H", raw))
            check(im.mode == "I;16", fx, f"Pillow mode {im.mode}")
            check(got == [px[0] for px in fx.pixels], fx, "Pillow reads other 16-bit samples")
        elif fx.bit_depth == 16 and fx.color_type == GREY_ALPHA:
            # Pillow expands 16-bit greyscale with alpha to RGBA.
            high = bytes(c >> 8 for g, a in fx.pixels for c in (g, g, g, a))
            check(raw == high, fx, "Pillow reads other high bytes")
        elif fx.bit_depth == 16:
            high = bytes(s >> 8 for px in fx.pixels for s in px)
            check(raw == high, fx, "Pillow reads other high bytes")
        elif fx.key is not None and fx.bit_depth < 8:
            # Pillow scales the samples but not the key, so its own RGBA conversion is skipped.
            grey = bytes(to8(px[0], fx.bit_depth) for px in fx.pixels)
            check(im.convert("L").tobytes() == grey, fx, "Pillow reads other grey samples")
        else:
            check(im.convert("RGBA").tobytes() == expected, fx, "Pillow reads other pixels")


# --- fixture definitions -------------------------------------------------------------------


def palette(seed: int, count: int) -> list[tuple[int, int, int]]:
    rng = Lcg(seed)
    return [(rng.below(256), rng.below(256), rng.below(256)) for _ in range(count)]


def alphas(seed: int, count: int) -> list[int]:
    """tRNS entries: fully transparent, fully opaque, then varied partial values."""
    rng = Lcg(seed)
    return ([0, 255, 1, 254, 128] + [rng.below(256) for _ in range(count)])[:count]


def fixtures() -> list[Fixture]:
    # 16-bit samples chosen so that rounding to nearest and keeping the high byte differ.
    probes16 = [0x0000, 0x0080, 0x0081, 0x00FF, 0x0100, 0x0181, 0x0182, 0x01FF]
    probes16 += [0x7F80, 0x7FFF, 0x8000, 0x80FF, 0xFEFF, 0xFF7E, 0xFF7F, 0xFFFF]
    text = b"Comment\x00SE-005 fixture"
    return [
        # Greyscale
        Fixture("gray8.png", "pillow", GREY, 8, 16, 16, noise(1, 16, 16, 1, 255)),
        Fixture("gray1.png", "pillow", GREY, 1, 17, 9, noise(2, 17, 9, 1, 1)),
        Fixture("gray2.png", "manual", GREY, 2, 13, 7, noise(3, 13, 7, 1, 3)),
        Fixture("gray4.png", "manual", GREY, 4, 13, 7, noise(4, 13, 7, 1, 15)),
        Fixture(
            "gray8-trns.png",
            "pillow",
            GREY,
            8,
            16,
            16,
            with_pixels(noise(5, 16, 16, 1, 255), [(77,), (76,), (78,), (77,), (0,), (255,)]),
            key=(77,),
        ),
        Fixture(
            "gray4-trns.png",
            "manual",
            GREY,
            4,
            13,
            7,
            with_pixels(noise(6, 13, 7, 1, 15), [(9,), (8,), (10,), (9,)]),
            key=(9,),
        ),
        # Greyscale with alpha
        Fixture(
            "gray-alpha8.png",
            "pillow",
            GREY_ALPHA,
            8,
            16,
            16,
            with_pixels(noise(7, 16, 16, 2, 255), [(200, 0), (0, 255), (255, 1), (13, 254)]),
        ),
        # RGB
        Fixture("rgb8.png", "pillow", RGB, 8, 16, 16, noise(8, 16, 16, 3, 255)),
        Fixture(
            "rgb8-trns.png",
            "pillow",
            RGB,
            8,
            16,
            16,
            with_pixels(
                noise(9, 16, 16, 3, 255),
                [(10, 200, 30), (11, 200, 30), (10, 201, 30), (10, 200, 31), (10, 200, 30)],
            ),
            key=(10, 200, 30),
        ),
        # RGBA
        Fixture(
            "rgba8.png",
            "pillow",
            RGBA,
            8,
            16,
            16,
            with_pixels(
                noise(10, 16, 16, 4, 255),
                [(255, 128, 1, 0), (0, 0, 0, 0), (9, 8, 7, 1), (255, 255, 255, 254)],
            ),
        ),
        Fixture(
            "rgba8-filters.png",
            "manual",
            RGBA,
            8,
            16,
            16,
            noise(11, 16, 16, 4, 255),
            idat_parts=3,
        ),
        Fixture(
            "rgba8-ancillary.png",
            "manual",
            RGBA,
            8,
            8,
            8,
            noise(12, 8, 8, 4, 255),
            before_idat=[
                (b"gAMA", struct.pack(">I", 100000)),
                (b"pHYs", struct.pack(">IIB", 2835, 2835, 1)),
                (b"prVt", b"private ancillary chunk"),
            ],
            after_idat=[(b"tEXt", text)],
        ),
        # Indexed
        Fixture(
            "indexed8-trns.png",
            "pillow",
            INDEXED,
            8,
            16,
            16,
            noise(13, 16, 16, 1, 39),
            palette=palette(113, 40),
            palette_alpha=alphas(213, 24),
        ),
        Fixture(
            "indexed4-trns.png",
            "pillow",
            INDEXED,
            4,
            13,
            7,
            noise(14, 13, 7, 1, 15),
            palette=palette(114, 16),
            palette_alpha=alphas(214, 9),
        ),
        Fixture(
            "indexed2-trns.png",
            "pillow",
            INDEXED,
            2,
            13,
            7,
            noise(15, 13, 7, 1, 3),
            palette=palette(115, 4),
            palette_alpha=alphas(215, 3),
        ),
        Fixture(
            "indexed1-trns.png",
            "pillow",
            INDEXED,
            1,
            19,
            5,
            noise(16, 19, 5, 1, 1),
            palette=palette(116, 2),
            palette_alpha=[0],
        ),
        Fixture(
            "indexed4.png",
            "pillow",
            INDEXED,
            4,
            13,
            7,
            noise(17, 13, 7, 1, 11),
            palette=palette(117, 12),
        ),
        # 16-bit
        Fixture(
            "gray16.png",
            "pillow",
            GREY,
            16,
            16,
            8,
            with_pixels(noise(18, 16, 8, 1, 65535), [(v,) for v in probes16]),
        ),
        Fixture(
            "gray16-trns.png",
            "pillow",
            GREY,
            16,
            8,
            8,
            with_pixels(
                noise(19, 8, 8, 1, 65535), [(0x1234,), (0x1235,), (0x1334,), (0x1234,), (0x12FF,)]
            ),
            key=(0x1234,),
        ),
        Fixture(
            "gray-alpha16.png",
            "manual",
            GREY_ALPHA,
            16,
            8,
            8,
            with_pixels(noise(20, 8, 8, 2, 65535), [(v, 0xFFFF - v) for v in probes16]),
        ),
        Fixture(
            "rgb16.png",
            "manual",
            RGB,
            16,
            8,
            8,
            with_pixels(noise(21, 8, 8, 3, 65535), [(v, v ^ 0x00FF, 0xFFFF - v) for v in probes16]),
        ),
        Fixture(
            "rgb16-trns.png",
            "manual",
            RGB,
            16,
            8,
            8,
            with_pixels(
                noise(22, 8, 8, 3, 65535),
                [
                    (0x0102, 0x8000, 0xFFFE),
                    (0x0103, 0x8000, 0xFFFE),
                    (0x0102, 0x8001, 0xFFFE),
                    (0x0102, 0x8000, 0xFFFF),
                    (0x0102, 0x8000, 0xFFFE),
                ],
            ),
            key=(0x0102, 0x8000, 0xFFFE),
        ),
        Fixture(
            "rgba16.png",
            "manual",
            RGBA,
            16,
            8,
            8,
            with_pixels(
                noise(23, 8, 8, 4, 65535), [(v, 0xFFFF - v, v ^ 0x00FF, v) for v in probes16]
            ),
        ),
        # Interlaced
        Fixture(
            "rgba8-interlaced.png",
            "manual",
            RGBA,
            8,
            13,
            11,
            noise(24, 13, 11, 4, 255),
            interlace=True,
        ),
        Fixture(
            "rgb8-interlaced.png",
            "manual",
            RGB,
            8,
            16,
            16,
            noise(25, 16, 16, 3, 255),
            interlace=True,
            idat_parts=2,
        ),
        Fixture(
            "gray1-interlaced.png",
            "manual",
            GREY,
            1,
            19,
            10,
            noise(26, 19, 10, 1, 1),
            interlace=True,
        ),
        Fixture(
            "gray-alpha8-interlaced.png",
            "manual",
            GREY_ALPHA,
            8,
            9,
            9,
            noise(27, 9, 9, 2, 255),
            interlace=True,
        ),
        Fixture(
            "indexed4-trns-interlaced.png",
            "manual",
            INDEXED,
            4,
            13,
            11,
            noise(28, 13, 11, 1, 15),
            interlace=True,
            palette=palette(128, 16),
            palette_alpha=alphas(228, 10),
        ),
        Fixture(
            "indexed2-trns-interlaced.png",
            "manual",
            INDEXED,
            2,
            10,
            9,
            noise(29, 10, 9, 1, 3),
            interlace=True,
            palette=palette(129, 4),
            palette_alpha=alphas(229, 4),
        ),
        Fixture(
            "rgba16-interlaced.png",
            "manual",
            RGBA,
            16,
            11,
            13,
            noise(30, 11, 13, 4, 65535),
            interlace=True,
        ),
        # Interlaced images so small that some of the seven passes are empty.
        Fixture(
            "rgba8-interlaced-1x1.png",
            "manual",
            RGBA,
            8,
            1,
            1,
            [(12, 34, 56, 78)],
            interlace=True,
        ),
        Fixture(
            "rgb8-interlaced-3x2.png",
            "manual",
            RGB,
            8,
            3,
            2,
            noise(31, 3, 2, 3, 255),
            interlace=True,
        ),
        Fixture(
            "gray8-interlaced-2x5.png",
            "manual",
            GREY,
            8,
            2,
            5,
            noise(32, 2, 5, 1, 255),
            interlace=True,
        ),
    ]


def main() -> None:
    entries = []
    for fx in fixtures():
        check(len(fx.pixels) == fx.width * fx.height, fx, "wrong pixel count")
        path = HERE / fx.name
        (write_pillow if fx.writer == "pillow" else write_manual)(fx, path)
        expected = expected_rgba(fx)
        verify_header(path, fx)
        verify_with_pillow(path, fx, expected)
        entries.append(
            {
                "file": fx.name,
                "writer": fx.writer,
                "width": fx.width,
                "height": fx.height,
                "colorType": fx.color_type,
                "bitDepth": fx.bit_depth,
                "interlaced": fx.interlace,
                "transparency": fx.key is not None or bool(fx.palette_alpha),
                "rgba": expected.hex(),
            }
        )
    manifest = {
        "generator": "tests/unit/se-005-fixtures/make_fixtures.py",
        "python": platform.python_version(),
        "pillow": PIL.__version__,
        "fixtures": entries,
    }
    # Four-space JSON with LF line endings is what the repository's Prettier check expects.
    text = json.dumps(manifest, indent=4) + "\n"
    (HERE / "manifest.json").write_text(text, encoding="utf-8", newline="\n")
    print(f"{len(entries)} fixtures written to {HERE}")


if __name__ == "__main__":
    main()
