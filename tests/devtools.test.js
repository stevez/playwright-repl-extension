import { describe, it, expect } from "vitest";
import { chrome } from "vitest-chrome/lib/index.esm.js";

describe("devtools.js", () => {
  it("registers a DevTools panel", async () => {
    await import("../devtools.js");

    expect(chrome.devtools.panels.create).toHaveBeenCalledWith(
      "Playwright REPL",
      "icons/icon16.png",
      "panel/panel.html"
    );
  });
});
