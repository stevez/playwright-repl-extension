import { pwToPlaywright } from "../lib/converter.js";

// --- DOM references ---

const output = document.getElementById("output");
const input = document.getElementById("command-input");
const editor = document.getElementById("editor");
const lineNumbers = document.getElementById("line-numbers");
const editorPane = document.getElementById("editor-pane");
const splitter = document.getElementById("splitter");
const consoleStats = document.getElementById("console-stats");
const fileInfo = document.getElementById("file-info");
const runBtn = document.getElementById("run-btn");
const openBtn = document.getElementById("open-btn");
const saveBtn = document.getElementById("save-btn");
const exportBtn = document.getElementById("export-btn");
const recordBtn = document.getElementById("record-btn");
const copyBtn = document.getElementById("copy-btn");
const stepBtn = document.getElementById("step-btn");
const consoleClearBtn = document.getElementById("console-clear-btn");
const lineHighlight = document.getElementById("line-highlight");
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxSaveBtn = document.getElementById("lightbox-save-btn");
const lightboxCloseBtn = document.getElementById("lightbox-close-btn");
const ghostText = document.getElementById("ghost-text");
const dropdown = document.getElementById("autocomplete-dropdown");

// The tab we're inspecting
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

// --- Theme detection ---
const themeName = chrome.devtools?.panels?.themeName;
if (themeName === "dark") {
  document.body.classList.add("theme-dark");
}

// --- State ---

// Command history (for REPL input up/down)
const history = [];
let historyIndex = -1;

// Run state
let isRunning = false;
let currentRunLine = -1;
let runPassCount = 0;
let runFailCount = 0;
let lineResults = []; // "pass" | "fail" | null per line

// Step state
let stepLine = -1; // Next line to execute when stepping, -1 = not stepping

// File state
let currentFilename = "";

// Commands handled locally (not added to history, not sent to background)
const LOCAL_COMMANDS = new Set(["history", "clear", "reset"]);

// All commands for autocomplete
const COMMANDS = [
  "goto", "open", "click", "dblclick", "fill", "select",
  "check", "uncheck", "hover", "press", "snapshot",
  "screenshot", "eval", "go-back", "back", "go-forward", "forward",
  "reload", "verify-text", "verify-no-text", "verify-element",
  "verify-no-element", "verify-url", "verify-title",
  "export", "help", "history", "clear", "reset"
];

// --- Autocomplete ---

function updateGhostText() {
  const val = input.value.toLowerCase();
  if (!val || val.includes(" ")) {
    ghostText.textContent = "";
    return;
  }
  const match = COMMANDS.find(cmd => cmd.startsWith(val) && cmd !== val);
  if (match) {
    ghostText.style.paddingLeft = val.length + "ch";
    ghostText.textContent = match.slice(val.length);
  } else {
    ghostText.textContent = "";
  }
}

function clearGhostText() {
  ghostText.textContent = "";
}

let dropdownItems = [];
let dropdownIndex = -1;

function showDropdown(matches) {
  dropdown.innerHTML = "";
  dropdownItems = matches;
  dropdownIndex = -1;
  for (let i = 0; i < matches.length; i++) {
    const div = document.createElement("div");
    div.className = "autocomplete-item";
    div.textContent = matches[i];
    div.addEventListener("mousedown", (e) => {
      e.preventDefault();
      input.value = matches[i] + " ";
      hideDropdown();
      clearGhostText();
      input.focus();
    });
    dropdown.appendChild(div);
  }
  dropdown.hidden = false;
}

function hideDropdown() {
  dropdown.hidden = true;
  dropdown.innerHTML = "";
  dropdownItems = [];
  dropdownIndex = -1;
}

function updateDropdownHighlight() {
  const items = dropdown.querySelectorAll(".autocomplete-item");
  items.forEach((el, i) => {
    el.classList.toggle("active", i === dropdownIndex);
  });
}

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
  const dataUrl = "data:image/png;base64," + base64;

  const wrapper = document.createElement("div");
  wrapper.className = "screenshot-block";

  const img = document.createElement("img");
  img.src = dataUrl;
  img.addEventListener("click", () => {
    lightboxImg.src = dataUrl;
    lightbox.hidden = false;
  });
  wrapper.appendChild(img);

  const zoomHint = document.createElement("span");
  zoomHint.className = "screenshot-zoom-hint";
  zoomHint.textContent = "Click to enlarge";
  wrapper.appendChild(zoomHint);

  const actions = document.createElement("div");
  actions.className = "screenshot-actions";

  const saveBtnEl = document.createElement("button");
  saveBtnEl.className = "screenshot-btn";
  saveBtnEl.textContent = "Save";
  saveBtnEl.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "screenshot-" + new Date().toISOString().slice(0, 19).replace(/:/g, "-") + ".png";
    a.click();
  });
  actions.appendChild(saveBtnEl);

  wrapper.appendChild(actions);

  output.appendChild(wrapper);
  output.scrollTop = output.scrollHeight;
}

