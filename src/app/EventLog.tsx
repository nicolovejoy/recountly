"use client";

// Raw realtime-event log behind a <details>. Spike debris by origin, but kept
// deliberately through the pause/resume work as the debugging window into the
// OpenAI session (this repo has been burned by opaque realtime failures — see
// the model-name/504 gotcha in api/realtime-token/route.ts). Delete this
// component + the hook's log/pushLog once pause/resume has shipped and proven
// stable.

import type { LogLine } from "./useRecorder";

export default function EventLog({ log }: { log: LogLine[] }) {
  return (
    <details className="text-xs text-foreground/50">
      <summary className="cursor-pointer select-none">raw event log</summary>
      <ul className="mt-2 space-y-1 font-mono">
        {log.map((l) => (
          <li key={l.id} className="truncate">
            <span className="text-foreground/70">{l.type}</span>
            {l.text ? <span className="text-foreground/40"> — {l.text}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
