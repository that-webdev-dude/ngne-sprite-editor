# Third-party notices

Parts of this repository are ported from third-party source code. Each part and its licence
is listed below. Runtime dependencies installed through npm carry their own licences in
`node_modules`; the build writes this file, the program's licence and the licence of every
npm package it bundles to `licences.txt`, which the app shows in a dialog (View → Open Source
Licences…).

NGNE Sprite Editor is not affiliated with or endorsed by Aseprite or Igara Studio S.A.
"Aseprite" is used only to name the program whose file formats and behaviour this editor
follows. Aseprite's application code (`src/app` and the other parts its EULA covers) is not
copied here: where this editor follows its behaviour, the behaviour was reimplemented from
using Aseprite and its documentation. A few details were confirmed by reading that source;
the source repository's `docs/PROVENANCE.md`, which is not part of the app, lists them.

Other product names used here, such as GIMP, Paint Shop Pro, PICO-8 and Game Boy, are
trademarks of their respective owners and name only file formats or palettes.

## Aseprite Document Library (MIT)

Source: `src/doc/blend_funcs.cpp`, `src/doc/algo.cpp`, `src/doc/algorithm/floodfill.cpp` and
`src/doc/color.h` of
<https://github.com/aseprite/aseprite>. Aseprite's application code is distributed under its
End-User License Agreement; these files belong to its document library, which is released
under the MIT licence (`src/doc/LICENSE.txt`).

Version: Aseprite v1.3.18.6 (commit `331e898ef405d919539c03fd1675691cfa16c3a3`).

Ported or transcribed in:

- `src/core/composite/blend.ts`: the blend-mode formulas of `blend_funcs.cpp`.
- `tests/unit/fixtures/se-061-blend-golden.generate.mjs`: `blend_funcs.cpp`, transcribed line
  by line to generate the expected composites, with the packing of `color_t` in `color.h`.
- `tests/e2e/se-061-support.ts`: the multiply, exclusion, difference and normal blends of
  `blend_funcs.cpp` for opaque images, as the expected images of the E2E tests.
- `tests/unit/se-061-blend.test.ts`: the normal blend of `rgba_blender_normal` in
  `blend_funcs.cpp`, in the copy of the compositor before SE-061 that the tests compare with.
- `tests/unit/se-065-raster.test.ts`: `algo_spline` of `algo.cpp`, ported as a test reference.
  Aseprite adapted that function from Allegro's `calc_spline`; see Allegro below.
- `src/core/raster/curve.ts`: the sample count of `algo_spline` in `algo.cpp` (the factor 1.2,
  the limits 4 and 64), the curve tool.
- `src/core/raster/flood.ts`: the colour-match rule of `color_equal_32` in `floodfill.cpp`
  (transparent matches transparent; an exact match at tolerance 0; otherwise each channel
  within the tolerance), the paint bucket and the magic wand.

```text
Copyright (c) 2018-present Igara Studio S.A.
Copyright (c) 2001-2018 David Capello

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Aseprite Render Library (MIT)

Source: `src/render/render.cpp` of <https://github.com/aseprite/aseprite>; this file belongs to
Aseprite's render library, which is released under the MIT licence (`src/render/LICENSE.txt`).

Version: Aseprite v1.3.18.6 (commit `331e898ef405d919539c03fd1675691cfa16c3a3`).

Used in `tests/unit/fixtures/se-061-blend-golden.generate.mjs`: the opacity of a cel in a
composite, the product of the cel's and the layer's opacity (`MUL_UN8`).

```text
Copyright (c) 2019-2023  Igara Studio S.A.
Copyright (c) 2001-2018  David Capello

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Allegro (giftware)

Source: `calc_spline` of `src/spline.c` in Allegro 4 (<https://github.com/liballeg/allegro5>,
branch `4.4`), which its header credits to Seymour Shlien, optimised by Sven Sandberg.
Aseprite's `algo_spline` (above) is adapted from it.

Version: the licence text of Allegro 4.4.3.1 (commit `8a386b2754608b66d46f10abf993abf8ab16902d`),
`docs/src/license._tx`. Allegro's licence names no copyright holders.

Reached through Aseprite's `algo_spline` in:

- `tests/unit/se-065-raster.test.ts`: `algo_spline`, ported as a test reference.
- `src/core/raster/curve.ts`: the sample count of `algo_spline`.

