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
