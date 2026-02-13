import { describe, it, expect } from "vitest";
import { formatAccessibilityTree } from "../lib/formatter.js";

describe("formatAccessibilityTree", () => {
  it("returns empty tree for null input", () => {
    expect(formatAccessibilityTree(null)).toEqual(["(empty tree)"]);
  });

  it("returns empty tree for empty array", () => {
    expect(formatAccessibilityTree([])).toEqual(["(empty tree)"]);
  });

  it("formats a single button node", () => {
    const nodes = [
      { role: { value: "button" }, name: { value: "Submit" } },
    ];
    expect(formatAccessibilityTree(nodes)).toEqual([
      '- button "Submit" [ref=e1]',
    ]);
  });

  it("formats multiple nodes with sequential refs", () => {
    const nodes = [
      { role: { value: "link" }, name: { value: "Home" } },
      { role: { value: "button" }, name: { value: "Login" } },
      { role: { value: "textbox" }, name: { value: "Email" } },
    ];
    const result = formatAccessibilityTree(nodes);
    expect(result).toEqual([
      '- link "Home" [ref=e1]',
      '- button "Login" [ref=e2]',
      '- textbox "Email" [ref=e3]',
    ]);
  });

  it("skips nodes with role=none", () => {
    const nodes = [
      { role: { value: "none" }, name: { value: "div" } },
      { role: { value: "button" }, name: { value: "OK" } },
    ];
    const result = formatAccessibilityTree(nodes);
    expect(result).toEqual(['- button "OK" [ref=e1]']);
  });

  it("skips nodes with role=generic", () => {
    const nodes = [
      { role: { value: "generic" }, name: { value: "span" } },
      { role: { value: "link" }, name: { value: "About" } },
    ];
    const result = formatAccessibilityTree(nodes);
    expect(result).toEqual(['- link "About" [ref=e1]']);
  });

  it("skips InlineTextBox nodes", () => {
    const nodes = [
      { role: { value: "InlineTextBox" }, name: { value: "text" } },
      { role: { value: "heading" }, name: { value: "Title" } },
    ];
    const result = formatAccessibilityTree(nodes);
    expect(result).toEqual(['- heading "Title" [ref=e1]']);
  });

  it("skips StaticText nodes without a name", () => {
    const nodes = [
      { role: { value: "StaticText" }, name: {} },
      { role: { value: "StaticText" }, name: { value: "Hello" } },
    ];
    const result = formatAccessibilityTree(nodes);
    expect(result).toEqual(['- StaticText "Hello" [ref=e1]']);
  });

  it("skips ignored nodes", () => {
    const nodes = [
      { role: { value: "button" }, name: { value: "Hidden" }, ignored: true },
      { role: { value: "button" }, name: { value: "Visible" } },
    ];
    const result = formatAccessibilityTree(nodes);
    expect(result).toEqual(['- button "Visible" [ref=e1]']);
  });

  it("formats node without name", () => {
    const nodes = [{ role: { value: "separator" } }];
    const result = formatAccessibilityTree(nodes);
    expect(result).toEqual(["- separator [ref=e1]"]);
  });

  it("returns empty tree when all nodes are filtered out", () => {
    const nodes = [
      { role: { value: "none" }, name: { value: "div" } },
      { role: { value: "generic" }, name: { value: "span" } },
    ];
    expect(formatAccessibilityTree(nodes)).toEqual(["(empty tree)"]);
  });
});
