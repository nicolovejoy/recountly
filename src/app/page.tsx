export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <span
          aria-hidden
          className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground/5 text-3xl"
        >
          🎙️
        </span>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          recountly
        </h1>
        <p className="max-w-xs text-balance text-base text-foreground/60 sm:text-lg">
          Speak, and watch the words appear. Your spoken-word journal.
        </p>
        <p className="mt-4 rounded-full border border-foreground/10 px-4 py-1.5 text-sm text-foreground/50">
          Phase&nbsp;0 · scaffold live. Recording lands next.
        </p>
      </div>
    </main>
  );
}
