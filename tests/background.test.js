import { describe, it, expect, vi, beforeEach } from "vitest";
import { chrome } from "vitest-chrome/lib/index.esm.js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Read the actual recorder.js file content for fetch mock
const recorderCode = readFileSync(
  resolve(import.meta.dirname, "..", "content", "recorder.js"),
  "utf-8"
);

// Mock fetch so getRecorderCode() can load content/recorder.js
globalThis.fetch = vi.fn(() =>
  Promise.resolve({ text: () => Promise.resolve(recorderCode) })
);
chrome.runtime.getURL = vi.fn((path) => `chrome-extension://test/${path}`);

// Mock chrome.debugger.sendCommand to resolve with expected results
beforeEach(() => {
  vi.restoreAllMocks();
  // Re-apply fetch mock after restoreAllMocks
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ text: () => Promise.resolve(recorderCode) })
  );
  chrome.runtime.getURL = vi.fn((path) => `chrome-extension://test/${path}`);
  chrome.debugger.sendCommand.mockReset();
  chrome.debugger.attach.mockReset();
  chrome.debugger.detach.mockReset();
  chrome.debugger.onEvent.clearListeners();
});

// Dynamic import so chrome mocks are in place first
let handleCommand, cmdHelp, getRecorderCode, startRecording, stopRecording,
  ensureAttached, waitForLoad, attachedTabs, recordingTabs, panelPorts;

beforeEach(async () => {
  const mod = await import("../background.js");
  handleCommand = mod.handleCommand;
  cmdHelp = mod.cmdHelp;
  getRecorderCode = mod.getRecorderCode;
  startRecording = mod.startRecording;
  stopRecording = mod.stopRecording;
  ensureAttached = mod.ensureAttached;
  waitForLoad = mod.waitForLoad;
  attachedTabs = mod.attachedTabs;
  recordingTabs = mod.recordingTabs;
  panelPorts = mod.panelPorts;
  // Ensure clean state
  attachedTabs.clear();
  recordingTabs.clear();
  panelPorts.clear();
});

// Helper: mock sendCommand that triggers loadEventFired for navigation commands
function mockSendCommandWithNavigation() {
  chrome.debugger.sendCommand.mockImplementation(async (source, method) => {
    if (["Page.navigate", "Page.reload", "Page.navigateToHistoryEntry"].includes(method)) {
      setTimeout(() => {
        chrome.debugger.onEvent.callListeners({ tabId: 1 }, "Page.loadEventFired", {});
      }, 0);
    }
    return undefined;
  });
}

describe("cmdHelp", () => {
  it("returns help text", () => {
    const result = cmdHelp();
    expect(result.success).toBe(true);
    expect(result.type).toBe("info");
    expect(result.data).toContain("Available commands:");
    expect(result.data).toContain("goto");
    expect(result.data).toContain("click");
    expect(result.data).toContain("fill");
    expect(result.data).toContain("snapshot");
    expect(result.data).toContain("screenshot");
    expect(result.data).toContain("eval");
    expect(result.data).toContain("export");
    expect(result.data).toContain("verify-text");
    expect(result.data).toContain("verify-no-text");
    expect(result.data).toContain("verify-element");
    expect(result.data).toContain("verify-url");
    expect(result.data).toContain("verify-title");
    expect(result.data).toContain("history");
    expect(result.data).toContain("clear");
    expect(result.data).toContain("reset");
    expect(result.data).toContain("help");
  });
});

