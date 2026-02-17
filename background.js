import { parseCommand } from "./lib/commands.js";
import { buildClickElementJS, buildFocusElementJS } from "./lib/locators.js";
import { formatAccessibilityTree } from "./lib/formatter.js";
import {
  callInPage,
  selectElement,
  checkElement,
  hoverElement,
  dblclickElement,
  verifyElementExists,
  verifyTextOnPage,
  dispatchFillEvents,
} from "./lib/page-scripts.js";

console.log("[PW] background.js loaded v0.9.2");

// Track which tabs we've attached the debugger to
const attachedTabs = new Set();

// Clean up any leftover debugger sessions from previous service worker instances
chrome.debugger.getTargets((targets) => {
  const attached = targets.filter(t => t.attached);
  console.log("[PW] Startup cleanup: found", attached.length, "attached targets out of", targets.length, "total");
  for (const target of attached) {
    if (target.tabId) {
      console.log("[PW] Detaching leftover debugger for tab", target.tabId, "type:", target.type);
      chrome.debugger.detach({ tabId: target.tabId }, () => {
        if (chrome.runtime.lastError) {
          console.log("[PW] Startup detach tab", target.tabId, ":", chrome.runtime.lastError.message);
        } else {
          console.log("[PW] Cleaned up debugger for tab", target.tabId);
        }
      });
    }
  }
});

// --- CDP helper ---

function cdp(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

// --- Debugger lifecycle ---

async function ensureAttached(tabId) {
  if (attachedTabs.has(tabId)) return;
  console.log("[PW] Attaching debugger to tab", tabId);
  await chrome.debugger.attach({ tabId }, "1.3");
  await cdp(tabId, "Page.enable");
  await cdp(tabId, "Runtime.enable");
  attachedTabs.add(tabId);
  console.log("[PW] Debugger attached and domains enabled for tab", tabId);
}

chrome.debugger.onDetach.addListener((source) => {
  const tabId = source.tabId;
  attachedTabs.delete(tabId);
  // Also clean up recording state if debugger was forcibly detached
  const recording = recordingTabs.get(tabId);
  if (recording) {
    chrome.debugger.onEvent.removeListener(recording.listener);
    recordingTabs.delete(tabId);
  }
});

// Clean up when the tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  panelPorts.delete(tabId);
  attachedTabs.delete(tabId);
  const recording = recordingTabs.get(tabId);
  if (recording) {
    chrome.debugger.onEvent.removeListener(recording.listener);
    recordingTabs.delete(tabId);
  }
});

// --- Message handler ---

// Track recording state per tab
const recordingTabs = new Map();

// Port connections from DevTools panels (keyed by tabId)
const panelPorts = new Map();

