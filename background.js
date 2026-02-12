import { parseCommand } from "./lib/commands.js";
import { buildClickElementJS, buildFocusElementJS } from "./lib/locators.js";
import { formatAccessibilityTree } from "./lib/formatter.js";

// Track which tabs we've attached the debugger to
const attachedTabs = new Set();

// --- CDP helper ---

function cdp(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

// --- Debugger lifecycle ---

async function ensureAttached(tabId) {
  if (attachedTabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  await cdp(tabId, "Page.enable");
  await cdp(tabId, "Runtime.enable");
  attachedTabs.add(tabId);
}

chrome.debugger.onDetach.addListener((source) => {
  attachedTabs.delete(source.tabId);
});

// --- Message handler ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "pw-command") return;

  const { raw, tabId } = message;
  handleCommand(raw, tabId).then(sendResponse);

  // Return true to indicate async response
  return true;
});

async function handleCommand(raw, tabId) {
  const parsed = parseCommand(raw);
  if (!parsed) {
    return { success: false, type: "error", data: "Invalid command" };
  }

  const { command, args } = parsed;

  // Help doesn't need CDP
  if (command === "help") {
    return cmdHelp();
  }

  try {
    await ensureAttached(tabId);
  } catch (e) {
    return { success: false, type: "error", data: `Failed to attach debugger: ${e.message}` };
  }

  switch (command) {
    case "goto":
    case "open":      return cmdGoto(tabId, args);
    case "snapshot":  return cmdSnapshot(tabId);
    case "screenshot":return cmdScreenshot(tabId, args);
    case "eval":      return cmdEval(tabId, args);
    case "click":     return cmdClick(tabId, args);
    case "press":     return cmdPress(tabId, args);
    default:
      return { success: false, type: "error", data: `Unknown command: ${command}` };
  }
}

// --- Command implementations ---

async function cmdGoto(tabId, args) {
  if (args.length === 0) {
    return { success: false, type: "error", data: "Usage: goto <url>" };
  }
  let url = args[0];
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  try {
    await cdp(tabId, "Page.navigate", { url });
    await waitForLoad(tabId);
    return { success: true, type: "success", data: `Navigated to ${url}` };
  } catch (e) {
    return { success: false, type: "error", data: `Navigation failed: ${e.message}` };
  }
}

async function cmdSnapshot(tabId) {
  try {
    const result = await cdp(tabId, "Accessibility.getFullAXTree", {});
    const lines = formatAccessibilityTree(result.nodes);
    return { success: true, type: "snapshot", data: lines.join("\n") };
  } catch (e) {
    return { success: false, type: "error", data: `Snapshot failed: ${e.message}` };
  }
}

async function cmdScreenshot(tabId, args) {
  const fullPage = args.length > 0 && args[0] === "full";
  try {
    let params = { format: "png" };
    if (fullPage) {
      // Get full page dimensions and set clip to capture everything
      const layout = await cdp(tabId, "Page.getLayoutMetrics");
      const { width, height } = layout.contentSize;
      const deviceMetrics = { width: Math.ceil(width), height: Math.ceil(height), deviceScaleFactor: 1, mobile: false };
      await cdp(tabId, "Emulation.setDeviceMetricsOverride", deviceMetrics);
      params.clip = { x: 0, y: 0, width, height, scale: 1 };
    }
    const result = await cdp(tabId, "Page.captureScreenshot", params);
    if (fullPage) {
      await cdp(tabId, "Emulation.clearDeviceMetricsOverride");
    }
    return { success: true, type: "screenshot", data: result.data };
  } catch (e) {
    return { success: false, type: "error", data: `Screenshot failed: ${e.message}` };
  }
}

async function cmdEval(tabId, args) {
  if (args.length === 0) {
    return { success: false, type: "error", data: "Usage: eval <expression>" };
  }
  const expression = args.join(" ");
  try {
    const result = await cdp(tabId, "Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const msg = result.exceptionDetails.text ||
        result.exceptionDetails.exception?.description || "Evaluation error";
      return { success: false, type: "error", data: msg };
    }
    const value = result.result?.value;
    const display = value === undefined ? "undefined" : JSON.stringify(value, null, 2);
    return { success: true, type: "info", data: display };
  } catch (e) {
    return { success: false, type: "error", data: `Eval failed: ${e.message}` };
  }
}

async function cmdClick(tabId, args) {
  if (args.length === 0) {
    return { success: false, type: "error", data: 'Usage: click <ref> or click "text"' };
  }
  const target = args[0];
  try {
    const js = buildClickElementJS(target);
    const result = await cdp(tabId, "Runtime.evaluate", {
      expression: js,
      returnByValue: true,
    });
    const val = result.result?.value;
    if (!val || val.error) {
      return { success: false, type: "error", data: val?.error || `Element not found: "${target}"` };
    }
    return { success: true, type: "success", data: `Clicked "${target}"` };
  } catch (e) {
    return { success: false, type: "error", data: `Click failed: ${e.message}` };
  }
}

async function cmdPress(tabId, args) {
  if (args.length === 0) {
    return { success: false, type: "error", data: "Usage: press <key>" };
  }
  const key = args[0];
  const keyMap = {
    enter:      { key: "Enter",      code: "Enter",      keyCode: 13 },
    tab:        { key: "Tab",        code: "Tab",        keyCode: 9 },
    escape:     { key: "Escape",     code: "Escape",     keyCode: 27 },
    backspace:  { key: "Backspace",  code: "Backspace",  keyCode: 8 },
    delete:     { key: "Delete",     code: "Delete",     keyCode: 46 },
    arrowup:    { key: "ArrowUp",    code: "ArrowUp",    keyCode: 38 },
    arrowdown:  { key: "ArrowDown",  code: "ArrowDown",  keyCode: 40 },
    arrowleft:  { key: "ArrowLeft",  code: "ArrowLeft",  keyCode: 37 },
    arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
    space:      { key: " ",          code: "Space",      keyCode: 32 },
  };

  const mapped = keyMap[key.toLowerCase()] || {
    key,
    code: `Key${key.toUpperCase()}`,
    keyCode: key.charCodeAt(0),
  };

  try {
    await cdp(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: mapped.key,
      code: mapped.code,
      windowsVirtualKeyCode: mapped.keyCode,
      nativeVirtualKeyCode: mapped.keyCode,
    });
    await cdp(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: mapped.key,
      code: mapped.code,
      windowsVirtualKeyCode: mapped.keyCode,
      nativeVirtualKeyCode: mapped.keyCode,
    });
    return { success: true, type: "success", data: `Pressed ${key}` };
  } catch (e) {
    return { success: false, type: "error", data: `Press failed: ${e.message}` };
  }
}

function cmdHelp() {
  const lines = [
    "Available commands:",
    '  goto <url>            Navigate to URL',
    '  click <ref|"text">    Click an element by ref or text',
    '  fill "target" "value" Fill a field (Phase 3)',
    '  press <key>           Press a key (Enter, Tab, Escape, ...)',
    '  snapshot              Show accessibility tree',
    '  screenshot            Capture screenshot',
    '  eval <expr>           Evaluate JS expression',
    '  help                  Show this help',
  ];
  return { success: true, type: "info", data: lines.join("\n") };
}


function waitForLoad(tabId) {
  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; resolve(); }
    }, 5000);

    const listener = (source, method) => {
      if (source.tabId === tabId && method === "Page.loadEventFired") {
        chrome.debugger.onEvent.removeListener(listener);
        clearTimeout(timeout);
        if (!resolved) { resolved = true; resolve(); }
      }
    };
    chrome.debugger.onEvent.addListener(listener);
  });
}
