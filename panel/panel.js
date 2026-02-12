(() => {
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

  // --- Command execution via background service worker ---

  async function executeCommand(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return;

    // Skip comments
    if (trimmed.startsWith("#")) {
      addComment(trimmed);
      return;
    }

    commandLog.push(trimmed);
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
  });

  copyBtn.addEventListener("click", () => {
    if (commandLog.length === 0) {
      addInfo("Nothing to copy.");
      return;
    }
    const text = commandLog.join("\n");
    navigator.clipboard.writeText(text).then(() => {
      addSuccess("Commands copied to clipboard.");
    }).catch(() => {
      addError("Failed to copy to clipboard.");
    });
  });

  saveBtn.addEventListener("click", () => {
    if (commandLog.length === 0) {
      addInfo("Nothing to save.");
      return;
    }
    const text = commandLog.join("\n") + "\n";
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "commands.pw";
    a.click();
    URL.revokeObjectURL(url);
    addSuccess("Saved as commands.pw");
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
        const commands = lines.filter((l) => !l.trim().startsWith("#"));
        addInfo(`Loaded ${commands.length} commands from ${file.name}:`);
        for (const line of lines) {
          if (line.trim().startsWith("#")) {
            addComment(line);
          } else {
            addLine(line, "line-info");
          }
        }
        // Enable play button for Phase 5 replay
        playBtn.disabled = false;
      };
      reader.readAsText(file);
    });
    fileInput.click();
  });

  recordBtn.addEventListener("click", () => {
    recordBtn.classList.toggle("recording");
    const isRecording = recordBtn.classList.contains("recording");
    recordBtn.textContent = isRecording ? "\u23F9 Stop" : "\u23FA Record";
    addInfo(isRecording ? "Recording started." : "Recording stopped.");
    // Phase 4: will wire up content script recording
  });

  // Focus input on panel load
  input.focus();

  // Welcome message
  addInfo("Playwright REPL v0.2");
  addInfo('Type "help" for available commands.');
})();
