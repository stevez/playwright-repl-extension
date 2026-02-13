import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("content/recorder.js", () => {
  let debugSpy;

  beforeEach(() => {
    // Reset the recorder state
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    // Spy on console.debug (the recorder uses it to send commands)
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    // Clean up if recorder is active
    if (window.__pwRecorderCleanup) {
      window.__pwRecorderCleanup();
    }
    debugSpy.mockRestore();
  });

  it("sets __pwRecorderActive on load", async () => {
    await import("../content/recorder.js");
    expect(window.__pwRecorderActive).toBe(true);
  });

  it("provides a cleanup function", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;
    await import("../content/recorder.js");
    expect(typeof window.__pwRecorderCleanup).toBe("function");
  });

  it("does not run twice when __pwRecorderActive is set", async () => {
    window.__pwRecorderActive = true;
    const cleanupBefore = window.__pwRecorderCleanup;
    await import("../content/recorder.js");
    // Cleanup should not be set (skipped due to guard)
    expect(window.__pwRecorderCleanup).toBe(cleanupBefore);
  });

  it("cleanup resets __pwRecorderActive", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;
    await import("../content/recorder.js");
    expect(window.__pwRecorderActive).toBe(true);
    window.__pwRecorderCleanup();
    expect(window.__pwRecorderActive).toBe(false);
  });

  it("cleanup removes __pwRecorderCleanup", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;
    await import("../content/recorder.js");
    window.__pwRecorderCleanup();
    expect(window.__pwRecorderCleanup).toBeUndefined();
  });

  it("records click events", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<button id="test-btn">Submit</button>';

    await import("../content/recorder.js");

    const btn = document.getElementById("test-btn");
    btn.click();

    expect(debugSpy).toHaveBeenCalledWith("__pw:click \"Submit\"");
  });

  it("records checkbox check/uncheck", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="checkbox" id="test-cb" aria-label="Accept">';

    await import("../content/recorder.js");

    const cb = document.getElementById("test-cb");
    cb.checked = true;
    cb.dispatchEvent(new Event("click", { bubbles: true }));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:check")
    );
  });

  it("records checkbox uncheck when unchecked", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="checkbox" id="test-cb" aria-label="Accept" checked>';

    await import("../content/recorder.js");

    const cb = document.getElementById("test-cb");
    cb.checked = false;
    cb.dispatchEvent(new Event("click", { bubbles: true }));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:uncheck")
    );
  });

  it("records radio button clicks", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="radio" id="test-radio" aria-label="Option A">';

    await import("../content/recorder.js");

    const radio = document.getElementById("test-radio");
    radio.dispatchEvent(new Event("click", { bubbles: true }));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:click")
    );
  });

  it("records select changes", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = `
      <select id="test-sel" aria-label="Color">
        <option value="r">Red</option>
        <option value="b">Blue</option>
      </select>
    `;

    await import("../content/recorder.js");

    const sel = document.getElementById("test-sel");
    sel.value = "b";
    sel.dispatchEvent(new Event("change", { bubbles: true }));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:select")
    );
  });

  it("records special key presses", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    await import("../content/recorder.js");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(debugSpy).toHaveBeenCalledWith("__pw:press Enter");
  });

  it("records Tab key press", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    await import("../content/recorder.js");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

    expect(debugSpy).toHaveBeenCalledWith("__pw:press Tab");
  });

  it("records Escape key press", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    await import("../content/recorder.js");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(debugSpy).toHaveBeenCalledWith("__pw:press Escape");
  });

  it("does not record non-special key presses", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    await import("../content/recorder.js");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    const pwCalls = debugSpy.mock.calls.filter(c => String(c[0]).startsWith("__pw:"));
    expect(pwCalls).toHaveLength(0);
  });

  it("skips clicks on text input elements", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="text" id="test-input">';

    await import("../content/recorder.js");

    const input = document.getElementById("test-input");
    input.click();

    const pwCalls = debugSpy.mock.calls.filter(c => String(c[0]).startsWith("__pw:"));
    expect(pwCalls).toHaveLength(0);
  });

  it("skips clicks on textarea elements", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<textarea id="test-ta"></textarea>';

    await import("../content/recorder.js");

    document.getElementById("test-ta").click();

    const pwCalls = debugSpy.mock.calls.filter(c => String(c[0]).startsWith("__pw:"));
    expect(pwCalls).toHaveLength(0);
  });

  it("records input events as debounced fill commands", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="text" id="test-input" aria-label="Username">';

    await import("../content/recorder.js");

    const input = document.getElementById("test-input");
    input.value = "alice";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Should not send immediately (debounced at 1500ms)
    const pwCallsBefore = debugSpy.mock.calls.filter(c => String(c[0]).startsWith("__pw:"));
    expect(pwCallsBefore).toHaveLength(0);

    // After debounce timer fires
    vi.advanceTimersByTime(1500);

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:fill")
    );
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("alice")
    );

    vi.useRealTimers();
  });

  it("debounce resets on new input events", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="text" id="test-input" aria-label="Name">';

    await import("../content/recorder.js");

    const input = document.getElementById("test-input");

    // Type "al" then wait a bit, then "ice"
    input.value = "al";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(500); // not enough to trigger

    input.value = "alice";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(500); // still waiting for debounce from last input

    const pwCallsBefore = debugSpy.mock.calls.filter(c => String(c[0]).startsWith("__pw:"));
    expect(pwCallsBefore).toHaveLength(0);

    vi.advanceTimersByTime(1000); // Now total 1500ms from last input

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("alice")
    );
    // Should only be called once (debounced)
    const pwCalls = debugSpy.mock.calls.filter(c => String(c[0]).startsWith("__pw:"));
    expect(pwCalls).toHaveLength(1);

    vi.useRealTimers();
  });

  it("flushes pending fill on click", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = `
      <input type="text" id="test-input" aria-label="Name">
      <button id="test-btn">Submit</button>
    `;

    await import("../content/recorder.js");

    const input = document.getElementById("test-input");
    input.value = "bob";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Click button before debounce fires
    const btn = document.getElementById("test-btn");
    btn.click();

    // Fill should have been flushed, then click recorded
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:fill")
    );
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:click")
    );

    vi.useRealTimers();
  });

  it("flushes pending fill on special key press", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="text" id="test-input" aria-label="Search">';

    await import("../content/recorder.js");

    const input = document.getElementById("test-input");
    input.value = "query";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Press Enter before debounce
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    // Fill should have been flushed, then Enter recorded
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:fill")
    );
    expect(debugSpy).toHaveBeenCalledWith("__pw:press Enter");

    vi.useRealTimers();
  });

  it("cleanup flushes pending fill", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="text" id="test-input" aria-label="Email">';

    await import("../content/recorder.js");

    const input = document.getElementById("test-input");
    input.value = "test@test.com";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Cleanup should flush pending fill
    window.__pwRecorderCleanup();

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("__pw:fill")
    );

    vi.useRealTimers();
  });

  it("ignores input events on checkbox and radio", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="checkbox" id="test-cb">';

    await import("../content/recorder.js");

    const cb = document.getElementById("test-cb");
    cb.dispatchEvent(new Event("input", { bubbles: true }));

    const pwCalls = debugSpy.mock.calls.filter(c => String(c[0]).startsWith("__pw:"));
    expect(pwCalls).toHaveLength(0);
  });

  it("uses aria-label for locator", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<button aria-label="Close dialog">X</button>';

    await import("../content/recorder.js");

    document.querySelector("button").click();

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('__pw:click "Close dialog"')
    );
  });

  it("uses label[for] for input locator", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = `
      <label for="email-input">Email Address</label>
      <input type="text" id="email-input">
    `;

    await import("../content/recorder.js");

    const input = document.getElementById("email-input");
    input.value = "test";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(1500);

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("Email Address")
    );

    vi.useRealTimers();
  });

  it("uses placeholder for input locator when no label", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="text" id="test" placeholder="Search...">';

    await import("../content/recorder.js");

    const input = document.getElementById("test");
    input.value = "query";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(1500);

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("Search...")
    );

    vi.useRealTimers();
  });

  it("records link clicks with text content", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<a href="#" id="test-link">About Us</a>';

    await import("../content/recorder.js");

    document.getElementById("test-link").click();

    expect(debugSpy).toHaveBeenCalledWith('__pw:click "About Us"');
  });

  it("ignores change events on non-select elements", async () => {
    vi.resetModules();
    delete window.__pwRecorderActive;
    delete window.__pwRecorderCleanup;

    document.body.innerHTML = '<input type="text" id="test">';

    await import("../content/recorder.js");

    document.getElementById("test").dispatchEvent(new Event("change", { bubbles: true }));

    const pwCalls = debugSpy.mock.calls.filter(c => String(c[0]).startsWith("__pw:"));
    expect(pwCalls).toHaveLength(0);
  });
});