describe("getRecorderCode", () => {
  it("returns a string of JavaScript", async () => {
    const code = await getRecorderCode();
    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(100);
  });

  it("caches the result after first fetch", async () => {
    const code1 = await getRecorderCode();
    const code2 = await getRecorderCode();
    expect(code1).toBe(code2);
    expect(typeof code1).toBe("string");
  });

  it("contains the IIFE wrapper", async () => {
    const code = await getRecorderCode();
    expect(code).toContain("(() => {");
    expect(code).toContain("})();");
  });

  it("sets __pwRecorderActive flag", async () => {
    const code = await getRecorderCode();
    expect(code).toContain("__pwRecorderActive");
  });

  it("includes event listeners for click, input, change, keydown", async () => {
    const code = await getRecorderCode();
    expect(code).toContain('"click"');
    expect(code).toContain('"input"');
    expect(code).toContain('"change"');
    expect(code).toContain('"keydown"');
  });

  it("includes cleanup function", async () => {
    const code = await getRecorderCode();
    expect(code).toContain("__pwRecorderCleanup");
  });

  it("sends commands via console.debug with __pw: prefix", async () => {
    const code = await getRecorderCode();
    expect(code).toContain('console.debug("__pw:"');
  });

  it("includes checkbox detection", async () => {
    const code = await getRecorderCode();
    expect(code).toContain("findCheckbox");
  });

  it("includes action button detection", async () => {
    const code = await getRecorderCode();
    expect(code).toContain("actionWords");
    expect(code).toContain("delete");
    expect(code).toContain("destroy");
  });

  it("includes fill debounce with 1500ms timer", async () => {
    const code = await getRecorderCode();
    expect(code).toContain("1500");
    expect(code).toContain("flushFill");
  });

  it("includes item context for scoped clicks", async () => {
    const code = await getRecorderCode();
    expect(code).toContain("getItemContext");
  });
});

