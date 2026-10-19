/**
 * The index of the colour nearest to (L, a, b) among the OKLab colours of `lab`, which holds
 * L, a and b of every colour, three numbers each. Nearest is the smallest squared distance
 * `dL² + da² + db²`; of equally near colours, the lowest index wins.
 */
export function nearestColor(lab: Float64Array, L: number, a: number, b: number): number {
    let best = 0;
    let bestDistance = Infinity;
    for (let c = 0; c * 3 < lab.length; c++) {
        const dL = lab[c * 3] - L;
        const da = lab[c * 3 + 1] - a;
        const db = lab[c * 3 + 2] - b;
        const distance = dL * dL + da * da + db * db;
        if (distance < bestDistance) {
            best = c;
            bestDistance = distance;
        }
    }
    return best;
}

/**
 * `nearestColor` for many queries against one set of colours (SE-044: the import of a large
 * target with 256 colours searches a million times): the same answer for every query, found
 * faster. The colours are kept sorted by L; a query looks at them outwards from its own L and
 * stops once the difference in L alone exceeds the best distance found, which no colour
 * further out can then reach or tie. Distances are computed as `nearestColor` computes them,
 * and of equally near colours the lowest index wins, so the result is identical. `lab` must
 * not change while the search is used.
 *
 * `hint`, a colour index, is measured first: a good guess (the answer for the pixel before)
 * narrows the colours looked at. It never changes the answer.
 */
export function nearestSearch(
    lab: Float64Array,
): (L: number, a: number, b: number, hint?: number) => number {
    const count = lab.length / 3;
    const order = Uint32Array.from({ length: count }, (_, c) => c).sort(
        (x, y) => lab[x * 3] - lab[y * 3] || x - y,
    );
    const lightness = Float64Array.from(order, (c) => lab[c * 3]);
    return (L, a, b, hint = -1) => {
        let best = 0;
        let bestDistance = Infinity;
        if (hint >= 0 && hint < count) {
            const dL = lab[hint * 3] - L;
            const da = lab[hint * 3 + 1] - a;
            const db = lab[hint * 3 + 2] - b;
            best = hint;
            bestDistance = dL * dL + da * da + db * db;
        }
        // The first colour whose L is at least `L`.
        let low = 0;
        let high = count;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (lightness[middle] < L) low = middle + 1;
            else high = middle;
        }
        let up = low;
        let down = low - 1;
        for (;;) {
            const upGap = up < count ? lightness[up] - L : Infinity;
            const downGap = down >= 0 ? L - lightness[down] : Infinity;
            const gap = upGap <= downGap ? upGap : downGap;
            // Every colour not looked at is at least this far in L alone.
            if (gap === Infinity || gap * gap > bestDistance) return best;
            const c = upGap <= downGap ? order[up++] : order[down--];
            const dL = lab[c * 3] - L;
            const da = lab[c * 3 + 1] - a;
            const db = lab[c * 3 + 2] - b;
            const distance = dL * dL + da * da + db * db;
            if (distance < bestDistance || (distance === bestDistance && c < best)) {
                best = c;
                bestDistance = distance;
            }
        }
    };
}
