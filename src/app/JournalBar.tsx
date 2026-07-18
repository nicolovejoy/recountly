"use client";

// Journal capture context (physical-journal archive): shows which notebook is
// active (the lock — every save defaults to it), lets the owner switch/clear
// it, create a new journal inline, and set the optional written date for the
// page being read. Presentational: all state lives in RecorderClient (written
// date) and the DB via useJournals (list + active lock).

import { useState } from "react";
import type { JournalRecord } from "@/lib/journal";

const NEW_SENTINEL = "__new__";
const NONE_SENTINEL = "__none__";

export default function JournalBar({
  journals,
  active,
  writtenDate,
  onSelect,
  onCreate,
  onWrittenDateChange,
}: {
  journals: JournalRecord[] | null;
  active: JournalRecord | null;
  writtenDate: string;
  onSelect: (id: string | null) => void;
  onCreate: (label: string) => Promise<void>;
  onWrittenDateChange: (date: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const field =
    "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40";

  if (journals === null) return null; // still loading — the bar appears when ready

  async function submitNew() {
    const label = newLabel.trim();
    if (!label) return;
    await onCreate(label);
    setNewLabel("");
    setCreating(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/50">
      <label className="flex items-center gap-1">
        <span>Journal</span>
        <select
          value={active?.id ?? NONE_SENTINEL}
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW_SENTINEL) setCreating(true);
            else onSelect(v === NONE_SENTINEL ? null : v);
          }}
          aria-label="Active journal"
          className={field}
        >
          <option value={NONE_SENTINEL}>none</option>
          {journals.map((j) => (
            <option key={j.id} value={j.id}>
              {j.label}
            </option>
          ))}
          <option value={NEW_SENTINEL}>+ new journal…</option>
        </select>
      </label>

      {creating && (
        <span className="flex items-center gap-1">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitNew();
            }}
            placeholder="Journal label"
            aria-label="New journal label"
            className={field}
          />
          <button
            type="button"
            onClick={() => void submitNew()}
            className="rounded-lg border border-foreground/20 px-2 py-1 hover:bg-foreground/[0.06]"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setNewLabel("");
            }}
            className="px-1 py-1 hover:text-foreground/80"
          >
            Cancel
          </button>
        </span>
      )}

      {active && (
        <label className="flex items-center gap-1">
          <span>Written</span>
          <input
            type="date"
            value={writtenDate}
            onChange={(e) => onWrittenDateChange(e.target.value)}
            aria-label="Date the page was written"
            className={field}
          />
        </label>
      )}
    </div>
  );
}
