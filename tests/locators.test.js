import { describe, it, expect } from "vitest";
import { buildClickElementJS, buildFocusElementJS } from "../lib/locators.js";

describe("buildClickElementJS", () => {
  it("generates code for snapshot ref e1", () => {
    const js = buildClickElementJS("e1");
    expect(js).toContain("elements[0]");
    expect(js).toContain(".click()");
  });

  it("generates code for snapshot ref e8", () => {
    const js = buildClickElementJS("e8");
    expect(js).toContain("elements[7]");
  });

  it("generates code for text locator", () => {
    const js = buildClickElementJS("Submit");
    expect(js).toContain('"Submit"');
    expect(js).toContain(".click()");
    expect(js).toContain("matches");
  });

  it("generates code without scope when scope is null", () => {
    const js = buildClickElementJS("Submit", null);
    expect(js).toContain("scopeText = null");
  });

  it("generates scoped code when scope is provided", () => {
    const js = buildClickElementJS("destroy", "costco");
    expect(js).toContain('"destroy"');
    expect(js).toContain('"costco"');
    expect(js).toContain("scopeText");
    expect(js).toContain("containers");
  });

  it("generates valid IIFE that returns an object", () => {
    const js = buildClickElementJS("Submit");
    // Should be a self-executing function
    expect(js.trim()).toMatch(/^\(\(\) => \{/);
    expect(js.trim()).toMatch(/\}\)\(\)$/);
  });

  it("includes error handling for missing elements", () => {
    const js = buildClickElementJS("Submit");
    expect(js).toContain("error");
    expect(js).toContain("No element found");
  });

  it("includes scrollIntoView before click", () => {
    const js = buildClickElementJS("Submit");
    expect(js).toContain("scrollIntoView");
  });

  it("includes 5 locator strategies for text locators", () => {
    const js = buildClickElementJS("Submit");
    expect(js).toContain("Strategy 1");
    expect(js).toContain("Strategy 2");
    expect(js).toContain("Strategy 3");
    expect(js).toContain("Strategy 4");
    expect(js).toContain("Strategy 5");
  });

  it("uses tree walker for snapshot refs", () => {
    const js = buildClickElementJS("e3");
    expect(js).toContain("createTreeWalker");
    expect(js).toContain("elements[2]");
  });

  it("includes scope error message when scope is provided", () => {
    const js = buildClickElementJS("delete", "costco");
    expect(js).toContain("in");
  });
});

describe("buildFocusElementJS", () => {
  it("generates code for text locator", () => {
    const js = buildFocusElementJS("Email");
    expect(js).toContain('"Email"');
    expect(js).toContain(".focus()");
  });

  it("generates valid IIFE", () => {
    const js = buildFocusElementJS("Search");
    expect(js.trim()).toMatch(/^\(\(\) => \{/);
    expect(js.trim()).toMatch(/\}\)\(\)$/);
  });

  it("searches by placeholder", () => {
    const js = buildFocusElementJS("Search");
    expect(js).toContain("placeholder");
  });

  it("searches by label", () => {
    const js = buildFocusElementJS("Email");
    expect(js).toContain("label");
  });

  it("searches by aria-label", () => {
    const js = buildFocusElementJS("Search");
    expect(js).toContain("aria-label");
  });

  it("includes error handling", () => {
    const js = buildFocusElementJS("Missing");
    expect(js).toContain("error");
    expect(js).toContain("No input found");
  });

  it("calls select() after focus", () => {
    const js = buildFocusElementJS("Field");
    expect(js).toContain(".select");
  });
});