describe("handleCommand", () => {
  it("returns error for invalid command", async () => {
    const result = await handleCommand("", 1);
    expect(result.type).toBe("error");
    expect(result.data).toBe("Invalid command");
  });

  it("returns error for comments", async () => {
    const result = await handleCommand("# a comment", 1);
    expect(result.type).toBe("error");
    expect(result.data).toBe("Invalid command");
  });

  it("returns help without needing CDP", async () => {
    const result = await handleCommand("help", 1);
    expect(result.success).toBe(true);
    expect(result.type).toBe("info");
    expect(result.data).toContain("Available commands:");
    // Should NOT have called debugger.attach
    expect(chrome.debugger.attach).not.toHaveBeenCalled();
  });

  it("returns error for unknown command after attaching", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("unknowncmd", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Unknown command: unknowncmd");
  });

  it("returns usage error for goto without URL", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("goto", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  it("returns usage error for fill with missing args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand('fill "Email"', 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  it("returns usage error for click with missing args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("click", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  it("returns usage error for eval with missing args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("eval", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  it("returns usage error for press with missing args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("press", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  it("returns usage error for select with missing args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand('select "Country"', 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  it("returns usage error for check with missing args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("check", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  it("returns usage error for hover with missing args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("hover", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  it("returns usage error for dblclick with missing args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("dblclick", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  it("handles goto with URL successfully", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    mockSendCommandWithNavigation();
    const result = await handleCommand("goto https://example.com", 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("Navigated to https://example.com");
  });

  it("handles goto without protocol", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    mockSendCommandWithNavigation();
    const result = await handleCommand("goto example.com", 1);
    expect(result.data).toContain("https://example.com");
  });

  it("handles open as alias for goto", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    mockSendCommandWithNavigation();
    const result = await handleCommand("open https://example.com", 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("Navigated to");
  });

  it("handles click with successful result", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { success: true, tag: "button" } },
    });
    const result = await handleCommand('click "Submit"', 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain('Clicked "Submit"');
  });

  it("handles eval with result", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: "Test Page" },
    });
    const result = await handleCommand("eval document.title", 1);
    expect(result.success).toBe(true);
    expect(result.type).toBe("info");
  });

  it("handles snapshot", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      nodes: [
        { role: { value: "button" }, name: { value: "Submit" } },
      ],
    });
    const result = await handleCommand("snapshot", 1);
    expect(result.success).toBe(true);
    expect(result.type).toBe("snapshot");
    expect(result.data).toContain("button");
  });

  it("handles screenshot", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      data: "base64imagedata",
    });
    const result = await handleCommand("screenshot", 1);
    expect(result.success).toBe(true);
    expect(result.type).toBe("screenshot");
  });

  it("handles press with key mapping", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("press enter", 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("Pressed enter");
  });

  it("handles reload", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    mockSendCommandWithNavigation();
    const result = await handleCommand("reload", 1);
    expect(result.success).toBe(true);
    expect(result.data).toBe("Page reloaded");
  });

  it("handles fill successfully", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { success: true } },
    });
    const result = await handleCommand('fill "Email" "test@test.com"', 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("Filled");
  });

  it("handles click with scoped target", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { success: true, tag: "button" } },
    });
    const result = await handleCommand('click "delete" "Buy milk"', 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain('Clicked "delete" in "Buy milk"');
  });

  it("handles click with element not found", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { error: "No element found" } },
    });
    const result = await handleCommand('click "Missing"', 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("No element found");
  });

  it("handles click when Runtime.evaluate throws", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    let callCount = 0;
    chrome.debugger.sendCommand.mockImplementation(async () => {
      callCount++;
      // First two calls are Page.enable and Runtime.enable from ensureAttached
      if (callCount <= 2) return undefined;
      // Third call is Runtime.evaluate from cmdClick — throw
      throw new Error("Context destroyed");
    });
    const result = await handleCommand('click "Submit"', 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("Click failed");
  });

  it("handles fill with element not found", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { error: "Input not found: Email" } },
    });
    const result = await handleCommand('fill "Email" "test@test.com"', 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("Input not found");
  });

  it("handles select with successful result", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { success: true } },
    });
    const result = await handleCommand('select "Country" "US"', 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain('Selected "US" in "Country"');
  });

  it("handles select with element not found", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { error: "No select found: Country" } },
    });
    const result = await handleCommand('select "Country" "US"', 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("No select found");
  });

  it("handles check with successful result", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { success: true, checked: true } },
    });
    const result = await handleCommand('check "Accept terms"', 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain('Checked "Accept terms"');
  });

  it("handles uncheck with successful result", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { success: true, checked: false } },
    });
    const result = await handleCommand('uncheck "Accept terms"', 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain('Unchecked "Accept terms"');
  });

  it("returns usage error for uncheck without args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("uncheck", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  it("handles hover with successful result", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { x: 100, y: 200 } },
    });
    const result = await handleCommand('hover "Menu"', 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain('Hovered "Menu"');
  });

  it("handles hover with element not found", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { error: "No element found: Missing" } },
    });
    const result = await handleCommand('hover "Missing"', 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("No element found");
  });

  it("handles dblclick with successful result", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { success: true } },
    });
    const result = await handleCommand('dblclick "Edit"', 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain('Double-clicked "Edit"');
  });

  it("handles dblclick with element not found", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { error: "No element found: Missing" } },
    });
    const result = await handleCommand('dblclick "Missing"', 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("No element found");
  });

  it("handles go-back with history", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockImplementation(async (source, method) => {
      if (method === "Page.getNavigationHistory") {
        return {
          currentIndex: 1,
          entries: [
            { id: 0, url: "https://example.com" },
            { id: 1, url: "https://example.com/page2" },
          ],
        };
      }
      if (method === "Page.navigateToHistoryEntry") {
        setTimeout(() => {
          chrome.debugger.onEvent.callListeners({ tabId: 1 }, "Page.loadEventFired", {});
        }, 0);
      }
      return undefined;
    });
    const result = await handleCommand("go-back", 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("Navigated back");
  });

  it("handles back as alias for go-back", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockImplementation(async (source, method) => {
      if (method === "Page.getNavigationHistory") {
        return {
          currentIndex: 1,
          entries: [
            { id: 0, url: "https://example.com" },
            { id: 1, url: "https://example.com/page2" },
          ],
        };
      }
      if (method === "Page.navigateToHistoryEntry") {
        setTimeout(() => {
          chrome.debugger.onEvent.callListeners({ tabId: 1 }, "Page.loadEventFired", {});
        }, 0);
      }
      return undefined;
    });
    const result = await handleCommand("back", 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("Navigated back");
  });

  it("handles go-back with no history", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      currentIndex: 0,
      entries: [{ id: 0, url: "https://example.com" }],
    });
    const result = await handleCommand("go-back", 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("No previous page");
  });

  it("handles go-forward with history", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockImplementation(async (source, method) => {
      if (method === "Page.getNavigationHistory") {
        return {
          currentIndex: 0,
          entries: [
            { id: 0, url: "https://example.com" },
            { id: 1, url: "https://example.com/page2" },
          ],
        };
      }
      if (method === "Page.navigateToHistoryEntry") {
        setTimeout(() => {
          chrome.debugger.onEvent.callListeners({ tabId: 1 }, "Page.loadEventFired", {});
        }, 0);
      }
      return undefined;
    });
    const result = await handleCommand("go-forward", 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("Navigated forward");
  });

  it("handles forward as alias for go-forward", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockImplementation(async (source, method) => {
      if (method === "Page.getNavigationHistory") {
        return {
          currentIndex: 0,
          entries: [
            { id: 0, url: "https://example.com" },
            { id: 1, url: "https://example.com/page2" },
          ],
        };
      }
      if (method === "Page.navigateToHistoryEntry") {
        setTimeout(() => {
          chrome.debugger.onEvent.callListeners({ tabId: 1 }, "Page.loadEventFired", {});
        }, 0);
      }
      return undefined;
    });
    const result = await handleCommand("forward", 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("Navigated forward");
  });

  it("handles go-forward at end of history", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      currentIndex: 0,
      entries: [{ id: 0, url: "https://example.com" }],
    });
    const result = await handleCommand("go-forward", 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("No next page");
  });

  it("handles screenshot full page", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockImplementation(async (source, method) => {
      if (method === "Page.getLayoutMetrics") {
        return { contentSize: { width: 1200, height: 5000 } };
      }
      if (method === "Page.captureScreenshot") {
        return { data: "fullpagebase64" };
      }
      return undefined;
    });
    const result = await handleCommand("screenshot full", 1);
    expect(result.success).toBe(true);
    expect(result.type).toBe("screenshot");
    expect(result.data).toBe("fullpagebase64");
  });

  it("handles eval with exception", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      exceptionDetails: { text: "ReferenceError: foo is not defined" },
    });
    const result = await handleCommand("eval foo.bar", 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("ReferenceError");
  });

  it("handles eval with undefined result", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: undefined },
    });
    const result = await handleCommand("eval void 0", 1);
    expect(result.success).toBe(true);
    expect(result.data).toBe("undefined");
  });

  it("handles press with unmapped key", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("press a", 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("Pressed a");
  });

  it("handles command aliases: c for click, s for snapshot, f for fill, p for press", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { success: true, tag: "button" } },
    });
    const clickResult = await handleCommand('c "OK"', 1);
    expect(clickResult.success).toBe(true);

    chrome.debugger.sendCommand.mockResolvedValue({
      nodes: [{ role: { value: "button" }, name: { value: "OK" } }],
    });
    const snapResult = await handleCommand("s", 1);
    expect(snapResult.type).toBe("snapshot");

    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: { success: true } },
    });
    const fillResult = await handleCommand('f "Name" "Alice"', 1);
    expect(fillResult.success).toBe(true);

    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const pressResult = await handleCommand("p enter", 1);
    expect(pressResult.success).toBe(true);
  });

  // --- verify-text ---
  it("verify-text passes when text is found", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: true },
    });
    const result = await handleCommand('verify-text "Hello"', 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("PASS");
    expect(result.data).toContain("Hello");
  });

  it("verify-text fails when text is not found", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: false },
    });
    const result = await handleCommand('verify-text "Missing"', 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("FAIL");
    expect(result.data).toContain("not found");
  });

  it("verify-text returns usage error without args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("verify-text", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  // --- verify-no-text ---
  it("verify-no-text passes when text is absent", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: false },
    });
    const result = await handleCommand('verify-no-text "Gone"', 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("PASS");
    expect(result.data).toContain("not present");
  });

  it("verify-no-text fails when text is present", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: true },
    });
    const result = await handleCommand('verify-no-text "Oops"', 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("FAIL");
    expect(result.data).toContain("was found");
  });

  it("verify-no-text returns usage error without args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("verify-no-text", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  // --- verify-element ---
  it("verify-element passes when element found", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: true },
    });
    const result = await handleCommand('verify-element "Submit"', 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("PASS");
    expect(result.data).toContain("found");
  });

  it("verify-element fails when element not found", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: false },
    });
    const result = await handleCommand('verify-element "Missing"', 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("FAIL");
    expect(result.data).toContain("not found");
  });

  it("verify-element returns usage error without args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("verify-element", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  // --- verify-no-element ---
  it("verify-no-element passes when element absent", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: false },
    });
    const result = await handleCommand('verify-no-element "Deleted"', 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("PASS");
    expect(result.data).toContain("not present");
  });

  it("verify-no-element fails when element exists", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: true },
    });
    const result = await handleCommand('verify-no-element "Still here"', 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("FAIL");
    expect(result.data).toContain("was found");
  });

  it("verify-no-element returns usage error without args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("verify-no-element", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  // --- verify-url ---
  it("verify-url passes when URL contains substring", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: "https://example.com/dashboard" },
    });
    const result = await handleCommand('verify-url "dashboard"', 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("PASS");
    expect(result.data).toContain("dashboard");
  });

  it("verify-url fails when URL does not contain substring", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: "https://example.com/home" },
    });
    const result = await handleCommand('verify-url "dashboard"', 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("FAIL");
    expect(result.data).toContain("does not contain");
  });

  it("verify-url returns usage error without args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("verify-url", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  // --- verify-title ---
  it("verify-title passes when title contains text", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: "My App - Dashboard" },
    });
    const result = await handleCommand('verify-title "Dashboard"', 1);
    expect(result.success).toBe(true);
    expect(result.data).toContain("PASS");
    expect(result.data).toContain("Dashboard");
  });

  it("verify-title fails when title does not contain text", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({
      result: { value: "My App - Home" },
    });
    const result = await handleCommand('verify-title "Dashboard"', 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("FAIL");
    expect(result.data).toContain("does not contain");
  });

  it("verify-title returns usage error without args", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await handleCommand("verify-title", 1);
    expect(result.type).toBe("error");
    expect(result.data).toContain("Usage");
  });

  // --- verify error handling ---
  it("verify-text handles CDP errors", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    let callCount = 0;
    chrome.debugger.sendCommand.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) return undefined;
      throw new Error("Context destroyed");
    });
    const result = await handleCommand('verify-text "Hello"', 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("Verify failed");
  });

  it("returns error when debugger attach fails", async () => {
    chrome.debugger.attach.mockRejectedValue(new Error("Already attached"));
    const result = await handleCommand("goto https://example.com", 1);
    expect(result.success).toBe(false);
    expect(result.data).toContain("Failed to attach debugger");
  });
});

