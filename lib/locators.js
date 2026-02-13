/**
 * Returns JS code to evaluate in the page context that finds an element
 * and clicks it directly. Returns { success, tag } or { error }.
 */
export function buildClickElementJS(target, scope) {
  // Ref from snapshot: e1, e8, etc.
  if (/^e\d+$/.test(target)) {
    const index = parseInt(target.slice(1)) - 1;
    return `
      (() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        const elements = [];
        while (walker.nextNode()) elements.push(walker.currentNode);
        const el = elements[${index}];
        if (!el) return { error: 'Element ${target} not found' };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { success: true, tag: el.tagName.toLowerCase() };
      })()
    `;
  }

  // Text-based locator, optionally scoped to a container matching scope text
  const escaped = JSON.stringify(target);
  const escapedScope = scope ? JSON.stringify(scope) : 'null';
  return `
    (() => {
      const text = ${escaped};
      const scopeText = ${escapedScope};
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

      if (!el) return { error: 'No element found matching: ' + text + (scopeText ? ' in "' + scopeText + '"' : '') };
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { success: true, tag: el.tagName.toLowerCase() };
    })()
  `;
}

/**
 * Returns JS code that finds an element by text/ref and focuses it.
 * Returns { success } or { error }.
 */
export function buildFocusElementJS(target) {
  const escaped = JSON.stringify(target);
  return `
    (() => {
      const text = ${escaped};
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

      if (!el) return { error: 'No input found matching: ' + text };
      el.focus();
      el.select && el.select();
      return { success: true };
    })()
  `;
}
