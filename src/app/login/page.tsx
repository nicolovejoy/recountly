"use client";

// Owner login. Email + password only (sign-up is disabled — the single account
// is seeded out-of-band). On success, return to wherever the gate bounced from
// (?from=…) or the home recorder. This page is allowlisted in proxy.ts.

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";

// useSearchParams() forces a Suspense boundary at build time (Next 16), so the
// form lives in a child and the page wraps it.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      setError(error.message || "Sign-in failed");
      setBusy(false);
      return;
    }
    router.replace(from);
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">recountly</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          autoComplete="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-foreground/15 bg-transparent p-3 outline-none focus:border-foreground/40"
        />
        <input
          type="password"
          autoComplete="current-password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-foreground/15 bg-transparent p-3 outline-none focus:border-foreground/40"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-foreground/90 p-3 font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