```text
Allegro is gift-ware. It was created by a number of people working in
cooperation, and is given to you freely as a gift. You may use, modify,
redistribute, and generally hack it about in any way you like, and you do
not have to give us anything in return.

However, if you like this product you are encouraged to thank us by making
a return gift to the Allegro community. This could be by writing an add-on
package, providing a useful bug report, making an improvement to the
library, or perhaps just releasing the sources of your program so that
other people can learn from them. If you redistribute parts of this code or
make a game using it, it would be nice if you mentioned Allegro somewhere
in the credits, but you are not required to do this. We trust you not to
abuse our generosity.

Disclaimer:

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. IN NO EVENT
SHALL THE COPYRIGHT HOLDERS OR ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE
FOR ANY DAMAGES OR OTHER LIABILITY, WHETHER IN CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## pixman (MIT)

Source: the `MUL_UN8` and `DIV_UN8` macros of `pixman/pixman-combine32.h` in pixman
(<https://gitlab.freedesktop.org/pixman/pixman>).

Version: pixman 0.46.4.

Ported in `src/core/composite/blend.ts`, `tests/unit/fixtures/se-061-blend-golden.generate.mjs`,
`tests/e2e/se-061-support.ts` and `tests/unit/se-061-blend.test.ts`.

```text
Copyright 1987, 1988, 1989, 1998  The Open Group
Copyright 1987, 1988, 1989 Digital Equipment Corporation
Copyright 1999, 2004, 2008 Keith Packard
Copyright 2000 SuSE, Inc.
Copyright 2000 Keith Packard, member of The XFree86 Project, Inc.
Copyright 2004, 2005, 2007, 2008, 2009, 2010 Red Hat, Inc.
Copyright 2004 Nicholas Miell
Copyright 2005 Lars Knoll & Zack Rusin, Trolltech
Copyright 2005 Trolltech AS
Copyright 2007 Luca Barbato
Copyright 2008 Aaron Plattner, NVIDIA Corporation
Copyright 2008 Rodrigo Kumpera
Copyright 2008 André Tupinambá
Copyright 2008 Mozilla Corporation
Copyright 2008 Frederic Plourde
Copyright 2009, Oracle and/or its affiliates. All rights reserved.
Copyright 2009, 2010 Nokia Corporation

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice (including the next
paragraph) shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## Bresenham curve rasterizing algorithms (MIT)

Source: `plotLine` and `plotEllipseRect` of `bresenham.c` in Alois Zingl's
<https://github.com/zingl/Bresenham>, described in his "A Rasterizing Algorithm for Drawing
Curves" (2012).

Version: commit `ce9002f5aa1d95bdb7d71a39ebdb0987df139db5`.

Ported in:

- `src/core/raster/line.ts`: `plotLine`, the line of every tool.
- `src/core/raster/ellipse.ts`: `plotEllipseRect`, the ellipse tool.
- `src/core/raster/brush.ts`: `plotEllipseRect`, the circle brush.
- `src/core/selection/shapes.ts`: `plotEllipseRect`, the elliptical marquee.
- `tests/e2e/se-015-pencil.spec.ts` and `tests/e2e/se-017-support.ts`: `plotLine`, as the
  expected pixels of the E2E tests.

```text
MIT License

Copyright (c) 2020 zingl

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Oklab (MIT)

Source: the conversions `linear_srgb_to_oklab` and `oklab_to_linear_srgb` of Björn Ottosson's
"A perceptual color space for image processing" (<https://bottosson.github.io/posts/oklab/>).
The article makes the code available in the public domain and, as an alternative, under the
MIT licence below (<https://bottosson.github.io/misc/License.txt>).

Version: the article as published on 23 December 2020 (modified 27 January 2021).

Ported in `src/core/color/oklab.ts`: sRGB ↔ OKLab, the colour distance of the PNG import.

```text
Copyright (c) 2020 Björn Ottosson
Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## mulberry32 (public domain, CC0 1.0)

Source: `mulberry32.c` by Tommy Ettinger
(<https://gist.github.com/tommyettinger/46a874533244883189143505d203312c>).

Version: gist revision `fc93b8ad259c09a3635d80ed12a05309120795dc` (6 November 2017), the
revision with the constant `0x6D2B79F5`.

Ported in:

- `src/core/raster/spray.ts` (`createRandom`): the seeded generator of the spray.
- `tests/unit/se-030-support.ts`, `tests/unit/se-032-floating.test.ts`,
  `tests/perf/se-032-move.perf.ts`, `tests/perf/se-033-transform.perf.ts` and
  `tests/e2e/se-070-soak.spec.ts`: the same generator, for repeatable test data.
- `tests/unit/se-065-raster.test.ts` quotes the steps of `mulberry32.c` in a comment.

```text
Written in 2017 by Tommy Ettinger (tommy.ettinger@gmail.com)

To the extent possible under law, the author has dedicated all copyright
and related and neighboring rights to this software to the public domain
worldwide. This software is distributed without any warranty.

See <http://creativecommons.org/publicdomain/zero/1.0/>.
```

## gif.js (MIT)

Source: <https://github.com/jnordberg/gif.js>, whose LZW encoder (`LZWEncoder.js`) the
`gifenc` package credits as the origin of its own (`src/lzwEncode.js`). That file's header
also credits Kevin Weiner's Java encoder and an ActionScript version by Thibault Imbert;
the source repository's `docs/PROVENANCE.md`, which is not part of the app, records what is
known of their licences.

Version: the licence text of commit `92d27a02841339e202c75150dcf6fe5f4fa42ec5` (the file's only
revision, `a2201f1`, 5 May 2018).

Bundled through `gifenc` 1.0.3 in the GIF export.

```text
The MIT License (MIT)

Copyright (c) 2013-2018 Johan Nordberg

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## gif-codec (MIT)

Source: <https://github.com/potomak/gif-codec>, which the `gifenc` package credits as an origin
of its code. `gifenc`'s `src/constants.js` is the same as gif-codec's `src/constants.js`, and its
`src/index.js` has gif-codec's encoder functions (`encodeLogicalScreenDescriptor`,
`encodeColorTable`, `encodeImageDescriptor`, `colorTableSize`).

Version: the licence text of commit `40456125bdbe2bf6b7acc8199cd1794725cbfa30` (the file's only
revision, `7b5a46b`, 24 October 2018).

Bundled through `gifenc` 1.0.3 in the GIF export.

```text
The MIT License (MIT)

Copyright (c) 2018 Giovanni Cappellotto

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
