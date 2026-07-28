import { describe, expect, it } from "vitest";
import { isEditableTarget } from "./keys";

describe("isEditableTarget", () => {
  it("claims Esc for text inputs, textareas, and selects", () => {
    expect(isEditableTarget("INPUT", false)).toBe(true);
    expect(isEditableTarget("TEXTAREA", false)).toBe(true);
    expect(isEditableTarget("SELECT", false)).toBe(true);
  });

  it("is case-insensitive on tag names", () => {
    expect(isEditableTarget("input", false)).toBe(true);
    expect(isEditableTarget("select", undefined)).toBe(true);
  });

  it("claims Esc for contentEditable regardless of tag", () => {
    expect(isEditableTarget("DIV", true)).toBe(true);
    expect(isEditableTarget(undefined, true)).toBe(true);
  });

  it("leaves Esc to the page for buttons, links, and body", () => {
    expect(isEditableTarget("BUTTON", false)).toBe(false);
    expect(isEditableTarget("A", false)).toBe(false);
    expect(isEditableTarget("BODY", false)).toBe(false);
    expect(isEditableTarget(undefined, undefined)).toBe(false);
  });
});
