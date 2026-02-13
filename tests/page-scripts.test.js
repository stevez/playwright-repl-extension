import { describe, it, expect, beforeEach } from "vitest";
import {
  callInPage,
  clickElementByRef,
  clickElementByText,
  focusElement,
  selectElement,
  checkElement,
  hoverElement,
  dblclickElement,
  verifyElementExists,
  verifyTextOnPage,
  dispatchFillEvents,
} from "../lib/page-scripts.js";

describe("callInPage", () => {
  it("wraps a function with no args", () => {
    function greet() { return "hi"; }
    const js = callInPage(greet);
    expect(js).toContain("function greet");
    expect(js.trim()).toMatch(/\(\)$/);
  });

  it("wraps a function with string args", () => {
    function add(a, b) { return a + b; }
    const js = callInPage(add, "hello", "world");
    expect(js).toContain('"hello"');
    expect(js).toContain('"world"');
  });

  it("wraps a function with mixed arg types", () => {
    function test(s, n, b) { return { s, n, b }; }
    const js = callInPage(test, "text", 42, true);
    expect(js).toContain('"text"');
    expect(js).toContain("42");
    expect(js).toContain("true");
  });

  it("handles null args", () => {
    function test(a) { return a; }
    const js = callInPage(test, null);
    expect(js).toContain("null)");
  });

  it("escapes quotes in string args", () => {
    function test(s) { return s; }
    const js = callInPage(test, 'She said "hello"');
    expect(js).toContain('\\"hello\\"');
  });

  it("produces evaluable JS", () => {
    function add(a, b) { return a + b; }
    const js = callInPage(add, 2, 3);
    expect(eval(js)).toBe(5);
  });
});

describe("clickElementByText", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("clicks a button by text", () => {
    document.body.innerHTML = '<button id="btn">Submit</button>';
    let clicked = false;
    document.getElementById("btn").addEventListener("click", () => { clicked = true; });
    const result = clickElementByText("Submit", null);
    expect(result.success).toBe(true);
    expect(result.tag).toBe("button");
    expect(clicked).toBe(true);
  });

  it("clicks a link by text", () => {
    document.body.innerHTML = '<a id="lnk" href="#">About Us</a>';
    const result = clickElementByText("About Us", null);
    expect(result.success).toBe(true);
    expect(result.tag).toBe("a");
  });

  it("finds element by aria-label", () => {
    document.body.innerHTML = '<button aria-label="Close dialog">X</button>';
    const result = clickElementByText("Close dialog", null);
    expect(result.success).toBe(true);
  });

  it("finds element by title", () => {
    document.body.innerHTML = '<button title="Settings">⚙</button>';
    const result = clickElementByText("Settings", null);
    expect(result.success).toBe(true);
  });

  it("returns error for missing element", () => {
    document.body.innerHTML = "<p>Nothing here</p>";
    const result = clickElementByText("Missing Button", null);
    expect(result.error).toContain("No element found");
  });

  it("scopes to container when scopeText is provided", () => {
    document.body.innerHTML = `
      <li>Buy milk <button>delete</button></li>
      <li>Buy eggs <button>delete</button></li>
    `;
    const result = clickElementByText("delete", "Buy eggs");
    expect(result.success).toBe(true);
  });

  it("is case-insensitive", () => {
    document.body.innerHTML = '<button>SUBMIT</button>';
    const result = clickElementByText("submit", null);
    expect(result.success).toBe(true);
  });
});

describe("clickElementByRef", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("clicks the nth element in tree order", () => {
    document.body.innerHTML = "<div><span>A</span><span>B</span><span>C</span></div>";
    const result = clickElementByRef(2, "e3");
    expect(result.success).toBe(true);
    expect(result.tag).toBe("span");
  });

  it("returns error for out-of-range index", () => {
    document.body.innerHTML = "<div><span>A</span></div>";
    const result = clickElementByRef(999, "e1000");
    expect(result.error).toContain("not found");
  });
});

describe("focusElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("focuses input by placeholder", () => {
    document.body.innerHTML = '<input type="text" placeholder="Search...">';
    const result = focusElement("Search...");
    expect(result.success).toBe(true);
  });

  it("focuses input by label", () => {
    document.body.innerHTML = `
      <label for="email-input">Email Address</label>
      <input type="text" id="email-input">
    `;
    const result = focusElement("Email Address");
    expect(result.success).toBe(true);
  });

  it("focuses input by aria-label", () => {
    document.body.innerHTML = '<input type="text" aria-label="Username">';
    const result = focusElement("Username");
    expect(result.success).toBe(true);
  });

  it("returns error for missing input", () => {
    document.body.innerHTML = "<p>No inputs</p>";
    const result = focusElement("Missing");
    expect(result.error).toContain("No input found");
  });
});

