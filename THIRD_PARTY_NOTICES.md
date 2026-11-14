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
`docs/PROVENANCE.md` lists them.

Other product names used here, such as GIMP, Paint Shop Pro, PICO-8 and Game Boy, are
trademarks of their respective owners and name only file formats or palettes.

## Aseprite Document Library (MIT)

Source: `src/doc/blend_funcs.cpp` and `src/doc/algo.cpp` of
<https://github.com/aseprite/aseprite>. Aseprite's application code is distributed under its
End-User License Agreement; these files belong to its document library, which is released
under the MIT licence (`src/doc/LICENSE.txt`).

Version: Aseprite v1.3.18.6 (commit `331e898ef405d919539c03fd1675691cfa16c3a3`).

Ported or transcribed in:

- `src/core/composite/blend.ts`: the blend-mode formulas of `blend_funcs.cpp`.
- `tests/unit/fixtures/se-061-blend-golden.generate.mjs`: `blend_funcs.cpp`, transcribed line
  by line to generate the expected composites.
- `tests/e2e/se-061-support.ts`: the multiply, exclusion, difference and normal blends of
  `blend_funcs.cpp` for opaque images, as the expected images of the E2E tests.
- `tests/unit/se-065-raster.test.ts`: `algo_spline` of `algo.cpp`, ported as a test reference.
  Aseprite adapted that function from Allegro's `calc_spline`; see Allegro below.

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

## Allegro (giftware)

Source: `calc_spline` of `src/spline.c` in Allegro 4 (<https://github.com/liballeg/allegro5>,
branch `4.4`), which its header credits to Seymour Shlien, optimised by Sven Sandberg.
Aseprite's `algo_spline` (above) is adapted from it.

Version: the licence text of Allegro 4.4.3.1 (commit `8a386b2754608b66d46f10abf993abf8ab16902d`),
`docs/src/license._tx`. Allegro's licence names no copyright holders.

Reached through Aseprite's `algo_spline` in:

- `tests/unit/se-065-raster.test.ts`: `algo_spline`, ported as a test reference.

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

Ported in `src/core/composite/blend.ts`, `tests/unit/fixtures/se-061-blend-golden.generate.mjs`
and `tests/e2e/se-061-support.ts`.

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
