import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: "./tests/setup.js",
    environment: "happy-dom",
    coverage: {
      include: ["lib/**", "background.js", "panel/panel.js", "devtools.js", "content/recorder.js"],
    },
  },
});
