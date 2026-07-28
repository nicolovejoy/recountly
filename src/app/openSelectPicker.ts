"use client";

// Focus a <select> and, where the browser supports it, pop its dropdown
// immediately — one click to a choice instead of click-to-reveal +
// click-to-open. Safe as a callback ref (null on unmount).

export function openSelectPicker(el: HTMLSelectElement | null) {
  if (!el) return;
  el.focus();
  const picker = el as HTMLSelectElement & { showPicker?: () => void };
  try {
    picker.showPicker?.();
  } catch {
    // NotAllowedError outside a user gesture — focus alone still gives
    // arrow-key/Enter selection.
  }
}
