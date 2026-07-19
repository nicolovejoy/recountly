"use client";

// Capture guard context (issue #29). RecorderClient reports whether a session
// is in flight (via isCaptureBusy); TabBar reads it to disable Library/Search —
// navigating away would unmount the recorder page and kill the session, so
// blocking the tabs is the simplest correct thing. Known limit (accepted):
// browser back / typed URLs still navigate; the guard covers the tabs, which
// are the only in-app affordance.

import { createContext, useContext, useMemo, useState } from "react";

interface CaptureGuard {
  busy: boolean;
  setBusy: (b: boolean) => void;
}

const CaptureGuardContext = createContext<CaptureGuard | null>(null);

export function CaptureGuardProvider({ children }: { children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const value = useMemo(() => ({ busy, setBusy }), [busy]);
  return <CaptureGuardContext.Provider value={value}>{children}</CaptureGuardContext.Provider>;
}

export function useCaptureGuard(): CaptureGuard {
  const ctx = useContext(CaptureGuardContext);
  if (!ctx) throw new Error("useCaptureGuard must be used inside CaptureGuardProvider");
  return ctx;
}