// DevTools panels connect via port for reliable two-way communication
chrome.runtime.onConnect.addListener((port) => {
  if (port.name.startsWith("pw-panel-")) {
    const tabId = parseInt(port.name.replace("pw-panel-", ""));
    console.log("[PW] Panel connected for tab", tabId);

    // Clean up any leftover session from a previous panel/worker instance
    // This is the most reliable cleanup point — guaranteed to run while worker is alive
    const oldRecording = recordingTabs.get(tabId);
    if (oldRecording) {
      chrome.debugger.onEvent.removeListener(oldRecording.listener);
      recordingTabs.delete(tabId);
      console.log("[PW] Cleaned up stale recording for tab", tabId);
    }
    attachedTabs.delete(tabId);
    chrome.debugger.detach({ tabId }, () => {
      if (chrome.runtime.lastError) {
        // Expected if no previous session — ignore
      } else {
        console.log("[PW] Detached leftover debugger for tab", tabId);
      }
    });

    panelPorts.set(tabId, port);
    port.onDisconnect.addListener(() => {
      console.log("[PW] Panel disconnected for tab", tabId);
      panelPorts.delete(tabId);
      // Stop recording if active
      const recording = recordingTabs.get(tabId);
      if (recording) {
        chrome.debugger.onEvent.removeListener(recording.listener);
        recordingTabs.delete(tabId);
      }
      // Always try to detach debugger
      attachedTabs.delete(tabId);
      chrome.debugger.detach({ tabId }, () => {
        if (chrome.runtime.lastError) {
          console.log("[PW] Detach on disconnect (tab", tabId, "):", chrome.runtime.lastError.message);
        } else {
          console.log("[PW] Debugger detached for tab", tabId);
        }
      });
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "pw-command") {
    const { raw, tabId } = message;
    handleCommand(raw, tabId).then(sendResponse);
    return true;
  }

  if (message.type === "pw-record-start") {
    const { tabId } = message;
    console.log("[PW] Received pw-record-start for tab", tabId, "port exists:", panelPorts.has(tabId));
    startRecording(tabId).then(sendResponse);
    return true;
  }

  if (message.type === "pw-record-stop") {
    const { tabId } = message;
    stopRecording(tabId).then(sendResponse);
    return true;
  }

});

async function startRecording(tabId) {
  try {
    console.log("[PW] startRecording for tab", tabId);
    await ensureAttached(tabId);
    console.log("[PW] debugger attached");

    // Listen for console.debug messages from the injected recorder
    // and Page.frameNavigated for goto commands
    const listener = (source, method, params) => {
      if (source.tabId !== tabId) return;

      // Capture navigations as goto commands (main frame only)
      if (method === "Page.frameNavigated" && params.frame && !params.frame.parentId) {
        const url = params.frame.url;
        if (url && !url.startsWith("about:") && !url.startsWith("chrome:")) {
          const command = `goto ${url}`;
          console.log("[PW] Recorded navigation:", command);
          if (panelPorts.has(tabId)) {
            panelPorts.get(tabId).postMessage({
              type: "pw-recorded-command",
              command,
            });
          }
        }
      }

      // Capture recorder events via console.debug
      if (method === "Runtime.consoleAPICalled" && params.type === "debug") {
        const arg = params.args && params.args[0];
        if (arg && arg.type === "string" && arg.value.startsWith("__pw:")) {
          const command = arg.value.slice(5);
          console.log("[PW] Recorded command:", command);
          if (panelPorts.has(tabId)) {
            panelPorts.get(tabId).postMessage({
              type: "pw-recorded-command",
              command,
            });
          }
        }
      }
    };
    chrome.debugger.onEvent.addListener(listener);

    // Use addScriptToEvaluateOnNewDocument so the recorder survives
    // page reloads and execution context resets
    const recorderCode = await getRecorderCode();
    const addResult = await cdp(tabId, "Page.addScriptToEvaluateOnNewDocument", {
      source: recorderCode,
    });
    const scriptId = addResult.identifier;
    console.log("[PW] Recorder registered with scriptId:", scriptId);

    // Also inject into the current page immediately
    await cdp(tabId, "Runtime.evaluate", {
      expression: recorderCode,
      returnByValue: true,
    });
    console.log("[PW] Recorder also injected into current page");

    recordingTabs.set(tabId, { listener, scriptId });

    return { success: true };
  } catch (e) {
    console.error("[PW] startRecording error:", e.message);
    return { success: false, error: e.message };
  }
}

async function stopRecording(tabId) {
  try {
    console.log("[PW] stopRecording for tab", tabId);
    const recording = recordingTabs.get(tabId);
    if (recording) {
      // Remove the CDP event listener
      chrome.debugger.onEvent.removeListener(recording.listener);
      // Remove the auto-inject script so it won't run on future navigations
      if (attachedTabs.has(tabId) && recording.scriptId) {
        try {
          await cdp(tabId, "Page.removeScriptToEvaluateOnNewDocument", {
            identifier: recording.scriptId,
          });
        } catch (e) { /* ignore if already gone */ }
      }
      recordingTabs.delete(tabId);
    }

    // Clean up the recorder in the current page
    if (attachedTabs.has(tabId)) {
      try {
        await cdp(tabId, "Runtime.evaluate", {
          expression: "if (window.__pwRecorderCleanup) window.__pwRecorderCleanup();",
        });
      } catch (e) { /* ignore if context is gone */ }
    }

    // Detach debugger so the yellow bar goes away
    if (attachedTabs.has(tabId)) {
      attachedTabs.delete(tabId);
      chrome.debugger.detach({ tabId }, () => {
        if (chrome.runtime.lastError) {
          console.log("[PW] Detach after stop (tab", tabId, "):", chrome.runtime.lastError.message);
        } else {
          console.log("[PW] Debugger detached after stop for tab", tabId);
        }
      });
    }

    return { success: true };
  } catch (e) {
    console.error("[PW] stopRecording error:", e.message);
    return { success: false, error: e.message };
  }
}

let _recorderCodeCache = null;

async function getRecorderCode() {
  if (_recorderCodeCache) return _recorderCodeCache;
  const url = chrome.runtime.getURL("content/recorder.js");
  const resp = await fetch(url);
  _recorderCodeCache = await resp.text();
  return _recorderCodeCache;
}

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
    case "open":        return cmdGoto(tabId, args);
    case "snapshot":
    case "s":           return cmdSnapshot(tabId);
    case "screenshot":  return cmdScreenshot(tabId, args);
    case "eval":        return cmdEval(tabId, args);
    case "click":
    case "c":           return cmdClick(tabId, args);
    case "fill":
    case "f":           return cmdFill(tabId, args);
    case "select":      return cmdSelect(tabId, args);
    case "check":       return cmdCheck(tabId, args, true);
    case "uncheck":     return cmdCheck(tabId, args, false);
    case "hover":       return cmdHover(tabId, args);
    case "dblclick":    return cmdDblclick(tabId, args);
    case "press":
    case "p":           return cmdPress(tabId, args);
    case "go-back":
    case "back":        return cmdGoBack(tabId);
    case "go-forward":
    case "forward":     return cmdGoForward(tabId);
    case "reload":      return cmdReload(tabId);
    case "verify-text":     return cmdVerifyText(tabId, args, true);
    case "verify-no-text":  return cmdVerifyText(tabId, args, false);
    case "verify-element":     return cmdVerifyElement(tabId, args, true);
    case "verify-no-element":  return cmdVerifyElement(tabId, args, false);
    case "verify-url":      return cmdVerifyUrl(tabId, args);
    case "verify-title":    return cmdVerifyTitle(tabId, args);
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
    return { success: false, type: "error", data: 'Usage: click <ref> or click "text" [scope]' };
  }
  const target = args[0];
  const scope = args[1] || null;
  try {
    const js = buildClickElementJS(target, scope);
    const result = await cdp(tabId, "Runtime.evaluate", {
      expression: js,
      returnByValue: true,
    });
    const val = result.result?.value;
    if (!val || val.error) {
      return { success: false, type: "error", data: val?.error || `Element not found: "${target}"` };
    }
    const desc = scope ? `Clicked "${target}" in "${scope}"` : `Clicked "${target}"`;
    return { success: true, type: "success", data: desc };
  } catch (e) {
    return { success: false, type: "error", data: `Click failed: ${e.message}` };
  }
}

