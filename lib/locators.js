import { callInPage, clickElementByRef, clickElementByText, focusElement } from "./page-scripts.js";

/**
 * Returns JS code to evaluate in the page context that finds an element
 * and clicks it directly. Returns { success, tag } or { error }.
 */
export function buildClickElementJS(target, scope) {
  // Ref from snapshot: e1, e8, etc.
  if (/^e\d+$/.test(target)) {
    const index = parseInt(target.slice(1)) - 1;
    return callInPage(clickElementByRef, index, target);
  }

  // Text-based locator, optionally scoped to a container matching scope text
  return callInPage(clickElementByText, target, scope || null);
}

/**
 * Returns JS code that finds an element by text/ref and focuses it.
 * Returns { success } or { error }.
 */
export function buildFocusElementJS(target) {
  return callInPage(focusElement, target);
}
