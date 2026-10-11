/* global URL */
// SE-002 question 10. Hand-written `ngne-preview` adapter per SPEC §9.5: two 33×33 source
// frames, each exported with an even 34×34 rectangle (one transparent column and row of
// padding on the right and bottom, SPEC §9.2). `hero.png` is 71×36 with padding 1.
export default {
    images: [{ id: "hero", src: new URL("./hero.png", import.meta.url) }],
    frames: [
        {
            id: "hero-0",
            image: "hero",
            x: 1,
            y: 1,
            width: 34,
            height: 34,
            destinationWidth: 34,
            destinationHeight: 34,
        },
        {
            id: "hero-1",
            image: "hero",
            x: 36,
            y: 1,
            width: 34,
            height: 34,
            destinationWidth: 34,
            destinationHeight: 34,
        },
    ],
    animations: [
        {
            id: "walk",
            playback: "loop",
            entries: [
                { frame: "hero-0", ms: 100 },
                { frame: "hero-1", ms: 100 },
            ],
        },
    ],
    display: { density: 1, scale: 1, pixelSnap: true },
};
