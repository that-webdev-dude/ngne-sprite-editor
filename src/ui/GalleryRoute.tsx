import "@ngne/editor-ui/gallery.css";

// The development route `/gallery` (src/ui/App.tsx): the package's gallery with its own styles.
// This module alone imports them, after the package's stylesheet (src/main.tsx); the app loads
// it lazily, in development builds only, so production ships neither.
export { Gallery as default } from "@ngne/editor-ui/gallery";