function addComment(text) {
  addLine(text, "line-comment");
}

function addCodeBlock(code) {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block";

  const copyBtn = document.createElement("button");
  copyBtn.className = "code-copy-btn";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", () => {
    if (copyToClipboard(code)) {
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
    }
  });
  wrapper.appendChild(copyBtn);

  const pre = document.createElement("pre");
  pre.className = "code-content";
  pre.textContent = code;
  wrapper.appendChild(pre);

  output.appendChild(wrapper);
  output.scrollTop = output.scrollHeight;
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

// --- Editor helpers ---

function updateLineNumbers() {
  const lines = editor.value.split("\n");
  let html = "";
  for (let i = 0; i < lines.length; i++) {
    let cls = "";
    if (i === currentRunLine) {
      cls = "line-active";
    } else if (lineResults[i] === "pass") {
      cls = "line-pass";
    } else if (lineResults[i] === "fail") {
      cls = "line-fail";
    }
    html += `<div class="${cls}">${i + 1}</div>`;
  }
  lineNumbers.innerHTML = html;
  updateLineHighlight();
}

function updateLineHighlight() {
  if (currentRunLine >= 0) {
    // 8px padding + line index * 18px line-height, offset by scroll
    lineHighlight.style.top = (8 + currentRunLine * 18 - editor.scrollTop) + "px";
    lineHighlight.style.display = "block";
  } else {
    lineHighlight.style.display = "none";
  }
}

function syncScroll() {
  lineNumbers.scrollTop = editor.scrollTop;
  updateLineHighlight();
}

function updateFileInfo() {
  const lines = editor.value.split("\n");
  const count = lines.length;
  const name = currentFilename || "untitled.pw";
  fileInfo.textContent = `${name} \u2014 ${count} line${count !== 1 ? "s" : ""}`;
}

function updateButtonStates() {
  const hasContent = editor.value.trim().length > 0;
  copyBtn.disabled = !hasContent;
  saveBtn.disabled = !hasContent;
  exportBtn.disabled = !hasContent;
}

function appendToEditor(text) {
  const current = editor.value;
  if (current && !current.endsWith("\n")) {
    editor.value += "\n";
  }
  editor.value += text;
  updateLineNumbers();
  updateFileInfo();
  updateButtonStates();
  editor.scrollTop = editor.scrollHeight;
}

function clearConsole() {
  output.innerHTML = "";
  runPassCount = 0;
  runFailCount = 0;
  updateConsoleStats();
}

function findNextExecutableLine(startFrom, lines) {
  for (let i = startFrom; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith("#")) return i;
  }
  return -1;
}

function updateConsoleStats() {
  if (runPassCount === 0 && runFailCount === 0) {
    consoleStats.textContent = "";
    return;
  }
  consoleStats.innerHTML =
    `<span class="pass-count">${runPassCount} passed</span> / ` +
    `<span class="fail-count">${runFailCount} failed</span>`;
}

// Editor input/scroll listeners
editor.addEventListener("input", () => {
  // Reset execution state when editor content changes
  stepLine = -1;
  currentRunLine = -1;
  lineResults = [];
  updateLineNumbers();
  updateFileInfo();
  updateButtonStates();
});
editor.addEventListener("scroll", syncScroll);

// --- Export helper ---

