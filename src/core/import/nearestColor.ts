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
