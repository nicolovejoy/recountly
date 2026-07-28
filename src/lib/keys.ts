// Whether an Escape keypress belongs to the focused control rather than
// page-level navigation: text-editing elements own Esc (dismiss autocomplete,
// cancel composition), and <select> uses it to close its native dropdown.
const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function isEditableTarget(
  tagName: string | undefined,
  isContentEditable: boolean | undefined,
): boolean {
  if (isContentEditable) return true;
  return tagName !== undefined && EDITABLE_TAGS.has(tagName.toUpperCase());
}
