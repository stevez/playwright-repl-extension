import { describe, it, expect, vi, beforeEach } from "vitest";
import { chrome } from "vitest-chrome/lib/index.esm.js";

let mockPort;

describe("panel.js", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();

    // Set up the DOM that panel.js expects
    document.body.innerHTML = `
      <div id="output"></div>
      <div id="input-bar">
        <span id="prompt">pw&gt;</span>
        <input type="text" id="command-input" autocomplete="off" spellcheck="false">
        <button id="record-btn">&#9210; Record</button>
      </div>
      <div id="toolbar">
        <button id="load-btn">Load</button>
        <button id="play-btn" disabled>Play</button>
        <button id="copy-btn" disabled>Copy</button>
        <button id="save-btn" disabled>Save</button>
        <button id="clear-btn">Clear</button>
      </div>
    `;

    // Mock chrome.devtools.inspectedWindow.tabId
    chrome.devtools = {
      inspectedWindow: { tabId: 42 },
      panels: { create: vi.fn() },
    };

    // Mock chrome.runtime.connect to return a port-like object
    mockPort = {
      onMessage: { addListener: vi.fn() },
      postMessage: vi.fn(),
      onDisconnect: { addListener: vi.fn() },
      name: "pw-panel-42",
    };
    chrome.runtime.connect.mockReturnValue(mockPort);
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
  });

  it("renders welcome message on load", async () => {
    await import("../panel/panel.js");
    const output = document.getElementById("output");
    expect(output.textContent).toContain("Playwright REPL v0.5");
    expect(output.textContent).toContain("help");
  });

  it("connects to background via port", async () => {
    await import("../panel/panel.js");
    expect(chrome.runtime.connect).toHaveBeenCalledWith({
      name: "pw-panel-42",
    });
  });

  it("focuses the input on load", async () => {
    const input = document.getElementById("command-input");
    const focusSpy = vi.spyOn(input, "focus");
    await import("../panel/panel.js");
    expect(focusSpy).toHaveBeenCalled();
  });

  it("has disabled copy and save buttons initially", async () => {
    await import("../panel/panel.js");
    expect(document.getElementById("copy-btn").disabled).toBe(true);
    expect(document.getElementById("save-btn").disabled).toBe(true);
  });

  it("has enabled load and clear buttons", async () => {
    await import("../panel/panel.js");
    expect(document.getElementById("load-btn").disabled).toBe(false);
    expect(document.getElementById("clear-btn").disabled).toBe(false);
  });

  it("sends command to background on Enter key", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "help";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // Wait for async sendMessage
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

  it("clear button clears output and disables copy/save", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "Done" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    // Execute a command so copy/save become enabled
    input.value = "help";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      expect(document.getElementById("copy-btn").disabled).toBe(false);
    });

    // Click clear
    document.getElementById("clear-btn").click();
    const output = document.getElementById("output");
    expect(output.innerHTML).toBe("");
    expect(document.getElementById("copy-btn").disabled).toBe(true);
    expect(document.getElementById("save-btn").disabled).toBe(true);
  });

  it("enables copy and save after executing a command", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "goto https://example.com";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      expect(document.getElementById("copy-btn").disabled).toBe(false);
      expect(document.getElementById("save-btn").disabled).toBe(false);
    });
  });

  it("export command generates Playwright code", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");

    // Execute some commands first
    input.value = "goto https://example.com";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      expect(document.getElementById("output").textContent).toContain("OK");
    });

    // Run export
    input.value = "export";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      const output = document.getElementById("output");
      expect(output.textContent).toContain("Playwright TypeScript");
      expect(output.textContent).toContain("@playwright/test");
    });
  });

  it("export single command converts to Playwright", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = 'export click "Submit"';
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const output = document.getElementById("output");
    expect(output.textContent).toContain("click");
  });

  it("export with empty log shows nothing to export", async () => {
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");
    input.value = "export";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const output = document.getElementById("output");
    expect(output.textContent).toContain("Nothing to export");
  });

  it("record button toggles recording state", async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true });
    await import("../panel/panel.js");
    const recordBtn = document.getElementById("record-btn");

    // Click to start recording
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

    // Start recording
    recordBtn.click();
    await vi.waitFor(() => {
      expect(recordBtn.classList.contains("recording")).toBe(true);
    });

    // Stop recording
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

  it("port receives recorded commands and displays them", async () => {
    await import("../panel/panel.js");
    // Get the onMessage listener that was registered
    const onMessageCallback = mockPort.onMessage.addListener.mock.calls[0][0];
    onMessageCallback({ type: "pw-recorded-command", command: 'click "Submit"' });
    const output = document.getElementById("output");
    expect(output.textContent).toContain('click "Submit"');
    // Command should be logged, enabling copy/save
    expect(document.getElementById("copy-btn").disabled).toBe(false);
  });

  it("copy button copies commands to clipboard", async () => {
    // Mock execCommand for clipboard
    document.execCommand = vi.fn().mockReturnValue(true);

    chrome.runtime.sendMessage.mockResolvedValue({ type: "success", data: "OK" });
    await import("../panel/panel.js");
    const input = document.getElementById("command-input");

    input.value = "goto https://example.com";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      expect(document.getElementById("copy-btn").disabled).toBe(false);
    });

    document.getElementById("copy-btn").click();
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(document.getElementById("output").textContent).toContain("copied");
  });

  it("copy button shows message when nothing to copy", async () => {
    await import("../panel/panel.js");
    // Force enable the button to test the empty-log path
    document.getElementById("copy-btn").disabled = false;
    document.getElementById("copy-btn").click();
    expect(document.getElementById("output").textContent).toContain("Nothing to copy");
  });
});