async function cmdFill(tabId, args) {
  if (args.length < 2) {
    return { success: false, type: "error", data: 'Usage: fill "target" "value"' };
  }
  const target = args[0];
  const value = args[1];
  try {
    const js = buildFocusElementJS(target);
    const result = await cdp(tabId, "Runtime.evaluate", {
      expression: js,
      returnByValue: true,
    });
    const val = result.result?.value;
    if (!val || val.error) {
      return { success: false, type: "error", data: val?.error || `Input not found: "${target}"` };
    }
    // Clear existing value and type new one
    await cdp(tabId, "Runtime.evaluate", {
      expression: `document.activeElement.value = ''`,
    });
    await cdp(tabId, "Input.insertText", { text: value });
    // Dispatch input + change events so frameworks pick it up
    await cdp(tabId, "Runtime.evaluate", {
      expression: callInPage(dispatchFillEvents),
    });
    return { success: true, type: "success", data: `Filled "${target}" with "${value}"` };
  } catch (e) {
    return { success: false, type: "error", data: `Fill failed: ${e.message}` };
  }
}

async function cmdSelect(tabId, args) {
  if (args.length < 2) {
    return { success: false, type: "error", data: 'Usage: select "target" "option"' };
  }
  const target = args[0];
  const option = args[1];
  try {
    const js = callInPage(selectElement, target, option);
    const result = await cdp(tabId, "Runtime.evaluate", { expression: js, returnByValue: true });
    const val = result.result?.value;
    if (!val || val.error) {
      return { success: false, type: "error", data: val?.error || `Select failed` };
    }
    return { success: true, type: "success", data: `Selected "${option}" in "${target}"` };
  } catch (e) {
    return { success: false, type: "error", data: `Select failed: ${e.message}` };
  }
}

