/**
 * Page-context functions — injected into the inspected page via Runtime.evaluate.
 *
 * Each function MUST be self-contained: no closures, no imports, no external references.
 * They are converted to strings via Function.toString() and invoked with callInPage().
 */

/**
 * Utility: creates a Runtime.evaluate expression from a page-context function.
 * Converts the function to a string and wraps it as an IIFE with serialized arguments.
 */
export function callInPage(fn, ...args) {
  return `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(", ")})`;
}

// --- Click / navigation ---

export function clickElementByRef(index, refName) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  const elements = [];
  while (walker.nextNode()) elements.push(walker.currentNode);
  const el = elements[index];
  if (!el) return { error: "Element " + refName + " not found" };
  el.scrollIntoView({ block: "center" });
  el.click();
  return { success: true, tag: el.tagName.toLowerCase() };
}

export function clickElementByText(text, scopeText) {
  const lower = text.toLowerCase();
  function matches(s) { return s && s.trim().toLowerCase() === lower; }

  // If scope is provided, find the container first, then search within it
  let root = document;
  if (scopeText) {
    const scopeLower = scopeText.toLowerCase();
    const containers = [...document.querySelectorAll('li, tr, [role="listitem"], [role="row"], article, div')];
    const container = containers.find(c => {
      const t = c.textContent.trim().toLowerCase();
      return t.includes(scopeLower);
    });
    if (container) root = container;
  }

  // Strategy 1: buttons, links, submit inputs by text/value
  const interactive = [...root.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')];
  let el = interactive.find(e => matches(e.textContent) || matches(e.value));

  // Strategy 2: inputs/textareas by placeholder or associated label
  if (!el) {
    const inputs = [...root.querySelectorAll('input, textarea')];
    el = inputs.find(e => matches(e.placeholder));
  }
  if (!el) {
    const labels = [...root.querySelectorAll('label')];
    const label = labels.find(l => matches(l.textContent));
    if (label) {
      el = label.control || document.getElementById(label.htmlFor);
    }
  }

  // Strategy 3: aria-label
  if (!el) {
    const all = [...root.querySelectorAll('[aria-label]')];
    el = all.find(e => matches(e.getAttribute('aria-label')));
  }

  // Strategy 4: title attribute
  if (!el) {
    const all = [...root.querySelectorAll('[title]')];
    el = all.find(e => matches(e.getAttribute('title')));
  }

  // Strategy 5: any leaf element with exact text
  if (!el) {
    const all = [...root.querySelectorAll('*')];
    el = all.find(e => matches(e.textContent) && e.children.length === 0);
  }

  if (!el) return { error: "No element found matching: " + text + (scopeText ? ' in "' + scopeText + '"' : "") };
  el.scrollIntoView({ block: "center" });
  el.click();
  return { success: true, tag: el.tagName.toLowerCase() };
}

// --- Focus ---

export function focusElement(text) {
  const lower = text.toLowerCase();
  function matches(s) { return s && s.trim().toLowerCase() === lower; }

  // Find by placeholder
  let el;
  const inputs = [...document.querySelectorAll('input, textarea')];
  el = inputs.find(e => matches(e.placeholder));

  // Find by label
  if (!el) {
    const labels = [...document.querySelectorAll('label')];
    const label = labels.find(l => matches(l.textContent));
    if (label) el = label.control || document.getElementById(label.htmlFor);
  }

  // Find by aria-label
  if (!el) {
    const all = [...document.querySelectorAll('[aria-label]')];
    el = all.find(e => matches(e.getAttribute('aria-label')));
  }

  // Find by role=textbox with name
  if (!el) {
    const editables = [...document.querySelectorAll('input, textarea, [contenteditable="true"]')];
    el = editables.find(e => matches(e.getAttribute('aria-label')) || matches(e.placeholder));
  }

  if (!el) return { error: "No input found matching: " + text };
  el.focus();
  el.select && el.select();
  return { success: true };
}

// --- Select ---

export function selectElement(text, optText) {
  const lower = text.toLowerCase();
  function matches(s) { return s && s.trim().toLowerCase() === lower; }
  let sel = document.querySelector('select[aria-label="' + CSS.escape(text) + '"]');
  if (!sel) {
    const labels = [...document.querySelectorAll('label')];
    const label = labels.find(l => matches(l.textContent));
    if (label) sel = label.control || document.getElementById(label.htmlFor);
  }
  if (!sel || sel.tagName !== "SELECT") return { error: "No select found: " + text };
  const opt = [...sel.options].find(o =>
    o.text.trim().toLowerCase() === optText.toLowerCase() ||
    o.value.toLowerCase() === optText.toLowerCase()
  );
  if (!opt) return { error: "Option not found: " + optText };
  sel.value = opt.value;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  return { success: true };
}

// --- Checkbox ---

export function checkElement(text, checked) {
  const lower = text.toLowerCase();
  function matches(s) { return s && s.trim().toLowerCase() === lower; }
  let el;
  // 1. Find by label association (for/id)
  const labels = [...document.querySelectorAll('label')];
  const label = labels.find(l => matches(l.textContent));
  if (label) el = label.control || document.getElementById(label.htmlFor);
  // 2. Find by aria-label on the checkbox itself
  if (!el) el = document.querySelector('input[type="checkbox"][aria-label="' + CSS.escape(text) + '"]');
  // 3. Find checkbox in the same container as matching text (sibling pattern)
  if (!el && label) {
    const container = label.closest('li, tr, div, [role="listitem"]');
    if (container) el = container.querySelector('input[type="checkbox"]');
  }
  // 4. Find a list item/container whose text matches, then get its checkbox
  if (!el) {
    const items = [...document.querySelectorAll('li, tr, [role="listitem"], [role="row"]')];
    const item = items.find(i => i.textContent.trim().toLowerCase().includes(lower));
    if (item) el = item.querySelector('input[type="checkbox"]');
  }
  if (!el || (el.type !== "checkbox" && el.type !== "radio")) return { error: "No checkbox found: " + text };
  if (el.checked !== checked) {
    el.click();
  }
  return { success: true, checked: el.checked };
}

// --- Hover ---

export function hoverElement(text) {
  const lower = text.toLowerCase();
  function matches(s) { return s && s.trim().toLowerCase() === lower; }
  const interactive = [...document.querySelectorAll('button, a, [role="button"], input, textarea, select, [role="menuitem"]')];
  let el = interactive.find(e => matches(e.textContent) || matches(e.value) || matches(e.getAttribute('aria-label')));
  if (!el) {
    const all = [...document.querySelectorAll('*')];
    el = all.find(e => matches(e.textContent) && e.children.length === 0);
  }
  if (!el) return { error: "No element found: " + text };
  el.scrollIntoView({ block: "center" });
  const rect = el.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

// --- Double-click ---

export function dblclickElement(text) {
  const lower = text.toLowerCase();
  function matches(s) { return s && s.trim().toLowerCase() === lower; }
  const interactive = [...document.querySelectorAll('button, a, [role="button"], input, textarea')];
  let el = interactive.find(e => matches(e.textContent) || matches(e.value));
  if (!el) {
    const all = [...document.querySelectorAll('*')];
    el = all.find(e => matches(e.textContent) && e.children.length === 0);
  }
  if (!el) return { error: "No element found: " + text };
  el.scrollIntoView({ block: "center" });
  const event = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return { success: true };
}

// --- Verify ---

export function verifyElementExists(text) {
  const lower = text.toLowerCase();
  function matches(s) { return s && s.trim().toLowerCase() === lower; }
  const interactive = [...document.querySelectorAll('button, a, [role="button"], input, textarea, select, [role="menuitem"], [role="link"], [role="tab"]')];
  let el = interactive.find(e => matches(e.textContent) || matches(e.value) || matches(e.getAttribute('aria-label')));
  if (!el) {
    const labels = [...document.querySelectorAll('label')];
    el = labels.find(l => matches(l.textContent));
  }
  if (!el) {
    const all = [...document.querySelectorAll('*')];
    el = all.find(e => matches(e.textContent) && e.children.length === 0);
  }
  return !!el;
}

export function verifyTextOnPage(text) {
  return document.body.innerText.includes(text);
}

// --- Fill helpers ---

export function dispatchFillEvents() {
  const el = document.activeElement;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
