/**
 * Fuzzy matching of the command palette (DESIGN §4): the characters of the term must appear in
 * the text in their order, not necessarily next to each other. Upper and lower case are the
 * same.
 */

/** One point for every character of the term that is found. */
const MATCH = 1;
/** More for a character that directly follows the previous match: "und" in "Undo". */
const ADJACENT = 4;
/** More for a character that starts a word: "ns" in "New Sprite". */
const WORD_START = 3;
/** Lost for every character of the text skipped between two matches. */
const GAP = 0.1;
/** Lost for every character of the text before the first match. */
const LEAD = 0.05;

function isWordStart(text: string, index: number): boolean {
    return index === 0 || !/[\p{L}\p{N}]/u.test(text[index - 1] ?? "");
}

/** The score of the match that starts at `start` and takes each next character at once. */
function scoreFrom(needle: string, haystack: string, start: number): number | null {
    let score = -start * LEAD;
    let previous = -1;
    let at = start;
    for (let index = 0; index < needle.length; index++) {
        if (index > 0) at = haystack.indexOf(needle[index] ?? "", previous + 1);
        if (at === -1) return null;
        score += MATCH;
        if (index > 0 && at === previous + 1) score += ADJACENT;
        else if (index > 0) score -= (at - previous - 1) * GAP;
        if (isWordStart(haystack, at)) score += WORD_START;
        previous = at;
    }
    return score;
}

/**
 * How well `term` matches `text`: higher is better, null when it does not match. An empty
 * term matches everything with 0. Every position of the term's first character is tried as
 * the start, so "save" finds the word in "Sprite: Save" and not its scattered letters.
 */
export function fuzzyScore(term: string, text: string): number | null {
    const needle = term.toLowerCase();
    if (needle === "") return 0;
    const haystack = text.toLowerCase();
    const first = needle[0] ?? "";
    let best: number | null = null;
    for (
        let start = haystack.indexOf(first);
        start !== -1;
        start = haystack.indexOf(first, start + 1)
    ) {
        const score = scoreFrom(needle, haystack, start);
        // A later start has fewer characters left: when this one fails, so do the rest.
        if (score === null) break;
        if (best === null || score > best) best = score;
    }
    return best;
}
