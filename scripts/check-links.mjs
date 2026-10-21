import { execFileSync } from "node:child_process";
import { error, log } from "node:console";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import process from "node:process";

// SE-073: offline check of every tracked Markdown file, independent of npm dependencies.
// Git supplies the inventory (including staged files), never node_modules or build output.
const root = process.cwd();
const files = execFileSync("git", ["ls-files", "-z", "--", "*.md"], {
    cwd: root,
    encoding: "utf8",
})
    .split("\0")
    .filter(Boolean);
const problems = [];
const anchors = new Map();
const blank = (text) => text.replace(/[^\n]/g, " ");

function prose(source) {
    let fence;
    const lists = [];
    return source
        .replace(/\r\n/g, "\n")
        .replace(/<!--[^]*?-->/g, blank)
        .split("\n")
        .map((line) => {
            // Headings and links inside quotes/lists are rendered too. Remove container
            // prefixes before deciding whether indentation denotes a code block.
            while (/^ {0,3}>[ \t]?/.test(line)) line = line.replace(/^ {0,3}>[ \t]?/, "");
            if (line.trim()) {
                const indent = /^ */.exec(line)[0].length;
                while (lists.length && indent < lists.at(-1)) lists.pop();
                const list = /^( *)(?:[-+*]|\d+[.)])[ \t]+(?=\S)/.exec(line);
                if (list && list[1].length <= (lists.at(-1) ?? 0) + 3 && !fence) {
                    lists.push(list[0].length);
                    line = line.slice(list[0].length);
                } else if (lists.length) line = line.slice(lists.at(-1));
            }
            const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
            if (fence) {
                if (
                    marker &&
                    marker[1][0] === fence[0] &&
                    marker[1].length >= fence.length &&
                    !marker[2].trim()
                )
                    fence = undefined;
                return blank(line);
            }
            if (marker) {
                fence = marker[1];
                return blank(line);
            }
            return /^( {4}|\t)/.test(line) ? blank(line) : line;
        })
        .join("\n");
}

function entities(text) {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
    return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, key) => {
        if (key[0] !== "#") return named[key.toLowerCase()] ?? whole;
        const point =
            key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "\ufffd";
    });
}

function headingText(text) {
    const code = [];
    text = text.replace(/(`+)([^]*?)\1/g, (_, marks, value) => {
        code.push(value);
        return `\ue000${code.length - 1}\ue001`;
    });
    return entities(
        text
            .replace(/<[^>]*>/g, "")
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/\[([^\]]*)\](?:\[[^\]]*\])/g, "$1")
            .replace(/\\([\p{P}\p{S}])/gu, "$1")
            .replace(/[*~`]/g, "")
            .replace(/(?<!\w)_{1,3}|_{1,3}(?!\w)/g, "")
            .replace(/\ue000(\d+)\ue001/g, (_, index) => code[Number(index)]),
    );
}

function headingIds(source) {
    const ids = new Set();
    const counts = new Map();
    const lines = prose(source).split("\n");
    for (let i = 0; i < lines.length; i++) {
        const atx = /^ {0,3}#{1,6}(?:[ \t]+(.*)|$)/.exec(lines[i]);
        const setext =
            i + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1]) && lines[i].trim();
        if (!atx && !setext) continue;
        const text = atx ? (atx[1] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim() : lines[i].trim();
        if (setext && !atx) i++;
        // GitHub's heading rules: lowercase, remove punctuation/symbols except connector
        // punctuation and '-', keep alphabetic Unicode, replace each ASCII space with '-'.
        // Category rules: github-slugger/script/generate-regex.js; duplicate slugs are
        // collision-aware ("a", "a", "a-1" => "a", "a-1", "a-1-1").
        const base = [...headingText(text).toLowerCase()]
            .map((char) =>
                char === " "
                    ? "-"
                    : char === "-" || /[\p{Alphabetic}\p{M}\p{Nd}\p{Nl}\p{Pc}]/u.test(char)
                      ? char
                      : "",
            )
            .join("");
        let id = base;
        while (counts.has(id)) {
            const next = (counts.get(base) ?? 0) + 1;
            counts.set(base, next);
            id = `${base}-${next}`;
        }
        counts.set(id, 0);
        ids.add(id);
    }
    for (const match of prose(source).matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) {
        ids.add(entities(match[1]));
    }
    return ids;
}