describe("selectElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("selects option by aria-label", () => {
    document.body.innerHTML = `
      <select aria-label="Color">
        <option value="r">Red</option>
        <option value="b">Blue</option>
      </select>
    `;
    const result = selectElement("Color", "Blue");
    expect(result.success).toBe(true);
    expect(document.querySelector("select").value).toBe("b");
  });

  it("selects option by label text", () => {
    document.body.innerHTML = `
      <label for="country">Country</label>
      <select id="country">
        <option value="us">United States</option>
        <option value="uk">United Kingdom</option>
      </select>
    `;
    const result = selectElement("Country", "United Kingdom");
    expect(result.success).toBe(true);
    expect(document.getElementById("country").value).toBe("uk");
  });

  it("returns error for missing select", () => {
    document.body.innerHTML = "<p>No select</p>";
    const result = selectElement("Color", "Red");
    expect(result.error).toContain("No select found");
  });

  it("returns error for missing option", () => {
    document.body.innerHTML = `
      <select aria-label="Color">
        <option value="r">Red</option>
      </select>
    `;
    const result = selectElement("Color", "Green");
    expect(result.error).toContain("Option not found");
  });
});

describe("checkElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("checks a checkbox by label", () => {
    document.body.innerHTML = `
      <label for="cb">Accept terms</label>
      <input type="checkbox" id="cb">
    `;
    const result = checkElement("Accept terms", true);
    expect(result.success).toBe(true);
  });

  it("checks a checkbox by aria-label", () => {
    document.body.innerHTML = '<input type="checkbox" aria-label="Remember me">';
    const result = checkElement("Remember me", true);
    expect(result.success).toBe(true);
  });

  it("finds checkbox in list item by text", () => {
    document.body.innerHTML = `
      <li>Buy milk <input type="checkbox"></li>
    `;
    const result = checkElement("Buy milk", true);
    expect(result.success).toBe(true);
  });

  it("returns error for missing checkbox", () => {
    document.body.innerHTML = "<p>No checkboxes</p>";
    const result = checkElement("Missing", true);
    expect(result.error).toContain("No checkbox found");
  });
});

describe("hoverElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns coordinates for a button", () => {
    document.body.innerHTML = '<button>Menu</button>';
    const result = hoverElement("Menu");
    expect(result).toHaveProperty("x");
    expect(result).toHaveProperty("y");
  });

  it("returns error for missing element", () => {
    document.body.innerHTML = "<p>Nothing</p>";
    const result = hoverElement("Missing");
    expect(result.error).toContain("No element found");
  });
});

describe("dblclickElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("dispatches dblclick on element", () => {
    document.body.innerHTML = '<button id="btn">Item</button>';
    let dblClicked = false;
    document.getElementById("btn").addEventListener("dblclick", () => { dblClicked = true; });
    const result = dblclickElement("Item");
    expect(result.success).toBe(true);
    expect(dblClicked).toBe(true);
  });

  it("returns error for missing element", () => {
    document.body.innerHTML = "<p>Nothing</p>";
    const result = dblclickElement("Missing");
    expect(result.error).toContain("No element found");
  });
});

describe("verifyElementExists", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns true when button exists", () => {
    document.body.innerHTML = '<button>Submit</button>';
    expect(verifyElementExists("Submit")).toBe(true);
  });

  it("returns true for element with aria-label", () => {
    document.body.innerHTML = '<button aria-label="Close">X</button>';
    expect(verifyElementExists("Close")).toBe(true);
  });

  it("returns false when element is missing", () => {
    document.body.innerHTML = "<p>Nothing</p>";
    expect(verifyElementExists("Missing Button")).toBe(false);
  });

  it("finds label elements", () => {
    document.body.innerHTML = '<label>Email</label>';
    expect(verifyElementExists("Email")).toBe(true);
  });
});

describe("verifyTextOnPage", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns true when text is present", () => {
    document.body.innerHTML = "<p>Hello World</p>";
    expect(verifyTextOnPage("Hello")).toBe(true);
  });

  it("returns false when text is absent", () => {
    document.body.innerHTML = "<p>Hello World</p>";
    expect(verifyTextOnPage("Goodbye")).toBe(false);
  });
});

describe("dispatchFillEvents", () => {
  it("dispatches input and change events on activeElement", () => {
    document.body.innerHTML = '<input type="text" id="field">';
    const field = document.getElementById("field");
    field.focus();
    let inputFired = false;
    let changeFired = false;
    field.addEventListener("input", () => { inputFired = true; });
    field.addEventListener("change", () => { changeFired = true; });
    dispatchFillEvents();
    expect(inputFired).toBe(true);
    expect(changeFired).toBe(true);
  });
});