function exportFromLines(cmds) {
  const lines = [
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test('recorded session', async ({ page }) => {`,
  ];
  for (const cmd of cmds) {
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
  addCodeBlock(code);
}

// --- Command execution (REPL ad-hoc) ---

async function executeCommand(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return;

  // Skip comments
  if (trimmed.startsWith("#")) {
    addComment(trimmed);
    return;
  }

  // Handle local console commands (no background needed, not added to history)
  if (trimmed === "history") {
    if (history.length === 0) {
      addInfo("No command history.");
    } else {
      for (const cmd of history) {
        addInfo(cmd);
      }
    }
    return;
  }

  if (trimmed === "clear") {
    clearConsole();
    return;
  }

  if (trimmed === "reset") {
    history.length = 0;
    historyIndex = -1;
    clearConsole();
    addInfo("History and terminal cleared.");
    return;
  }

  // Handle export command locally (no CDP needed)
  if (trimmed === "export") {
    const editorLines = editor.value.split("\n").filter((l) => l.trim());
    if (editorLines.length === 0) {
      addInfo("Nothing to export. Add commands to the editor first.");
    } else {
      exportFromLines(editorLines);
    }
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

// --- Command execution for Run (with pass/fail tracking) ---

async function executeCommandForRun(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return;

  // Handle comments
  if (trimmed.startsWith("#")) {
    addComment(trimmed);
    return;
  }

  addCommand(trimmed);

  try {
    const result = await chrome.runtime.sendMessage({
      type: "pw-command",
      raw: trimmed,
      tabId: inspectedTabId,
    });

    if (!result) {
      addError("No response from background worker.");
      lineResults[currentRunLine] = "fail";
      runFailCount++;
      updateConsoleStats();
      updateLineNumbers();
      return;
    }

    switch (result.type) {
      case "success":
        addSuccess(result.data);
        lineResults[currentRunLine] = "pass";
        runPassCount++;
        break;
      case "error":
        addError(result.data);
        lineResults[currentRunLine] = "fail";
        runFailCount++;
        break;
      case "info":
        addInfo(result.data);
        lineResults[currentRunLine] = "pass";
        runPassCount++;
        break;
      case "snapshot":
        for (const line of result.data.split("\n")) {
          addSnapshot(line);
        }
        lineResults[currentRunLine] = "pass";
        runPassCount++;
        break;
      case "screenshot":
        addScreenshot(result.data);
        lineResults[currentRunLine] = "pass";
        runPassCount++;
        break;
      default:
        addInfo(result.data || "Done.");
        lineResults[currentRunLine] = "pass";
        runPassCount++;
    }
  } catch (e) {
    addError(`Error: ${e.message}`);
    lineResults[currentRunLine] = "fail";
    runFailCount++;
  }
  updateConsoleStats();
  updateLineNumbers();
}

// --- REPL input handling ---

function selectDropdownItem(cmd) {
  input.value = cmd + " ";
  hideDropdown();
  clearGhostText();
}

input.addEventListener("keydown", (e) => {
  // When dropdown is visible, arrow keys navigate it
  if (!dropdown.hidden && dropdownItems.length > 0) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      dropdownIndex = (dropdownIndex + 1) % dropdownItems.length;
      updateDropdownHighlight();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      dropdownIndex = dropdownIndex <= 0 ? dropdownItems.length - 1 : dropdownIndex - 1;
      updateDropdownHighlight();
      return;
    }
    if (e.key === "Enter" && dropdownIndex >= 0) {
      e.preventDefault();
      selectDropdownItem(dropdownItems[dropdownIndex]);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (dropdownIndex >= 0) {
        selectDropdownItem(dropdownItems[dropdownIndex]);
      } else if (dropdownItems.length > 0) {
        selectDropdownItem(dropdownItems[0]);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      hideDropdown();
      clearGhostText();
      return;
    }
  }

  if (e.key === "Enter") {
    const value = input.value;
    if (value.trim()) {
      const cmd = value.trim().toLowerCase();
      if (!LOCAL_COMMANDS.has(cmd)) {
        history.push(value);
        historyIndex = history.length;
      }
      executeCommand(value);
    }
    input.value = "";
    hideDropdown();
    clearGhostText();
  } else if (e.key === "Tab") {
    e.preventDefault();
    const val = input.value.toLowerCase().trim();
    if (val.includes(" ")) return;
    if (!val) {
      showDropdown(COMMANDS);
      return;
    }
    const matches = COMMANDS.filter(cmd => cmd.startsWith(val) && cmd !== val);
    if (matches.length === 1) {
      selectDropdownItem(matches[0]);
    } else if (matches.length > 1) {
      showDropdown(matches);
    }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      input.value = history[historyIndex];
    }
    hideDropdown();
    clearGhostText();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (historyIndex < history.length - 1) {
      historyIndex++;
      input.value = history[historyIndex];
    } else {
      historyIndex = history.length;
      input.value = "";
    }
    hideDropdown();
    clearGhostText();
  } else if (e.key === "Escape") {
    hideDropdown();
    clearGhostText();
  } else if (e.key === " " && e.ctrlKey) {
    e.preventDefault();
    const val = input.value.toLowerCase().trim();
    if (val.includes(" ")) return;
    const matches = val
      ? COMMANDS.filter(cmd => cmd.startsWith(val) && cmd !== val)
      : COMMANDS;
    if (matches.length > 0) showDropdown(matches);
  }
});

input.addEventListener("input", () => {
  updateGhostText();
  // Auto-show dropdown while typing
  const val = input.value.toLowerCase().trim();
  if (!val || val.includes(" ")) {
    hideDropdown();
    return;
  }
  const matches = COMMANDS.filter(cmd => cmd.startsWith(val) && cmd !== val);
  if (matches.length > 1) {
    showDropdown(matches);
  } else {
    hideDropdown();
  }
});

// --- Editor keyboard shortcut ---

editor.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    runBtn.click();
  }
});

// --- Run button ---

runBtn.addEventListener("click", async () => {
  if (isRunning) {
    isRunning = false;
    runBtn.textContent = "\u25B6";
    addInfo("Run stopped.");
    currentRunLine = -1;
    updateLineNumbers();
    return;
  }

  const content = editor.value;
  if (!content.trim()) {
    addInfo("Editor is empty. Open a .pw file or type commands.");
    return;
  }

  const lines = content.split("\n");
  const startLine = stepLine > 0 ? stepLine : 0;

  isRunning = true;
  stepBtn.disabled = true;
  runBtn.textContent = "\u25A0";

  // Only reset stats if starting fresh (not continuing from step)
  if (startLine === 0) {
    runPassCount = 0;
    runFailCount = 0;
    lineResults = new Array(lines.length).fill(null);
    updateConsoleStats();
  }

  addInfo(startLine > 0 ? "Continuing run from step..." : "Running script...");

  for (let i = startLine; i < lines.length; i++) {
    if (!isRunning) break;
    const line = lines[i].trim();

    // Skip empty lines and comments (comments shown but not counted)
    if (!line) continue;

    currentRunLine = i;
    updateLineNumbers();

    await executeCommandForRun(line);

    if (isRunning) await new Promise((r) => setTimeout(r, 300));
  }

  isRunning = false;
  stepBtn.disabled = false;
  runBtn.textContent = "\u25B6";
  currentRunLine = -1;
  stepLine = -1;
  updateLineNumbers();
  addInfo("Run complete.");
});

// --- Step button ---

stepBtn.addEventListener("click", async () => {
  if (isRunning) return;

  const content = editor.value;
  if (!content.trim()) {
    addInfo("Editor is empty. Open a .pw file or type commands.");
    return;
  }

  const lines = content.split("\n");

  // Initialize step state on first click
  if (stepLine === -1) {
    stepLine = 0;
    lineResults = new Array(lines.length).fill(null);
    runPassCount = 0;
    runFailCount = 0;
    updateConsoleStats();
  }

  // Find next executable line from current step position
  const nextLine = findNextExecutableLine(stepLine, lines);

  if (nextLine === -1) {
    addInfo("Step complete. No more lines to execute.");
    stepLine = -1;
    currentRunLine = -1;
    updateLineNumbers();
    return;
  }

  // Execute the line
  stepBtn.disabled = true;
  currentRunLine = nextLine;
  updateLineNumbers();

  await executeCommandForRun(lines[nextLine]);

  stepLine = nextLine + 1;
  currentRunLine = nextLine; // Keep highlight on last stepped line
  updateLineNumbers();
  stepBtn.disabled = false;

  // Check if there are more executable lines
  if (findNextExecutableLine(stepLine, lines) === -1) {
    addInfo("Step complete. All lines executed.");
    stepLine = -1;
    currentRunLine = -1;
    updateLineNumbers();
  }
});

// --- Open button ---

openBtn.addEventListener("click", () => {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".pw,.txt";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      editor.value = reader.result;
      currentFilename = file.name;
      lineResults = [];
      updateLineNumbers();
      updateFileInfo();
      updateButtonStates();
      addInfo(`Opened ${file.name}`);
    };
    reader.readAsText(file);
  });
  fileInput.click();
});

// --- Save button ---

saveBtn.addEventListener("click", () => {
  const content = editor.value;
  if (!content.trim()) {
    addInfo("Nothing to save.");
    return;
  }
  const defaultName =
    currentFilename || "commands-" + new Date().toISOString().slice(0, 10) + ".pw";
  const filename = prompt("Save as:", defaultName);
  if (!filename) return;
  const finalName = filename.endsWith(".pw") ? filename : filename + ".pw";
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = finalName;
  a.click();
  URL.revokeObjectURL(url);
  currentFilename = finalName;
  updateFileInfo();
  addSuccess("Saved as " + finalName);
});

// --- Export button ---

exportBtn.addEventListener("click", () => {
  const content = editor.value;
  if (!content.trim()) {
    addInfo("Nothing to export.");
    return;
  }
  const editorLines = content.split("\n").filter((l) => l.trim());
  exportFromLines(editorLines);
});

// --- Copy button ---

copyBtn.addEventListener("click", () => {
  const content = editor.value;
  if (!content.trim()) {
    addInfo("Nothing to copy.");
    return;
  }
  if (copyToClipboard(content)) {
    addSuccess("Editor content copied to clipboard.");
  } else {
    addError("Failed to copy to clipboard.");
  }
});

// --- Console header clear button ---

consoleClearBtn.addEventListener("click", clearConsole);

// --- Record button ---

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

// --- Port connection for recorded commands ---
// Service workers in Manifest V3 can terminate and restart at any time.
// When that happens, the port disconnects and panelPorts is lost.
// We reconnect automatically so recording keeps working.

let port = null;

function connectPort() {
  // chrome.runtime.id is undefined when the extension context is invalidated
  // (e.g., after extension reload/update). Stop retrying in that case.
  if (!chrome.runtime?.id) return;
  try {
    port = chrome.runtime.connect({ name: `pw-panel-${inspectedTabId}` });
  } catch (e) {
    return;
  }
  port.onMessage.addListener((message) => {
    if (message.type === "pw-recorded-command") {
      appendToEditor(message.command);
    }
  });
  port.onDisconnect.addListener(() => {
    if (!chrome.runtime?.id) return;
    setTimeout(connectPort, 500);
  });
}

connectPort();

// --- Draggable splitter ---

let isDragging = false;
let dragStartY = 0;
let dragStartHeight = 0;

splitter.addEventListener("mousedown", (e) => {
  isDragging = true;
  dragStartY = e.clientY;
  dragStartHeight = editorPane.offsetHeight;
  document.body.style.cursor = "row-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const delta = e.clientY - dragStartY;
  const newHeight = dragStartY === 0 ? dragStartHeight : dragStartHeight + delta;
  const minEditor = 80;
  const bodyHeight = document.body.offsetHeight;
  const fixedHeight =
    document.getElementById("toolbar").offsetHeight +
    splitter.offsetHeight +
    document.getElementById("console-header").offsetHeight +
    document.getElementById("input-bar").offsetHeight;
  const maxEditor = bodyHeight - fixedHeight - 80;
  editorPane.style.flex = `0 0 ${Math.max(minEditor, Math.min(maxEditor, newHeight))}px`;
});

document.addEventListener("mouseup", () => {
  if (!isDragging) return;
  isDragging = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

// --- Lightbox ---

lightbox.addEventListener("click", (e) => {
  // Only close when clicking the backdrop, not the image or save button
  if (e.target === lightbox) {
    lightbox.hidden = true;
    lightboxImg.src = "";
  }
});

lightboxCloseBtn.addEventListener("click", () => {
  lightbox.hidden = true;
  lightboxImg.src = "";
});

lightboxSaveBtn.addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = lightboxImg.src;
  a.download = "screenshot-" + new Date().toISOString().slice(0, 19).replace(/:/g, "-") + ".png";
  a.click();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !lightbox.hidden) {
    e.stopPropagation();
    e.preventDefault();
    lightbox.hidden = true;
    lightboxImg.src = "";
  }
});

// --- Init ---

updateLineNumbers();
updateFileInfo();
updateButtonStates();
editor.focus();

addInfo("Playwright REPL v0.9.3");
addInfo('Type commands below or open a .pw file in the editor.');
