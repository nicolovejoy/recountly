"use client";

// Issue #23 Task 9 — mounts once in the tabs layout. On mount, retries any
// pending saves left in IndexedDB by a prior session that crashed/was
// discarded between "Done was tapped" and "the 201 landed" (see
// src/lib/pending-save.ts + src/app/RecorderClient.tsx). Shows a toast when
// at least one recovers — mirrors RecorderClient's fixed top-of-viewport
// toast idiom (visible above the fold on a phone, auto-clears).

import { useEffect, useState } from "react";
import { upload } from "@vercel/blob/client";
import { retryPending } from "@/lib/pending-save";
import { uploadEntryBlobs } from "@/lib/blob-upload";
import type { SaveRequestBody } from "@/lib/save-payload";
import { idbPendingStore } from "./idb-pending";

export default function PendingSaveRecovery() {
  const [recovered, setRecovered] = useState(0);

  useEffect(() => {
    // IndexedDB is unavailable in some private-browsing modes — recovery is
    // a bonus on top of the normal save flow, never allowed to throw here.
    if (typeof indexedDB === "undefined") return;
    let cancelled = false;
    void retryPending(idbPendingStore, {
      uploadBlobs: uploadEntryBlobs,
      upload,
      postSave: async (body: SaveRequestBody) => {
        const res = await fetch("/api/entries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return { ok: res.ok, status: res.status };
      },
    })
      .then(({ recovered: n }) => {
        if (!cancelled && n > 0) setRecovered(n);
      })
      .catch(() => {
        // Best-effort: a failed recovery attempt just leaves the records for
        // the next app open.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (recovered === 0) return;
    const t = setTimeout(() => setRecovered(0), 4000);
    return () => clearTimeout(t);
  }, [recovered]);

  if (recovered === 0) return null;

  return (
    <div className="fixed inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top))] z-50 flex justify-center px-4">
      <p className="rounded-full border border-foreground/15 bg-background px-4 py-1.5 text-sm text-green-600 shadow-lg">
        Recovered {recovered} unsaved {recovered === 1 ? "entry" : "entries"}
      </p>
    </div>
  );
}