describe("ensureAttached", () => {
  it("attaches debugger and enables domains", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    await ensureAttached(1);
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 1 }, "1.3");
    expect(attachedTabs.has(1)).toBe(true);
  });

  it("skips attach if already attached", async () => {
    attachedTabs.add(1);
    await ensureAttached(1);
    expect(chrome.debugger.attach).not.toHaveBeenCalled();
  });
});

describe("startRecording", () => {
  it("returns success when recording starts", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({ identifier: "script-1" });
    const result = await startRecording(1);
    expect(result.success).toBe(true);
    expect(recordingTabs.has(1)).toBe(true);
  });

  it("returns error when attach fails", async () => {
    chrome.debugger.attach.mockRejectedValue(new Error("Cannot attach"));
    const result = await startRecording(1);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot attach");
  });

  it("registers a CDP event listener for console.debug messages", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({ identifier: "script-1" });
    const mockPort = { postMessage: vi.fn() };
    panelPorts.set(1, mockPort);

    await startRecording(1);
    expect(recordingTabs.get(1).listener).toBeDefined();

    // Simulate a console.debug recorder event
    chrome.debugger.onEvent.callListeners(
      { tabId: 1 },
      "Runtime.consoleAPICalled",
      { type: "debug", args: [{ type: "string", value: '__pw:click "Submit"' }] }
    );
    expect(mockPort.postMessage).toHaveBeenCalledWith({
      type: "pw-recorded-command",
      command: 'click "Submit"',
    });
  });

  it("captures Page.frameNavigated events as goto commands", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({ identifier: "script-1" });
    const mockPort = { postMessage: vi.fn() };
    panelPorts.set(1, mockPort);

    await startRecording(1);

    // Simulate main frame navigation
    chrome.debugger.onEvent.callListeners(
      { tabId: 1 },
      "Page.frameNavigated",
      { frame: { url: "https://example.com/page", parentId: undefined } }
    );
    expect(mockPort.postMessage).toHaveBeenCalledWith({
      type: "pw-recorded-command",
      command: "goto https://example.com/page",
    });
  });

  it("ignores sub-frame navigations", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({ identifier: "script-1" });
    const mockPort = { postMessage: vi.fn() };
    panelPorts.set(1, mockPort);

    await startRecording(1);

    // Simulate sub-frame navigation (has parentId)
    chrome.debugger.onEvent.callListeners(
      { tabId: 1 },
      "Page.frameNavigated",
      { frame: { url: "https://example.com/iframe", parentId: "parent-1" } }
    );
    expect(mockPort.postMessage).not.toHaveBeenCalled();
  });

  it("ignores about: and chrome: URLs in navigation", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({ identifier: "script-1" });
    const mockPort = { postMessage: vi.fn() };
    panelPorts.set(1, mockPort);

    await startRecording(1);

    chrome.debugger.onEvent.callListeners(
      { tabId: 1 },
      "Page.frameNavigated",
      { frame: { url: "about:blank" } }
    );
    expect(mockPort.postMessage).not.toHaveBeenCalled();
  });
});

