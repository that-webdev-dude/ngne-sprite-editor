import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("the GUIDE scene equals the SE-053 consumer fixture byte for byte (CRLF normalized)", () => {
    const guide = readFileSync(new URL("../../docs/GUIDE.md", import.meta.url), "utf8").replace(
        /\r\n/g,
        "\n",
    );
    const fixture = readFileSync(
        new URL("../fixtures/ngne-consumer/game.ts", import.meta.url),
        "utf8",
    ).replace(/\r\n/g, "\n");
    expect(guide.match(/<!-- guide-example:start -->/g)).toHaveLength(1);
    expect(guide.match(/<!-- guide-example:end -->/g)).toHaveLength(1);
    const section = /<!-- guide-example:start -->([\s\S]*?)<!-- guide-example:end -->/.exec(guide);
    expect(section).not.toBeNull();
    expect(section?.[1]?.match(/```ts\n/g)).toHaveLength(1);
    const block = /^\s*```ts\n([\s\S]*?)^```\s*$/m.exec(section?.[1] ?? "");
    expect(block).not.toBeNull();
    expect(block?.[1]).toBe(fixture);
});
