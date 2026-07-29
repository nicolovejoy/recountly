"use client";

// App-wide confirm dialog: an accessible, styled replacement for the browser's
// native confirm(). Mounted once (in (tabs)/layout.tsx); any client view calls
// `const confirm = useConfirm()` and awaits it like the native prompt:
//   if (!(await confirm({ title, message, confirmLabel, tone: "danger" }))) return;
// State lives in the pure createConfirmController (src/lib/confirm-controller.ts);
// this file is only the React binding + presentation.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createConfirmController,
  type ConfirmOptions,
  type ConfirmState,
} from "@/lib/confirm-controller";
import { wrapIndex } from "@/lib/focus-trap";

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  // Lazy init: one stable controller for the provider's lifetime (a ref would
  // trip react-hooks/refs when read during render).
  const [controller] = useState(createConfirmController);

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState, // server: no dialog open
  );

  return (
    <ConfirmContext.Provider value={controller.confirm}>
      {children}
      {state && (
        <ConfirmDialog
          state={state}
          onConfirm={() => controller.resolve(true)}
          onCancel={() => controller.resolve(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside ConfirmProvider");
  return confirm;
}

function ConfirmDialog({
  state,
  onConfirm,
  onCancel,
}: {
  state: ConfirmState;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // The element focused when the dialog opened, restored when it closes.
  const triggerRef = useRef<HTMLElement | null>(null);

  const titleId = `confirm-title-${state.id}`;
  const messageId = state.message ? `confirm-message-${state.id}` : undefined;

  // Default focus on Cancel (a stray Enter must never destroy data); remember
  // the trigger and restore focus to it on close. Keyed by id so re-opening a
  // fresh dialog re-runs setup.
  useEffect(() => {
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => {
      triggerRef.current?.focus();
    };
  }, [state.id]);

  // Esc + Tab are handled in the CAPTURE phase. useEscUp (src/app/useEscUp.ts)
  // is a BUBBLE-phase window listener that bails on e.defaultPrevented; capture
  // runs first, so preventDefault() here stops Esc from ALSO navigating "up" a
  // level behind the dialog. isEditableTarget does NOT save us — the dialog's
  // buttons aren't editable targets — the preventDefault is what's load-bearing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        const order = [cancelRef.current, confirmRef.current];
        const current = order.indexOf(document.activeElement as HTMLButtonElement);
        if (current === -1) return; // focus escaped the trap somehow; leave it
        e.preventDefault();
        order[wrapIndex(current, order.length, e.shiftKey)]?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const dangerous = state.tone === "danger";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5"
      // Backdrop click cancels — but only when the press starts on the backdrop
      // itself, so a text-selection drag inside the panel can't close it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="w-full max-w-sm rounded-2xl border border-hairline-strong bg-surface-raised p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-base font-semibold text-foreground">
          {state.title}
        </h2>
        {state.message && (
          <p id={messageId} className="mt-2 text-sm text-body">
            {state.message}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm text-muted outline-none hover:text-body focus-visible:ring-1 focus-visible:ring-accent"
          >
            {state.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-1 ${
              dangerous
                ? "bg-danger focus-visible:ring-danger"
                : "bg-accent-strong focus-visible:ring-accent"
            }`}
          >
            {state.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