describe("stopRecording", () => {
  it("returns success when stopping", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({ identifier: "script-1" });
    chrome.debugger.detach.mockImplementation((target, cb) => cb && cb());

    await startRecording(1);
    expect(recordingTabs.has(1)).toBe(true);

    const result = await stopRecording(1);
    expect(result.success).toBe(true);
    expect(recordingTabs.has(1)).toBe(false);
  });

  it("detaches debugger on stop", async () => {
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockResolvedValue({ identifier: "script-1" });
    chrome.debugger.detach.mockImplementation((target, cb) => cb && cb());

    await startRecording(1);
    await stopRecording(1);

    expect(chrome.debugger.detach).toHaveBeenCalled();
  });

  it("returns success even when no active recording", async () => {
    chrome.debugger.sendCommand.mockResolvedValue(undefined);
    const result = await stopRecording(1);
    expect(result.success).toBe(true);
  });
});

describe("waitForLoad", () => {
  it("resolves when Page.loadEventFired is received", async () => {
    setTimeout(() => {
      chrome.debugger.onEvent.callListeners({ tabId: 1 }, "Page.loadEventFired", {});
    }, 10);
    await waitForLoad(1);
    // If we reach here, the promise resolved
    expect(true).toBe(true);
  });

  it("ignores events from other tabs", async () => {
    let resolved = false;
    const promise = waitForLoad(1).then(() => { resolved = true; });
    // Fire event for tab 2, should not resolve waitForLoad(1)
    chrome.debugger.onEvent.callListeners({ tabId: 2 }, "Page.loadEventFired", {});
    // Give it a tick
    await new Promise((r) => setTimeout(r, 50));
    expect(resolved).toBe(false);
    // Now fire for tab 1
    chrome.debugger.onEvent.callListeners({ tabId: 1 }, "Page.loadEventFired", {});
    await promise;
    expect(resolved).toBe(true);
  });
});
