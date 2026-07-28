"use client";

// Esc moves you "up" a level (owner request 2026-07-28): entry → its journal,
// journal/Unfiled/trash → Library. Each view passes its own handler, which
// may first consume the press to close an open panel/picker before
// navigating. Presses inside inputs/textareas/selects (and anything that
// preventDefaults, e.g. the recorder's Esc-to-pause) are left alone.

import { useEffect, useRef } from "react";
import { isEditableTarget } from "@/lib/keys";

export function useEscUp(onEsc: () => void) {
  const handlerRef = useRef(onEsc);
  useEffect(() => {
    handlerRef.current = onEsc;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (isEditableTarget(target?.tagName, target?.isContentEditable)) return;
      handlerRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
