import { pwToPlaywright } from "../lib/converter.js";

const output = document.getElementById("output");
const input = document.getElementById("command-input");
const recordBtn = document.getElementById("record-btn");
const loadBtn = document.getElementById("load-btn");
const playBtn = document.getElementById("play-btn");
const copyBtn = document.getElementById("copy-btn");
const saveBtn = document.getElementById("save-btn");
const clearBtn = document.getElementById("clear-btn");

// The tab we're inspecting
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

// Command history
const history = [];
let historyIndex = -1;

// All executed commands (for copy/save)
const commandLog = [];

function logCommand(cmd) {
  commandLog.push(cmd);
  copyBtn.disabled = false;
  saveBtn.disabled = false;
}

// Loaded commands for replay
let loadedCommands = [];
let isPlaying = false;

// --- Output helpers ---

function addLine(text, className) {
  const div = document.createElement("div");
  div.className = `line ${className}`;
  div.textContent = text;
  output.appendChild(div);
  output.scrollTop = output.scrollHeight;
}

function addCommand(text) {
  addLine(text, "line-command");
}

function addSuccess(text) {
  addLine(text, "line-success");
}

function addError(text) {
  addLine(text, "line-error");
}

function addInfo(text) {
  addLine(text, "line-info");
}

function addSnapshot(text) {
  addLine(text, "line-snapshot");
}

function addScreenshot(base64) {
  const div = document.createElement("div");
  div.className = "line line-screenshot";
  const img = document.createElement("img");
  img.src = "data:image/png;base64," + base64;
  div.appendChild(img);
  output.appendChild(div);
  output.scrollTop = output.scrollHeight;
}

function addComment(text) {
  addLine(text, "line-comment");
}

// --- Clipboard helper (navigator.clipboard blocked in DevTools panels) ---

