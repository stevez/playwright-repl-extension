import { describe, it, expect } from "vitest";
import { parseCommand } from "../lib/commands.js";

describe("parseCommand", () => {
  it("parses a simple command with no args", () => {
    expect(parseCommand("help")).toEqual({ command: "help", args: [] });
  });

  it("parses a command with one arg", () => {
    expect(parseCommand("click Submit")).toEqual({
      command: "click",
      args: ["Submit"],
    });
  });

  it("parses a command with quoted arg", () => {
    expect(parseCommand('click "Sign In"')).toEqual({
      command: "click",
      args: ["Sign In"],
    });
  });

  it("parses fill with two quoted args", () => {
    expect(parseCommand('fill "Email" "test@example.com"')).toEqual({
      command: "fill",
      args: ["Email", "test@example.com"],
    });
  });

  it("parses single-quoted args", () => {
    expect(parseCommand("fill 'Username' 'alice'")).toEqual({
      command: "fill",
      args: ["Username", "alice"],
    });
  });

  it("normalizes command to lowercase", () => {
    expect(parseCommand("GOTO https://example.com")).toEqual({
      command: "goto",
      args: ["https://example.com"],
    });
  });

  it("returns null for empty string", () => {
    expect(parseCommand("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseCommand("   ")).toBeNull();
  });

  it("returns null for comments", () => {
    expect(parseCommand("# this is a comment")).toBeNull();
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseCommand("  click Submit  ")).toEqual({
      command: "click",
      args: ["Submit"],
    });
  });

  it("handles tab-separated tokens", () => {
    expect(parseCommand("click\tSubmit")).toEqual({
      command: "click",
      args: ["Submit"],
    });
  });

  it("handles mixed quoted and unquoted args", () => {
    expect(parseCommand('click "destroy" costco')).toEqual({
      command: "click",
      args: ["destroy", "costco"],
    });
  });

  it("handles URL as argument", () => {
    expect(parseCommand("goto https://demo.playwright.dev/todomvc/")).toEqual({
      command: "goto",
      args: ["https://demo.playwright.dev/todomvc/"],
    });
  });

  it("handles eval with multi-word expression", () => {
    expect(parseCommand("eval document.title")).toEqual({
      command: "eval",
      args: ["document.title"],
    });
  });
});