function check(file, line, raw) {
    const link = entities(raw.replace(/\\([\p{P}\p{S}])/gu, "$1"));
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(link)) return; // Never fetch an external URL.
    const report = (reason) => problems.push(`${file}:${line}: ${raw} — ${reason}`);
    try {
        const hash = link.indexOf("#");
        const path = decodeURIComponent((hash < 0 ? link : link.slice(0, hash)).split("?")[0]);
        const fragment = hash < 0 ? "" : decodeURIComponent(link.slice(hash + 1));
        let target = path
            ? resolve(
                  path.startsWith("/") ? root : dirname(resolve(root, file)),
                  path.replace(/^\//, ""),
              )
            : resolve(root, file);
        if (!existsSync(target)) return report("file does not exist");
        if (statSync(target).isDirectory()) target = resolve(target, "README.md");
        if (!existsSync(target))
            return fragment ? report("directory has no README for its anchor") : undefined;
        if (!fragment) return;
        if (!anchors.has(target)) {
            const source = readFileSync(target, "utf8");
            anchors.set(
                target,
                extname(target).toLowerCase() === ".md"
                    ? headingIds(source)
                    : new Set(
                          [...source.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)].map(
                              (match) => entities(match[1]),
                          ),
                      ),
            );
        }
        if (!anchors.get(target).has(fragment)) report(`anchor #${fragment} does not exist`);
    } catch (cause) {
        report(cause.message);
    }
}

// Read a Markdown destination, including <paths with spaces> or balanced parentheses.
function destination(text, start) {
    let i = start;
    while (/\s/.test(text[i] ?? "") && i < text.length) i++;
    if (text[i] === "<") {
        const end = text.indexOf(">", i + 1);
        return end < 0 ? undefined : { value: text.slice(i + 1, end), end: end + 1 };
    }
    const begin = i;
    let depth = 0;
    for (; i < text.length; i++) {
        if (text[i] === "\\") {
            i++;
            continue;
        }
        if (text[i] === "(") depth++;
        if (text[i] === ")") {
            if (depth === 0) break;
            depth--;
        }
        if (/\s/.test(text[i]) && depth === 0) break;
    }
    return { value: text.slice(begin, i), end: i };
}

for (const file of files) {
    const source = prose(readFileSync(resolve(root, file), "utf8"));
    const references = new Map();
    const key = (label) => label.replace(/\s+/g, " ").trim().toLowerCase();
    const content = source
        .replace(/^ {0,3}\[([^\]]+)\]:\s*(.*)$/gm, (whole, label, rest, offset) => {
            const target = destination(rest, 0);
            if (target && !references.has(key(label))) references.set(key(label), target.value);
            if (target) check(file, source.slice(0, offset).split("\n").length, target.value);
            return blank(whole);
        })
        .replace(/(`+)([^]*?)\1/g, blank);
    // Inline links, images, full/collapsed reference links and defined shortcut links.
    const labels = /(?<!\\)!?\[((?:\\.|[^[\]\\]|\[[^\]]*\])*)\]/g;
    for (const match of content.matchAll(labels)) {
        const end = match.index + match[0].length;
        const line = content.slice(0, match.index).split("\n").length;
        if (content[end] === "(") {
            const target = destination(content, end + 1);
            if (target) check(file, line, target.value);
        } else {
            const reference = /^\[([^\]]*)\]/.exec(content.slice(end));
            const target = references.get(key(reference?.[1] || match[1]));
            if (target !== undefined) check(file, line, target);
        }
    }
    for (const match of content.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
        check(file, content.slice(0, match.index).split("\n").length, match[1]);
    }
}

if (problems.length) {
    problems.forEach((problem) => error(problem));
    process.exitCode = 1;
} else log(`Links OK: ${files.length} tracked Markdown files`);
