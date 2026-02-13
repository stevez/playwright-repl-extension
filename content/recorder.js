// Content script injected into the inspected page when recording is active.
// Captures user interactions and sends .pw commands back to the extension.

(() => {
  if (window.__pwRecorderActive) return;
  window.__pwRecorderActive = true;

  // --- Locator strategies ---

  function getLocator(el) {
    // 1. aria-label
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return quote(ariaLabel);

    // 2. Associated label (for inputs)
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label && label.textContent.trim()) return quote(label.textContent.trim());
    }
    // Label wrapping the input
    const parentLabel = el.closest("label");
    if (parentLabel && parentLabel.textContent.trim()) {
      // Remove the input's own value/text from label text
      const labelText = parentLabel.textContent.trim();
      if (labelText) return quote(labelText);
    }

    // 3. Placeholder
    if (el.placeholder) return quote(el.placeholder);

    // 4. Text content (for buttons, links)
    const text = el.textContent.trim();
    if (text && text.length < 80 && el.children.length === 0) return quote(text);

    // 5. Button/link with short text
    if ((el.tagName === "BUTTON" || el.tagName === "A") && text && text.length < 80) {
      return quote(text);
    }

    // 6. Title attribute
    if (el.title) return quote(el.title);

    // 7. Fallback: tag + nth-of-type
    const tag = el.tagName.toLowerCase();
    const siblings = [...el.parentElement.querySelectorAll(`:scope > ${tag}`)];
    if (siblings.length > 1) {
      const idx = siblings.indexOf(el) + 1;
      return `${tag}:nth-of-type(${idx})`;
    }
    return tag;
  }

  function quote(s) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }

  function send(command) {
    chrome.runtime.sendMessage({ type: "pw-recorded", command });
  }

  // --- Debounce for fill commands ---
  let fillTimer = null;
  let fillTarget = null;
  let fillValue = "";

  function flushFill() {
    if (fillTarget && fillValue) {
      const locator = getLocator(fillTarget);
      send(`fill ${locator} "${fillValue.replace(/"/g, '\\"')}"`);
    }
    fillTimer = null;
    fillTarget = null;
    fillValue = "";
  }

  // --- Event handlers ---

  function handleClick(e) {
    // Flush any pending fill before recording the click
    if (fillTimer) {
      clearTimeout(fillTimer);
      flushFill();
    }

    const el = e.target;

    // Skip clicks on inputs/textareas (those are focus, not click actions)
    // but allow checkboxes and radio buttons through
    if ((el.tagName === "INPUT" && el.type !== "checkbox" && el.type !== "radio") || el.tagName === "TEXTAREA") return;

    // Checkboxes and radio buttons
    if (el.type === "checkbox") {
      const locator = getLocator(el);
      send(el.checked ? `check ${locator}` : `uncheck ${locator}`);
      return;
    }
    if (el.type === "radio") {
      const locator = getLocator(el);
      send(`click ${locator}`);
      return;
    }

    const locator = getLocator(el);
    send(`click ${locator}`);
  }

  function handleInput(e) {
    const el = e.target;
    if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;
    if (el.type === "checkbox" || el.type === "radio") return;

    // Debounce: collect keystrokes into a single fill command
    fillTarget = el;
    fillValue = el.value;
    if (fillTimer) clearTimeout(fillTimer);
    fillTimer = setTimeout(flushFill, 800);
  }

  function handleChange(e) {
    const el = e.target;

    // Select dropdown
    if (el.tagName === "SELECT") {
      const locator = getLocator(el);
      const selectedOption = el.options[el.selectedIndex];
      const optionText = selectedOption ? selectedOption.text.trim() : el.value;
      send(`select ${locator} "${optionText.replace(/"/g, '\\"')}"`);
      return;
    }
  }

  function handleKeydown(e) {
    // Only capture special keys
    const specialKeys = ["Enter", "Tab", "Escape", "Backspace", "Delete"];
    if (specialKeys.includes(e.key)) {
      // Flush any pending fill first
      if (fillTimer) {
        clearTimeout(fillTimer);
        flushFill();
      }
      send(`press ${e.key}`);
    }
  }

  // --- Attach listeners ---

  document.addEventListener("click", handleClick, true);
  document.addEventListener("input", handleInput, true);
  document.addEventListener("change", handleChange, true);
  document.addEventListener("keydown", handleKeydown, true);

  // --- Cleanup function (called when recording stops) ---

  window.__pwRecorderCleanup = () => {
    // Flush any pending fill
    if (fillTimer) {
      clearTimeout(fillTimer);
      flushFill();
    }
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("input", handleInput, true);
    document.removeEventListener("change", handleChange, true);
    document.removeEventListener("keydown", handleKeydown, true);
    window.__pwRecorderActive = false;
    delete window.__pwRecorderCleanup;
  };
})();