function copyToClipboard(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
    return true;
  } catch (e) {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

// --- Export session ---

function exportSession() {
  if (commandLog.length === 0) {
    addInfo("Nothing to export.");
    return;
  }
  const lines = [
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test('recorded session', async ({ page }) => {`,
  ];
  for (const cmd of commandLog) {
    if (cmd.startsWith("#")) {
      lines.push(`  ${cmd.replace("#", "//")}`);
      continue;
    }
    const converted = pwToPlaywright(cmd);
    if (converted) {
      lines.push(`  ${converted}`);
    }
  }
  lines.push(`});`);

  const code = lines.join("\n");
  addInfo("--- Playwright TypeScript ---");
  for (const line of code.split("\n")) {
    addLine(line, "line-snapshot");
  }
  addInfo("--- End ---");

  // Try to copy to clipboard (may be blocked in DevTools panels)
  if (copyToClipboard(code)) {
    addSuccess("Copied to clipboard.");
  } else {
    addInfo("Use Save button to export as file.");
  }
}

// --- Command execution via background service worker ---

async function executeCommand(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return;

  // Skip comments
  if (trimmed.startsWith("#")) {
    addComment(trimmed);
    return;
  }

  // Handle export command locally (no CDP needed)
  if (trimmed === "export") {
    exportSession();
    return;
  }
  if (trimmed.startsWith("export ")) {
    const subCmd = trimmed.slice(7).trim();
    const converted = pwToPlaywright(subCmd);
    if (converted) {
      addCommand(trimmed);
      addLine(converted, "line-snapshot");
    } else {
      addError("Cannot convert: " + subCmd);
    }
    return;
  }

  logCommand(trimmed);
  addCommand(trimmed);

  try {
    const result = await chrome.runtime.sendMessage({
      type: "pw-command",
      raw: trimmed,
      tabId: inspectedTabId,
    });

    if (!result) {
      addError("No response from background worker.");
      return;
    }

    switch (result.type) {
      case "success":
        addSuccess(result.data);
        break;
      case "error":
        addError(result.data);
        break;
      case "info":
        addInfo(result.data);
        break;
      case "snapshot":
        for (const line of result.data.split("\n")) {
          addSnapshot(line);
        }
        break;
      case "screenshot":
        addScreenshot(result.data);
        break;
      default:
        addInfo(result.data || "Done.");
    }
  } catch (e) {
    addError(`Error: ${e.message}`);
  }
}

// --- Input handling ---

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const value = input.value;
    if (value.trim()) {
      history.push(value);
      historyIndex = history.length;
      executeCommand(value);
    }
    input.value = "";
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      input.value = history[historyIndex];
    }
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (historyIndex < history.length - 1) {
      historyIndex++;
      input.value = history[historyIndex];
    } else {
      historyIndex = history.length;
      input.value = "";
    }
  }
});

// --- Toolbar ---

clearBtn.addEventListener("click", () => {
  output.innerHTML = "";
  commandLog.length = 0;
  copyBtn.disabled = true;
  saveBtn.disabled = true;
});

copyBtn.addEventListener("click", () => {
  if (commandLog.length === 0) {
    addInfo("Nothing to copy.");
    return;
  }
  const text = commandLog.join("\n");
  if (copyToClipboard(text)) {
    addSuccess("Commands copied to clipboard.");
  } else {
    addError("Failed to copy to clipboard.");
  }
});

saveBtn.addEventListener("click", () => {
  if (commandLog.length === 0) {
    addInfo("Nothing to save.");
    return;
  }
  const defaultName = "commands-" + new Date().toISOString().slice(0, 10) + ".pw";
  const filename = prompt("Save as:", defaultName);
  if (!filename) return;
  const text = commandLog.join("\n") + "\n";
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".pw") ? filename : filename + ".pw";
  a.click();
  URL.revokeObjectURL(url);
  addSuccess("Saved as " + a.download);
});

loadBtn.addEventListener("click", () => {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".pw,.txt";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = reader.result.split("\n").filter((l) => l.trim());
      loadedCommands = lines;
      const commands = lines.filter((l) => !l.trim().startsWith("#"));
      addInfo(`Loaded ${commands.length} commands from ${file.name}:`);
      for (const line of lines) {
        if (line.trim().startsWith("#")) {
          addComment(line);
        } else {
          addLine(line, "line-info");
        }
      }
      playBtn.disabled = false;
    };
    reader.readAsText(file);
  });
  fileInput.click();
});

playBtn.addEventListener("click", async () => {
  if (isPlaying) {
    // Stop replay
    isPlaying = false;
    playBtn.textContent = "Play";
    addInfo("Replay stopped.");
    return;
  }

  if (loadedCommands.length === 0) {
    addInfo("No commands to play. Load a .pw file first.");
    return;
  }

  isPlaying = true;
  playBtn.textContent = "Stop";
  addInfo("Replaying commands...");

  for (const line of loadedCommands) {
    if (!isPlaying) break;
    await executeCommand(line);
    // Small delay between commands for stability
    if (isPlaying) await new Promise((r) => setTimeout(r, 300));
  }

  isPlaying = false;
  playBtn.textContent = "Play";
  if (loadedCommands.length > 0) {
    addInfo("Replay complete.");
  }
});

recordBtn.addEventListener("click", async () => {
  recordBtn.classList.toggle("recording");
  const isRecording = recordBtn.classList.contains("recording");
  recordBtn.textContent = isRecording ? "\u23F9 Stop" : "\u23FA Record";

  if (isRecording) {
    try {
      const result = await chrome.runtime.sendMessage({
        type: "pw-record-start",
        tabId: inspectedTabId,
      });
      if (result?.success) {
        addInfo("Recording started. Interact with the page...");
      } else {
        addError("Failed to start recording: " + (result?.error || "unknown"));
        recordBtn.classList.remove("recording");
        recordBtn.textContent = "\u23FA Record";
      }
    } catch (e) {
      addError("Record error: " + e.message);
      recordBtn.classList.remove("recording");
      recordBtn.textContent = "\u23FA Record";
    }
  } else {
    await chrome.runtime.sendMessage({
      type: "pw-record-stop",
      tabId: inspectedTabId,
    });
    addInfo("Recording stopped.");
  }
});

// Persistent port connection for receiving recorded commands
const port = chrome.runtime.connect({ name: `pw-panel-${inspectedTabId}` });
port.onMessage.addListener((message) => {
  if (message.type === "pw-recorded-command") {
    const cmd = message.command;
    logCommand(cmd);
    addLine(cmd, "line-command");
  }
});

// Focus input on panel load
input.focus();

// Welcome message
addInfo("Playwright REPL v0.5");
addInfo('Type "help" for available commands.');
