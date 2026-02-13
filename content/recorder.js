// Content recorder — injected into the inspected page via CDP.
// Captures user interactions and sends .pw commands back via console.debug.

(() => {
  if (window.__pwRecorderActive) return;
  window.__pwRecorderActive = true;

  function getLocator(el) {
    const ariaLabel = el.getAttribute && el.getAttribute("aria-label");
    if (ariaLabel) return quote(ariaLabel);

    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label && label.textContent.trim()) return quote(label.textContent.trim());
    }
    const parentLabel = el.closest && el.closest("label");
    if (parentLabel && parentLabel.textContent.trim()) {
      return quote(parentLabel.textContent.trim());
    }

    if (el.placeholder) return quote(el.placeholder);

    const text = el.textContent ? el.textContent.trim() : "";
    if (text && text.length < 80 && el.children.length === 0) return quote(text);

    if ((el.tagName === "BUTTON" || el.tagName === "A") && text && text.length < 80) {
      return quote(text);
    }

    if (el.title) return quote(el.title);

    const tag = el.tagName ? el.tagName.toLowerCase() : "unknown";
    return quote(tag);
  }

  // Get the primary text of a container (e.g., a list item's label)
  function getItemContext(el) {
    const item = el.closest && el.closest("li, tr, [role=listitem], [role=row], article");
    if (!item) return null;
    // Look for a label, heading, or primary text element
    const primary = item.querySelector("label, h1, h2, h3, h4, [class*=title], [class*=text], p, span");
    if (primary && primary !== el && primary.textContent.trim()) {
      const t = primary.textContent.trim();
      if (t.length < 80) return t;
    }
    return null;
  }

  function quote(s) {
    return '"' + s.replace(/"/g, '\\"') + '"';
  }

  function send(command) {
    console.debug("__pw:" + command);
  }

  let fillTimer = null;
  let fillTarget = null;
  let fillValue = "";

  function flushFill() {
    if (fillTarget && fillValue) {
      const locator = getLocator(fillTarget);
      send('fill ' + locator + ' "' + fillValue.replace(/"/g, '\\"') + '"');
    }
    fillTimer = null;
    fillTarget = null;
    fillValue = "";
  }

  // Elements that are non-interactive containers — skip recording clicks on these
  var skipTags = new Set(["HTML", "BODY", "MAIN", "FOOTER", "HEADER", "NAV", "SECTION", "ARTICLE", "DIV", "UL", "OL", "FORM", "FIELDSET", "TABLE", "TBODY", "THEAD", "TR"]);

  function findCheckbox(el) {
    // Check if el itself is a checkbox
    if (el.tagName === "INPUT" && el.type === "checkbox") return el;
    // Check if clicking a label that toggles a checkbox
    if (el.tagName === "LABEL") {
      var input = el.querySelector('input[type="checkbox"]');
      if (input) return input;
      if (el.htmlFor) {
        var target = document.getElementById(el.htmlFor);
        if (target && target.type === "checkbox") return target;
      }
    }
    // Check only the immediate parent label (not li/div which are too broad)
    var parentLabel = el.closest("label");
    if (parentLabel) {
      var cb = parentLabel.querySelector('input[type="checkbox"]');
      if (cb) return cb;
    }
    return null;
  }

  function handleClick(e) {
    try {
      if (fillTimer) { clearTimeout(fillTimer); flushFill(); }
      var el = e.target;
      if (!el || !el.tagName) return;

      // Skip text inputs and textareas
      if ((el.tagName === "INPUT" && el.type !== "checkbox" && el.type !== "radio") || el.tagName === "TEXTAREA") return;

      // Skip clicks on non-interactive container elements
      if (skipTags.has(el.tagName) && !el.getAttribute("role") && !el.getAttribute("onclick")) return;

      // Check for checkbox (direct or via label/parent)
      var checkbox = findCheckbox(el);
      if (checkbox) {
        var cbLabel = getItemContext(checkbox) || "";
        if (cbLabel) {
          send(checkbox.checked ? 'check "' + cbLabel + '"' : 'uncheck "' + cbLabel + '"');
        } else {
          var loc = getLocator(checkbox);
          send(checkbox.checked ? 'check ' + loc : 'uncheck ' + loc);
        }
        return;
      }

      var locator = getLocator(el);
      // Detect action buttons (Delete, Remove, Edit, close icons, etc.)
      // by text content, class name, or aria-label
      var actionWords = new Set(["delete", "remove", "edit", "close", "destroy", "\u00d7", "\u2715", "\u2716", "\u2717", "\u2718", "x"]);
      var elText = (el.textContent || "").trim().toLowerCase();
      var elClass = (el.className || "").toLowerCase();
      var elAriaLabel = (el.getAttribute && el.getAttribute("aria-label") || "").toLowerCase();
      var isAction = actionWords.has(elText)
        || [...actionWords].some(function(w) { return elClass.includes(w); })
        || [...actionWords].some(function(w) { return elAriaLabel.includes(w); })
        || (el.tagName === "BUTTON" && !elText && el.closest && el.closest("li, tr, [role=listitem]"));
      try {
        var ctx = getItemContext(el);
        if (ctx && isAction) {
          send('click ' + locator + ' "' + ctx.replace(/"/g, '\\"') + '"');
        } else {
          send('click ' + locator);
        }
      } catch(ce) {
        send('click ' + locator);
      }
    } catch(err) {
      console.debug("__pw:# click recording error: " + err.message);
    }
  }

  function handleInput(e) {
    const el = e.target;
    if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;
    if (el.type === "checkbox" || el.type === "radio") return;
    fillTarget = el;
    fillValue = el.value;
    if (fillTimer) clearTimeout(fillTimer);
    fillTimer = setTimeout(flushFill, 1500);
  }

  function handleChange(e) {
    const el = e.target;
    if (el.tagName === "SELECT") {
      const opt = el.options[el.selectedIndex];
      const optText = opt ? opt.text.trim() : el.value;
      send('select ' + getLocator(el) + ' "' + optText.replace(/"/g, '\\"') + '"');
    }
  }

  function handleKeydown(e) {
    const specialKeys = ["Enter", "Tab", "Escape"];
    if (specialKeys.includes(e.key)) {
      if (fillTimer) { clearTimeout(fillTimer); flushFill(); }
      send('press ' + e.key);
    }
  }

  document.addEventListener("click", handleClick, true);
  document.addEventListener("input", handleInput, true);
  document.addEventListener("change", handleChange, true);
  document.addEventListener("keydown", handleKeydown, true);

  window.__pwRecorderCleanup = () => {
    if (fillTimer) { clearTimeout(fillTimer); flushFill(); }
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("input", handleInput, true);
    document.removeEventListener("change", handleChange, true);
    document.removeEventListener("keydown", handleKeydown, true);
    window.__pwRecorderActive = false;
    delete window.__pwRecorderCleanup;
  };
})();
