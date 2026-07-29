// Framework-agnostic state core for the app's confirm dialog. Holds the single
// open dialog's presentation state and the promise the caller is awaiting, so
// `useConfirm()` can be a drop-in for the browser's native confirm():
//   if (!(await confirm({ title, message, tone: "danger" }))) return;
// The React layer (ConfirmDialog.tsx) subscribes for renders and calls resolve()
// on the user's choice. Kept pure (no React) so it's unit-testable in the node
// env — there is no jsdom here.

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
}

// The open dialog's state. `id` changes per open so the view can re-run focus
// setup and mint unique aria ids.
export interface ConfirmState extends ConfirmOptions {
  id: number;
}

export interface ConfirmController {
  subscribe(listener: () => void): () => void;
  getState(): ConfirmState | null;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  // Called by the view when the user confirms (true) or cancels (false).
  resolve(result: boolean): void;
}

export function createConfirmController(): ConfirmController {
  let state: ConfirmState | null = null;
  let resolver: ((result: boolean) => void) | null = null;
  let nextId = 1;
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) listener();
  }

  function settle(result: boolean) {
    if (!resolver) return;
    const resolve = resolver;
    resolver = null;
    state = null;
    emit();
    resolve(result);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState() {
      return state;
    },
    confirm(opts) {
      // Only one dialog is ever open: a fresh request cancels the pending one
      // (resolves it false) before taking its place.
      if (resolver) settle(false);
      return new Promise<boolean>((resolve) => {
        resolver = resolve;
        state = { id: nextId++, ...opts };
        emit();
      });
    },
    resolve(result) {
      settle(result);
    },
  };
}
