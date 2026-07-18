"use client";

// Page-photo attach (physical-journal archive): a camera/library input plus
// removable thumbnails for the photos that will save with the current entry.
// Presentational — RecorderClient owns the pending list, runs the (load-
// bearing) downscale on add, and clears the tray only after a SUCCESSFUL
// save: photos are not best-effort, so a failed save keeps them for retry.

import { useRef } from "react";

export interface TrayPhoto {
  key: number;
  previewUrl: string;
}

export default function PhotoTray({
  photos,
  busy,
  onAdd,
  onRemove,
}: {
  photos: TrayPhoto[];
  /** True while an added file is still downscaling. */
  busy: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (key: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onAdd(files);
          e.target.value = ""; // allow re-picking the same file
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="rounded-lg border border-foreground/20 px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:bg-foreground/[0.06] disabled:opacity-50"
      >
        {busy ? "Processing…" : "📷 Add page photo"}
      </button>
      <ul className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <li key={p.key} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview; next/image can't optimize blob: URLs */}
            <img
              src={p.previewUrl}
              alt="Attached page"
              className="h-16 w-16 rounded-lg border border-foreground/10 object-cover"
            />
            <button
              type="button"
              onClick={() => onRemove(p.key)}
              aria-label="Remove photo"
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-foreground/20 bg-background text-[10px] leading-none text-foreground/70 hover:bg-foreground/[0.08]"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
