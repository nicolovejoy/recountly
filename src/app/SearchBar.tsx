"use client";

// Presentational search controls (Phase 3): a free-text box + an inclusive
// recorded_at date range. State lives in EntryList; this just renders inputs and
// reports changes. The query is debounced upstream before it hits the API.

type Filters = { query: string; from: string; to: string };

export default function SearchBar({
  query,
  from,
  to,
  onChange,
  onClear,
}: Filters & {
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}) {
  const hasFilters = Boolean(query || from || to);
  const field =
    "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40";

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={query}
        onChange={(e) => onChange({ query: e.target.value })}
        placeholder="Search transcripts…"
        aria-label="Search transcripts"
        className={field}
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/50">
        <label className="flex items-center gap-1">
          <span>From</span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => onChange({ from: e.target.value })}
            aria-label="From date"
            className={field}
          />
        </label>
        <label className="flex items-center gap-1">
          <span>To</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => onChange({ to: e.target.value })}
            aria-label="To date"
            className={field}
          />
        </label>
        {hasFilters && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto rounded-lg px-2 py-1 text-foreground/50 underline-offset-2 hover:text-foreground/80 hover:underline"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
