"use client";

// The editable type-and-talk transcript. The textarea is deliberately
// UNCONTROLLED — the user types freely, and finalized spoken segments are
// appended imperatively via the handle so React never rewrites the value (a
// remount would wipe the user's text; keep this component unconditionally
// mounted and unkeyed). All caret-preservation logic is the pure, unit-tested
// planAppend (src/lib/transcript.ts); this component just applies the plan to
// the real DOM node. getValue() is the read side for the upcoming save step.

import { useImperativeHandle, useRef, type Ref } from "react";
import { planAppend } from "@/lib/transcript";

export interface TranscriptEditorHandle {
  /** Append a finalized spoken segment without disturbing the user's caret. */
  append(segment: string): void;
  /** Current transcript text (typed + spoken). */
  getValue(): string;
  /** Empty the editor (after a save, so the next entry starts fresh). */
  clear(): void;
}

export default function TranscriptEditor({
  ref,
  interim,
}: {
  ref: Ref<TranscriptEditorHandle>;
  interim: string;
}) {
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useImperativeHandle(ref, () => ({
    append(segment: string) {
      const ta = textRef.current;
      if (!ta) return;
      const plan = planAppend(ta.value, ta.selectionStart, ta.selectionEnd, segment);
      ta.value = plan.value;
      ta.selectionStart = plan.selectionStart;
      ta.selectionEnd = plan.selectionEnd;
      if (plan.followTail) ta.scrollTop = ta.scrollHeight;
    },
    getValue() {
      return textRef.current?.value ?? "";
    },
    clear() {
      if (textRef.current) textRef.current.value = "";
    },
  }), []);

  return (
    <div className="flex flex-1 flex-col gap-1">
      <textarea
        ref={textRef}
        placeholder="Type or talk — your words appear here…"
        aria-label="Transcript"
        className="min-h-48 w-full flex-1 resize-none rounded-xl border border-foreground/10 bg-transparent p-4 text-lg leading-relaxed outline-none placeholder:text-foreground/30 focus:border-foreground/30"
      />
      {interim && (
        <p className="px-4 text-lg leading-relaxed text-foreground/40">{interim}</p>
      )}
    </div>
  );
}
