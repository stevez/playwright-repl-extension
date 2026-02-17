import { describe, it, expect, vi, beforeEach } from "vitest";
import { chrome } from "vitest-chrome/lib/index.esm.js";

let mockPort;

describe("panel.js", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();

    // Set up the DOM that panel.js expects (split editor/REPL layout)
    document.body.innerHTML = `
      <div id="toolbar">
        <div id="toolbar-left">
          <button id="open-btn">Open</button>
          <button id="save-btn" disabled>Save</button>
          <button id="copy-btn" disabled>Copy</button>
          <span class="toolbar-sep"></span>
          <button id="record-btn">&#9210; Record</button>
          <button id="run-btn">&#9654;</button>
          <button id="step-btn">&#9655;</button>
          <button id="export-btn" disabled>Export</button>
        </div>
        <div id="toolbar-right">
          <span id="file-info"></span>
        </div>
      </div>
      <div id="editor-pane">
        <div id="line-numbers"></div>
        <div id="editor-wrapper">
          <div id="line-highlight"></div>
          <textarea id="editor" spellcheck="false"></textarea>
        </div>
      </div>
      <div id="splitter"><div id="splitter-handle"></div></div>
      <div id="console-pane">
        <div id="console-header">
          <span id="console-header-left">
            <span id="console-title">Terminal</span>
            <button id="console-clear-btn">Clear</button>
          </span>
          <span id="console-stats"></span>
        </div>
        <div id="output"></div>
        <div id="input-bar">
          <span id="prompt">pw&gt;</span>
          <div id="input-wrapper">
            <div id="autocomplete-dropdown" hidden></div>
            <span id="ghost-text"></span>
            <input type="text" id="command-input" autocomplete="off" spellcheck="false">
          </div>
        </div>
      </div>
      <div id="lightbox" hidden><button id="lightbox-close-btn">&times;</button><button id="lightbox-save-btn">Save</button><img id="lightbox-img"></div>
    `;

    // Remove any theme class from previous test
    document.body.classList.remove("theme-dark");

    // Mock chrome.devtools.inspectedWindow.tabId
    chrome.devtools = {
      inspectedWindow: { tabId: 42 },
      panels: { create: vi.fn(), themeName: "default" },
    };

    // Mock chrome.runtime.connect to return a port-like object
    mockPort = {
      onMessage: { addListener: vi.fn() },
      postMessage: vi.fn(),
      onDisconnect: { addListener: vi.fn() },
      name: "pw-panel-42",
    };
    chrome.runtime.id = "mock-extension-id";
    chrome.runtime.connect.mockReturnValue(mockPort);
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
  });

  // --- Init ---

  it("renders welcome message on load", async () => {
    await import("../panel/panel.js");
    const output = document.getElementById("output");
    expect(output.textContent).toContain("Playwright REPL v0.9.3");
    expect(output.textContent).toContain("editor");
  });

  it("connects to background via port", async () => {
    await import("../panel/panel.js");
    expect(chrome.runtime.connect).toHaveBeenCalledWith({
      name: "pw-panel-42",
    });
  });

  it("reconnects port when service worker restarts", async () => {
    await import("../panel/panel.js");
    // Grab the onDisconnect callback that panel.js registered
    const disconnectCb = mockPort.onDisconnect.addListener.mock.calls[0][0];
    // Simulate service worker restart (port disconnects)
    vi.useFakeTimers();
    disconnectCb();
    vi.advanceTimersByTime(500);
    // Should have reconnected
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("focuses the editor on load", async () => {
    const editor = document.getElementById("editor");
    const focusSpy = vi.spyOn(editor, "focus");
    await import("../panel/panel.js");
    expect(focusSpy).toHaveBeenCalled();
  });

  it("has disabled copy, save, and export buttons initially", async () => {
    await import("../panel/panel.js");
    expect(document.getElementById("copy-btn").disabled).toBe(true);
    expect(document.getElementById("save-btn").disabled).toBe(true);
    expect(document.getElementById("export-btn").disabled).toBe(true);
  });

  it("has enabled open button", async () => {
    await import("../panel/panel.js");
    expect(document.getElementById("open-btn").disabled).toBe(false);
  });

  // --- Theme ---

  it("defaults to light theme (no theme-dark class)", async () => {
    chrome.devtools.panels.themeName = "default";
    await import("../panel/panel.js");
    expect(document.body.classList.contains("theme-dark")).toBe(false);
  });

  it("applies dark theme when DevTools theme is dark", async () => {
    chrome.devtools.panels.themeName = "dark";
    await import("../panel/panel.js");
    expect(document.body.classList.contains("theme-dark")).toBe(true);
  });

  it("applies light theme when themeName is undefined", async () => {
    chrome.devtools.panels.themeName = undefined;
    await import("../panel/panel.js");
    expect(document.body.classList.contains("theme-dark")).toBe(false);
  });

  // --- Line numbers ---

  it("renders line numbers for editor content", async () => {
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com\nclick \"OK\"\npress Enter";
    editor.dispatchEvent(new Event("input"));
    const lineNums = document.getElementById("line-numbers");
    const divs = lineNums.querySelectorAll("div");
    expect(divs.length).toBe(3);
    expect(divs[0].textContent).toBe("1");
    expect(divs[1].textContent).toBe("2");
    expect(divs[2].textContent).toBe("3");
  });

  it("shows file info with line count", async () => {
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com\nclick \"OK\"";
    editor.dispatchEvent(new Event("input"));
    const fileInfo = document.getElementById("file-info");
    expect(fileInfo.textContent).toContain("2 lines");
  });

  // --- REPL input ---

  it("sends command to background on Enter key", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "help";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "pw-command",
        raw: "help",
        tabId: 42,
      });
    });
  });

  it("clears input after Enter", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "snapshot";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(input.value).toBe("");
  });

  it("does not send empty commands", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  // --- Response display ---

  it("displays success response in output", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "Navigated to https://example.com" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "goto https://example.com";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      const output = document.getElementById("output");
      expect(output.textContent).toContain("Navigated to https://example.com");
    });
  });

  it("displays error response in output", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "error", data: "Element not found" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = 'click "Missing"';
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      const output = document.getElementById("output");
      expect(output.textContent).toContain("Element not found");
    });
  });

  it("displays snapshot lines in output", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "snapshot", data: '- button "OK" [ref=e1]\n- link "Home" [ref=e2]' });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "snapshot";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      const output = document.getElementById("output");
      expect(output.textContent).toContain("button");
      expect(output.textContent).toContain("link");
    });
  });

  it("displays screenshot as image in output", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "screenshot", data: "fakebase64" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "screenshot";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      const img = document.querySelector("img");
      expect(img).not.toBeNull();
      expect(img.src).toContain("fakebase64");
    });
  });

  it("displays info response in output", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "info", data: "Available commands:" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "help";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      const output = document.getElementById("output");
      expect(output.textContent).toContain("Available commands:");
    });
  });

  it("handles null response from background", async () => {
    chrome.runtime.sendMessage.mockResolvedValue(null);
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "snapshot";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      const output = document.getElementById("output");
      expect(output.textContent).toContain("No response");
    });
  });

  it("handles sendMessage rejection", async () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error("Disconnected"));
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "snapshot";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      const output = document.getElementById("output");
      expect(output.textContent).toContain("Error: Disconnected");
    });
  });

  it("displays comments without sending to background", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "# this is a comment";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const output = document.getElementById("output");
    expect(output.textContent).toContain("# this is a comment");
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  // --- History ---

  it("navigates command history with ArrowUp/ArrowDown", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");

    // Execute two commands
    input.value = "help";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.value = "snapshot";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    // ArrowUp should show last command
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(input.value).toBe("snapshot");

    // ArrowUp again should show first command
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(input.value).toBe("help");

    // ArrowDown should go back to second command
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(input.value).toBe("snapshot");

    // ArrowDown past end should clear input
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(input.value).toBe("");
  });

  // --- Copy/Save/Export tied to editor ---

  it("enables copy, save, export when editor has content", async () => {
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com";
    editor.dispatchEvent(new Event("input"));

    expect(document.getElementById("copy-btn").disabled).toBe(false);
    expect(document.getElementById("save-btn").disabled).toBe(false);
    expect(document.getElementById("export-btn").disabled).toBe(false);
  });

  it("disables copy, save, export when editor is empty", async () => {
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com";
    editor.dispatchEvent(new Event("input"));
    expect(document.getElementById("copy-btn").disabled).toBe(false);

    editor.value = "";
    editor.dispatchEvent(new Event("input"));
    expect(document.getElementById("copy-btn").disabled).toBe(true);
    expect(document.getElementById("save-btn").disabled).toBe(true);
    expect(document.getElementById("export-btn").disabled).toBe(true);
  });

  // --- Copy ---

  it("copy button copies editor content to clipboard", async () => {
    document.execCommand = vi.fn().mockReturnValue(true);
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com\nclick \"OK\"";
    editor.dispatchEvent(new Event("input"));

    document.getElementById("copy-btn").click();
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(document.getElementById("output").textContent).toContain("copied");
  });

  it("copy button shows message when editor is empty", async () => {
    await import("../panel/panel.js");
    document.getElementById("copy-btn").disabled = false;
    document.getElementById("copy-btn").click();
    expect(document.getElementById("output").textContent).toContain("Nothing to copy");
  });

  // --- Export ---

  it("export button converts editor to Playwright code", async () => {
    await import("../panel/panel.js");
    document.execCommand = vi.fn().mockReturnValue(true);
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com\nclick \"Submit\"";
    editor.dispatchEvent(new Event("input"));

    document.getElementById("export-btn").click();
    const output = document.getElementById("output");
    const codeBlock = output.querySelector(".code-block");
    expect(codeBlock).not.toBeNull();
    expect(codeBlock.textContent).toContain("@playwright/test");
    expect(codeBlock.querySelector(".code-copy-btn")).not.toBeNull();
  });

  it("export command in REPL reads from editor", async () => {
    await import("../panel/panel.js");
    document.execCommand = vi.fn().mockReturnValue(true);
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com";
    editor.dispatchEvent(new Event("input"));

    const input = document.getElementById("command-input");
    input.value = "export";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const output = document.getElementById("output");
    const codeBlock = output.querySelector(".code-block");
    expect(codeBlock).not.toBeNull();
    expect(codeBlock.textContent).toContain("@playwright/test");
  });

  it("export shows nothing when editor is empty", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "export";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const output = document.getElementById("output");
    expect(output.textContent).toContain("Nothing to export");
  });

  it("export single command converts to Playwright", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = 'export click "Submit"';
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const output = document.getElementById("output");
    expect(output.textContent).toContain("click");
  });

  // --- Recording ---

  it("record button toggles recording state", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true });
    await import("../panel/panel.js");
    const recordBtn = document.getElementById("record-btn");

    recordBtn.click();
    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "pw-record-start",
        tabId: 42,
      });
    });
    expect(recordBtn.classList.contains("recording")).toBe(true);
    expect(recordBtn.textContent).toContain("Stop");
  });

  it("record button stops recording on second click", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true });
    await import("../panel/panel.js");
    const recordBtn = document.getElementById("record-btn");

    recordBtn.click();
    await vi.waitFor(() => {
      expect(recordBtn.classList.contains("recording")).toBe(true);
    });

    recordBtn.click();
    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "pw-record-stop",
        tabId: 42,
      });
    });
    expect(recordBtn.classList.contains("recording")).toBe(false);
    expect(recordBtn.textContent).toContain("Record");
  });

  it("record button reverts on failure", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: false, error: "Failed" });
    await import("../panel/panel.js");
    const recordBtn = document.getElementById("record-btn");

    recordBtn.click();
    await vi.waitFor(() => {
      expect(recordBtn.classList.contains("recording")).toBe(false);
      expect(recordBtn.textContent).toContain("Record");
    });
    expect(document.getElementById("output").textContent).toContain("Failed to start recording");
  });

  it("recorded commands append to editor", async () => {
    await import("../panel/panel.js");
    const onMessageCallback = mockPort.onMessage.addListener.mock.calls[0][0];
    onMessageCallback({ type: "pw-recorded-command", command: 'click "Submit"' });
    const editor = document.getElementById("editor");
    expect(editor.value).toContain('click "Submit"');
    // Editor content enables copy/save
    expect(document.getElementById("copy-btn").disabled).toBe(false);
  });

  // --- Run button ---

  it("run button executes editor lines", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com\nclick \"OK\"";
    editor.dispatchEvent(new Event("input"));

    document.getElementById("run-btn").click();
    await vi.waitFor(() => {
      const output = document.getElementById("output");
      expect(output.textContent).toContain("Running script...");
      expect(output.textContent).toContain("Run complete.");
    });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "pw-command",
      raw: "goto https://example.com",
      tabId: 42,
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "pw-command",
      raw: 'click "OK"',
      tabId: 42,
    });
  });

  it("run button shows pass/fail stats", async () => {
    let callCount = 0;
    chrome.runtime.sendMessage.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ type: "success", data: "OK" });
      return Promise.resolve({ type: "error", data: "Not found" });
    });
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com\nclick \"Missing\"";
    editor.dispatchEvent(new Event("input"));

    document.getElementById("run-btn").click();
    await vi.waitFor(() => {
      const stats = document.getElementById("console-stats");
      expect(stats.textContent).toContain("1 passed");
      expect(stats.textContent).toContain("1 failed");
    });
  });

  it("run button shows message for empty editor", async () => {
    await import("../panel/panel.js");
    document.getElementById("run-btn").click();
    const output = document.getElementById("output");
    expect(output.textContent).toContain("Editor is empty");
  });

  it("run button skips empty lines and comments", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "# comment\n\ngoto https://example.com";
    editor.dispatchEvent(new Event("input"));

    document.getElementById("run-btn").click();
    await vi.waitFor(() => {
      expect(document.getElementById("output").textContent).toContain("Run complete.");
    });
    // Only goto should be sent as pw-command, comment is displayed locally
    const pwCalls = chrome.runtime.sendMessage.mock.calls.filter(
      (c) => c[0].type === "pw-command"
    );
    expect(pwCalls.length).toBe(1);
    expect(pwCalls[0][0].raw).toBe("goto https://example.com");
  });

  // --- Ctrl+Enter ---

  it("Ctrl+Enter in editor triggers run", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com";
    editor.dispatchEvent(new Event("input"));

    editor.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
    }));

    await vi.waitFor(() => {
      expect(document.getElementById("output").textContent).toContain("Running script...");
    });
  });

  // --- Console commands (history, clear, reset) ---

  it("history command displays history in terminal", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");

    // Execute some commands to build history
    input.value = "help";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.value = "snapshot";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    });

    // Now run the history command
    input.value = "history";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const output = document.getElementById("output");
    expect(output.textContent).toContain("help");
    expect(output.textContent).toContain("snapshot");
    // Should NOT append to editor
    expect(document.getElementById("editor").value).toBe("");
  });

  it("history command shows info when history is empty", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");

    input.value = "history";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(document.getElementById("output").textContent).toContain("No command history");
  });

  it("history command is not added to history itself", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");

    input.value = "help";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    input.value = "history";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    // ArrowUp should show "help", not "history"
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(input.value).toBe("help");
  });

  it("history command is not sent to background", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");

    input.value = "history";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("clear command clears console output", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "Done" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");

    input.value = "help";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      expect(document.getElementById("output").textContent).toContain("Done");
    });

    input.value = "clear";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(document.getElementById("output").innerHTML).toBe("");
  });

  it("clear command is not sent to background", async () => {
    await import("../panel/panel.js");
    chrome.runtime.sendMessage.mockClear();
    const input = document.getElementById("command-input");

    input.value = "clear";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("clear command is not added to history", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");

    input.value = "help";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    input.value = "clear";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(input.value).toBe("help");
  });

  it("reset command clears history and console", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "Done" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");

    // Build up some history
    input.value = "help";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      expect(document.getElementById("output").textContent).toContain("Done");
    });

    input.value = "reset";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(document.getElementById("output").textContent).toContain("History and terminal cleared");

    // History should be empty — ArrowUp should do nothing
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(input.value).toBe("");
  });

  it("reset command is not added to history", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");

    input.value = "help";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    input.value = "reset";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    // After reset, history should be empty
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(input.value).toBe("");
  });

  // --- Console header clear button ---

  it("console header clear button clears output", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "Done" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "help";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      expect(document.getElementById("output").textContent).toContain("Done");
    });

    document.getElementById("console-clear-btn").click();
    expect(document.getElementById("output").innerHTML).toBe("");
  });

  it("console header clear button resets pass/fail stats", async () => {
    let callCount = 0;
    chrome.runtime.sendMessage.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ type: "success", data: "OK" });
      return Promise.resolve({ type: "error", data: "Not found" });
    });
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com\nclick \"Missing\"";
    editor.dispatchEvent(new Event("input"));

    document.getElementById("run-btn").click();
    await vi.waitFor(() => {
      const stats = document.getElementById("console-stats");
      expect(stats.textContent).toContain("1 passed");
    });

    document.getElementById("console-clear-btn").click();
    expect(document.getElementById("console-stats").textContent).toBe("");
  });

  // --- Step button ---

  it("step button executes the first executable line", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com\nclick \"OK\"";
    editor.dispatchEvent(new Event("input"));

    document.getElementById("step-btn").click();
    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "pw-command",
        raw: "goto https://example.com",
        tabId: 42,
      });
    });
  });

  it("step button skips empty lines and comments", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "# comment\n\ngoto https://example.com";
    editor.dispatchEvent(new Event("input"));

    document.getElementById("step-btn").click();
    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "pw-command",
        raw: "goto https://example.com",
        tabId: 42,
      });
    });
  });

  it("step button advances to next line on subsequent clicks", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com\nclick \"OK\"";
    editor.dispatchEvent(new Event("input"));

    document.getElementById("step-btn").click();
    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "pw-command",
        raw: "goto https://example.com",
        tabId: 42,
      });
    });

    // Wait for step button to be re-enabled (async handler complete)
    await vi.waitFor(() => {
      expect(document.getElementById("step-btn").disabled).toBe(false);
    });

    chrome.runtime.sendMessage.mockClear();
    document.getElementById("step-btn").click();
    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "pw-command",
        raw: 'click "OK"',
        tabId: 42,
      });
    });
  });

  it("step button shows message for empty editor", async () => {
    await import("../panel/panel.js");
    document.getElementById("step-btn").click();
    expect(document.getElementById("output").textContent).toContain("Editor is empty");
  });

  it("step button shows complete message after last line", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com";
    editor.dispatchEvent(new Event("input"));

    document.getElementById("step-btn").click();
    await vi.waitFor(() => {
      expect(document.getElementById("output").textContent).toContain("Step complete");
    });
  });

  it("step state resets when editor content changes", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const editor = document.getElementById("editor");
    editor.value = "goto https://example.com\nclick \"OK\"";
    editor.dispatchEvent(new Event("input"));

    document.getElementById("step-btn").click();
    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "pw-command",
        raw: "goto https://example.com",
        tabId: 42,
      });
    });

    // Wait for step button to be re-enabled
    await vi.waitFor(() => {
      expect(document.getElementById("step-btn").disabled).toBe(false);
    });

    // Edit the content — step state should reset
    editor.value = "goto https://other.com";
    editor.dispatchEvent(new Event("input"));

    // Next step should start from line 0 again
    chrome.runtime.sendMessage.mockClear();
    document.getElementById("step-btn").click();
    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "pw-command",
        raw: "goto https://other.com",
        tabId: 42,
      });
    });
  });

  // --- Autocomplete ---

  it("ghost text shows completion hint while typing", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const ghost = document.getElementById("ghost-text");

    input.value = "go";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(ghost.textContent).toBe("to");
  });

  it("ghost text shows hint for screenshot", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const ghost = document.getElementById("ghost-text");

    input.value = "scr";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(ghost.textContent).toBe("eenshot");
  });

  it("ghost text clears when full command is typed", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const ghost = document.getElementById("ghost-text");

    input.value = "goto";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(ghost.textContent).toBe("");
  });

  it("ghost text clears when space is typed after command", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const ghost = document.getElementById("ghost-text");

    input.value = "goto ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(ghost.textContent).toBe("");
  });

  it("ghost text clears on empty input", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const ghost = document.getElementById("ghost-text");

    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(ghost.textContent).toBe("");
  });

  it("Tab completes single matching command", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");

    input.value = "scr";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(input.value).toBe("screenshot ");
  });

  it("dropdown shows for multiple matches", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const dd = document.getElementById("autocomplete-dropdown");

    input.value = "go";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(dd.hidden).toBe(false);
    expect(dd.querySelectorAll(".autocomplete-item").length).toBeGreaterThan(1);
  });

  it("Tab selects first dropdown item when dropdown is open", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const dd = document.getElementById("autocomplete-dropdown");

    input.value = "go";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(dd.hidden).toBe(false);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(input.value.startsWith("go")).toBe(true);
    expect(input.value.endsWith(" ")).toBe(true);
    expect(dd.hidden).toBe(true);
  });

  it("ArrowDown navigates dropdown items", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const dd = document.getElementById("autocomplete-dropdown");

    input.value = "go";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(dd.hidden).toBe(false);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const items = dd.querySelectorAll(".autocomplete-item");
    expect(items[0].classList.contains("active")).toBe(true);
  });

  it("Enter selects highlighted dropdown item", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const dd = document.getElementById("autocomplete-dropdown");

    input.value = "go";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Navigate to first item
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    // Select it
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(input.value.startsWith("go")).toBe(true);
    expect(input.value.endsWith(" ")).toBe(true);
    expect(dd.hidden).toBe(true);
  });

  it("Escape closes dropdown", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const dd = document.getElementById("autocomplete-dropdown");

    input.value = "go";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(dd.hidden).toBe(false);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(dd.hidden).toBe(true);
  });

  it("dropdown hides when single match remains", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const dd = document.getElementById("autocomplete-dropdown");

    input.value = "scr";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(dd.hidden).toBe(true);
  });

  it("clicking dropdown item selects it", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const dd = document.getElementById("autocomplete-dropdown");

    input.value = "go";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(dd.hidden).toBe(false);

    const firstItem = dd.querySelector(".autocomplete-item");
    firstItem.dispatchEvent(new Event("mousedown", { bubbles: true }));
    expect(input.value.endsWith(" ")).toBe(true);
    expect(dd.hidden).toBe(true);
  });

  it("Enter clears ghost text", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const ghost = document.getElementById("ghost-text");

    input.value = "go";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(ghost.textContent).not.toBe("");

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(ghost.textContent).toBe("");
  });

  it("ArrowUp clears ghost text when no dropdown", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const ghost = document.getElementById("ghost-text");

    input.value = "scr";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(ghost.textContent).not.toBe("");

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(ghost.textContent).toBe("");
  });

  it("ArrowDown clears ghost text when no dropdown", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    const ghost = document.getElementById("ghost-text");

    input.value = "scr";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(ghost.textContent).not.toBe("");

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(ghost.textContent).toBe("");
  });
});