async function cmdCheck(tabId, args, checked) {
  if (args.length === 0) {
    return { success: false, type: "error", data: `Usage: ${checked ? 'check' : 'uncheck'} "target"` };
  }
  const target = args[0];
  const action = checked ? "check" : "uncheck";
  try {
    const js = callInPage(checkElement, target, checked);
    const result = await cdp(tabId, "Runtime.evaluate", { expression: js, returnByValue: true });
    const val = result.result?.value;
    if (!val || val.error) {
      return { success: false, type: "error", data: val?.error || `${action} failed` };
    }
    return { success: true, type: "success", data: `${action === 'check' ? 'Checked' : 'Unchecked'} "${target}"` };
  } catch (e) {
    return { success: false, type: "error", data: `${action} failed: ${e.message}` };
  }
}

async function cmdHover(tabId, args) {
  if (args.length === 0) {
    return { success: false, type: "error", data: 'Usage: hover "text"' };
  }
  const target = args[0];
  try {
    const js = callInPage(hoverElement, target);
    const result = await cdp(tabId, "Runtime.evaluate", { expression: js, returnByValue: true });
    const pos = result.result?.value;
    if (!pos || pos.error) {
      return { success: false, type: "error", data: pos?.error || `Element not found: "${target}"` };
    }
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: pos.x, y: pos.y });
    return { success: true, type: "success", data: `Hovered "${target}"` };
  } catch (e) {
    return { success: false, type: "error", data: `Hover failed: ${e.message}` };
  }
}

async function cmdDblclick(tabId, args) {
  if (args.length === 0) {
    return { success: false, type: "error", data: 'Usage: dblclick "text"' };
  }
  const target = args[0];
  try {
    const js = callInPage(dblclickElement, target);
    const result = await cdp(tabId, "Runtime.evaluate", { expression: js, returnByValue: true });
    const val = result.result?.value;
    if (!val || val.error) {
      return { success: false, type: "error", data: val?.error || `Element not found: "${target}"` };
    }
    return { success: true, type: "success", data: `Double-clicked "${target}"` };
  } catch (e) {
    return { success: false, type: "error", data: `Dblclick failed: ${e.message}` };
  }
}

async function cmdGoBack(tabId) {
  try {
    const history = await cdp(tabId, "Page.getNavigationHistory");
    if (history.currentIndex <= 0) {
      return { success: false, type: "error", data: "No previous page in history" };
    }
    const entry = history.entries[history.currentIndex - 1];
    await cdp(tabId, "Page.navigateToHistoryEntry", { entryId: entry.id });
    await waitForLoad(tabId);
    return { success: true, type: "success", data: `Navigated back to ${entry.url}` };
  } catch (e) {
    return { success: false, type: "error", data: `Go back failed: ${e.message}` };
  }
}

async function cmdGoForward(tabId) {
  try {
    const history = await cdp(tabId, "Page.getNavigationHistory");
    if (history.currentIndex >= history.entries.length - 1) {
      return { success: false, type: "error", data: "No next page in history" };
    }
    const entry = history.entries[history.currentIndex + 1];
    await cdp(tabId, "Page.navigateToHistoryEntry", { entryId: entry.id });
    await waitForLoad(tabId);
    return { success: true, type: "success", data: `Navigated forward to ${entry.url}` };
  } catch (e) {
    return { success: false, type: "error", data: `Go forward failed: ${e.message}` };
  }
}

