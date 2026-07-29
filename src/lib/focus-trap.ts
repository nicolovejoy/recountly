// Tab-cycling math for a modal focus trap. Given the currently-focused
// element's index among the trap's focusable elements, return the index Tab
// (forward) or Shift+Tab (backward) should move to, wrapping at both ends.
// Pure so the dialog's DOM focus handling stays trivial and testable.
export function wrapIndex(current: number, count: number, shiftKey: boolean): number {
  if (count <= 0) return 0;
  const delta = shiftKey ? -1 : 1;
  return (current + delta + count) % count;
}
