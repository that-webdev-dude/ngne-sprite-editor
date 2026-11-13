# Third-party notices

Parts of this repository are ported from third-party source code. Each part and its licence
is listed below. Runtime dependencies installed through npm carry their own licences in
`node_modules`.

NGNE Sprite Editor is not affiliated with or endorsed by Aseprite or Igara Studio S.A.
"Aseprite" is used only to name the program whose file formats and behaviour this editor
follows.

## Aseprite Document Library (MIT)

Source: `src/doc/blend_funcs.cpp` and `src/doc/algo.cpp` of
<https://github.com/aseprite/aseprite>. Unlike the rest of Aseprite, these files are released
under the MIT licence (`src/doc/LICENSE.txt`).

Ported or transcribed in:

- `src/core/composite/blend.ts`: the blend-mode formulas of `blend_funcs.cpp`.
- `tests/unit/fixtures/se-061-blend-golden.generate.mjs`: `blend_funcs.cpp`, transcribed line
  by line to generate the expected composites.
- `tests/unit/se-065-raster.test.ts`: `algo_spline` of `algo.cpp`, ported as a test reference.
  Aseprite took that function from Allegro's `calc_spline`, which Allegro releases as
  giftware.

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

## pixman (MIT)

Source: the `MUL_UN8` and `DIV_UN8` macros of `pixman/pixman-combine32.h` in pixman
(<https://gitlab.freedesktop.org/pixman/pixman>).

Ported in `src/core/composite/blend.ts` and
`tests/unit/fixtures/se-061-blend-golden.generate.mjs`.

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