async function cmdReload(tabId) {
  try {
    await cdp(tabId, "Page.reload");
    await waitForLoad(tabId);
    return { success: true, type: "success", data: "Page reloaded" };
  } catch (e) {
    return { success: false, type: "error", data: `Reload failed: ${e.message}` };
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

async function cmdVerifyText(tabId, args, shouldExist) {
  if (args.length === 0) {
    return { success: false, type: "error", data: `Usage: verify-${shouldExist ? '' : 'no-'}text "text"` };
  }
  const text = args[0];
  try {
    const js = callInPage(verifyTextOnPage, text);
    const result = await cdp(tabId, "Runtime.evaluate", {
      expression: js,
      returnByValue: true,
    });
    const found = result.result?.value === true;
    if (shouldExist && found) {
      return { success: true, type: "success", data: `PASS: Text "${text}" found on page` };
    } else if (shouldExist && !found) {
      return { success: false, type: "error", data: `FAIL: Text "${text}" not found on page` };
    } else if (!shouldExist && !found) {
      return { success: true, type: "success", data: `PASS: Text "${text}" not present (as expected)` };
    } else {
      return { success: false, type: "error", data: `FAIL: Text "${text}" was found on page (expected absent)` };
    }
  } catch (e) {
    return { success: false, type: "error", data: `Verify failed: ${e.message}` };
  }
}

async function cmdVerifyElement(tabId, args, shouldExist) {
  if (args.length === 0) {
    return { success: false, type: "error", data: `Usage: verify-${shouldExist ? '' : 'no-'}element "target"` };
  }
  const target = args[0];
  try {
    const js = callInPage(verifyElementExists, target);
    const result = await cdp(tabId, "Runtime.evaluate", { expression: js, returnByValue: true });
    const found = result.result?.value === true;
    if (shouldExist && found) {
      return { success: true, type: "success", data: `PASS: Element "${target}" found` };
    } else if (shouldExist && !found) {
      return { success: false, type: "error", data: `FAIL: Element "${target}" not found` };
    } else if (!shouldExist && !found) {
      return { success: true, type: "success", data: `PASS: Element "${target}" not present (as expected)` };
    } else {
      return { success: false, type: "error", data: `FAIL: Element "${target}" was found (expected absent)` };
    }
  } catch (e) {
    return { success: false, type: "error", data: `Verify failed: ${e.message}` };
  }
}

async function cmdVerifyUrl(tabId, args) {
  if (args.length === 0) {
    return { success: false, type: "error", data: 'Usage: verify-url "substring"' };
  }
  const expected = args[0];
  try {
    const result = await cdp(tabId, "Runtime.evaluate", {
      expression: "window.location.href",
      returnByValue: true,
    });
    const url = result.result?.value || "";
    if (url.includes(expected)) {
      return { success: true, type: "success", data: `PASS: URL contains "${expected}" (${url})` };
    } else {
      return { success: false, type: "error", data: `FAIL: URL does not contain "${expected}" (${url})` };
    }
  } catch (e) {
    return { success: false, type: "error", data: `Verify failed: ${e.message}` };
  }
}

async function cmdVerifyTitle(tabId, args) {
  if (args.length === 0) {
    return { success: false, type: "error", data: 'Usage: verify-title "expected"' };
  }
  const expected = args[0];
  try {
    const result = await cdp(tabId, "Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    });
    const title = result.result?.value || "";
    if (title.includes(expected)) {
      return { success: true, type: "success", data: `PASS: Title contains "${expected}" ("${title}")` };
    } else {
      return { success: false, type: "error", data: `FAIL: Title does not contain "${expected}" ("${title}")` };
    }
  } catch (e) {
    return { success: false, type: "error", data: `Verify failed: ${e.message}` };
  }
}

function cmdHelp() {
  const lines = [
    "Available commands:",
    '  goto/open <url>         Navigate to URL',
    '  click/c <ref|"text"> ["scope"]  Click an element (scope narrows to item)',
    '  dblclick "text"         Double-click an element',
    '  fill/f "target" "value" Fill a field',
    '  select "target" "opt"   Select dropdown option',
    '  check "target"          Check a checkbox',
    '  uncheck "target"        Uncheck a checkbox',
    '  hover "text"            Hover over an element',
    '  press/p <key>           Press a key (Enter, Tab, Escape, ...)',
    '  snapshot/s              Show accessibility tree',
    '  screenshot [full]       Capture screenshot',
    '  eval <expr>             Evaluate JS expression',
    '  verify-text "text"      Assert text is visible on page',
    '  verify-no-text "text"   Assert text is NOT on page',
    '  verify-element "target" Assert element exists',
    '  verify-no-element "t"   Assert element does NOT exist',
    '  verify-url "substring"  Assert URL contains string',
    '  verify-title "text"     Assert page title contains string',
    '  go-back/back            Navigate back',
    '  go-forward/forward      Navigate forward',
    '  reload                  Reload page',
    '  export                  Export session as Playwright test',
    '  export <cmd>            Convert one command to Playwright',
    '  history                 Show command history',
    '  clear                   Clear terminal output',
    '  reset                   Clear history and terminal',
    '  help                    Show this help',
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

// Export for testing (service worker ignores these)
export {
  handleCommand,
  cmdHelp,
  getRecorderCode,
  startRecording,
  stopRecording,
  ensureAttached,
  waitForLoad,
  attachedTabs,
  recordingTabs,
  panelPorts,
};
