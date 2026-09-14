import vinext from "vinext";
import { defineConfig } from "vite";

// Scopewright builds to a plain Node server: `vinext build` writes dist/, and
// `vinext start` serves it (see Containerfile). No hosting-specific plugins.
export default defineConfig({ plugins: [vinext()] });
