import { describe, it, expect } from "vitest";
import { appendSegment } from "./transcript";

describe("appendSegment", () => {
  it("returns the segment when prev is empty", () => {
    expect(appendSegment("", "Hello")).toBe("Hello");
  });

  it("joins prev and segment with a single space", () => {
    expect(appendSegment("Hello", "world")).toBe("Hello world");
  });

  it("does not create a double space when prev already ends in a space", () => {
    expect(appendSegment("Hello ", "world")).toBe("Hello world");
  });

  it("adds no separator after a trailing newline", () => {
    expect(appendSegment("Hello\n", "world")).toBe("Hello\nworld");
  });

  it("trims surrounding whitespace from the incoming segment", () => {
    expect(appendSegment("Hello", "  world  ")).toBe("Hello world");
  });

  it("leaves prev unchanged when the segment is blank", () => {
    expect(appendSegment("Hello", "   ")).toBe("Hello");
  });

  it("keeps the user's existing punctuation", () => {
    expect(appendSegment("Hello.", "World")).toBe("Hello. World");
  });
});

// planAppend is the caret-preservation decision, extracted pure so it's
// testable without a DOM: given the textarea's current value + selection and
// a finalized segment, it returns the next value, where the selection should
// land, and whether the view should follow the tail. The component just
// applies the plan to the real <textarea>.
import { planAppend } from "./transcript";

describe("planAppend", () => {
  it("follows the tail when the caret is at the end", () => {
    expect(planAppend("Hello", 5, 5, "world")).toEqual({
      value: "Hello world",
      selectionStart: 11,
      selectionEnd: 11,
      followTail: true,
    });
  });

  it("follows the tail on an empty transcript (unfocused textarea reports 0,0)", () => {
    expect(planAppend("", 0, 0, "Hello")).toEqual({
      value: "Hello",
      selectionStart: 5,
      selectionEnd: 5,
      followTail: true,
    });
  });

  it("preserves a mid-text caret verbatim and does not follow", () => {
    expect(planAppend("Hello world", 3, 3, "again")).toEqual({
      value: "Hello world again",
      selectionStart: 3,
      selectionEnd: 3,
      followTail: false,
    });
  });

  it("preserves a selection range while a segment appends", () => {
    expect(planAppend("Hello world", 0, 5, "again")).toEqual({
      value: "Hello world again",
      selectionStart: 0,
      selectionEnd: 5,
      followTail: false,
    });
  });

  it("treats a selection touching the end as not-at-end (keeps it intact)", () => {
    const plan = planAppend("Hello", 0, 5, "world");
    expect(plan.selectionStart).toBe(0);
    expect(plan.selectionEnd).toBe(5);
    expect(plan.followTail).toBe(false);
  });

  it("is a no-op on a blank segment, keeping value and selection", () => {
    expect(planAppend("Hello", 2, 2, "   ")).toEqual({
      value: "Hello",
      selectionStart: 2,
      selectionEnd: 2,
      followTail: false,
    });
  });
});
