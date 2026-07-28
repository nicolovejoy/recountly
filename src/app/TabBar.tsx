"use client";

// Bottom tab bar (issue #29). Which tab is active comes from the pure
// activeTab(pathname); while the capture guard reports a session in flight,
// Library/Search render inert (see CaptureGuard.tsx for why blocking beats a
// confirm dialog).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, activeTab } from "@/lib/tabs";
import { useCaptureGuard } from "./CaptureGuard";

export default function TabBar() {
  const pathname = usePathname();
  const active = activeTab(pathname);
  const { busy } = useCaptureGuard();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-foreground/15 bg-background shadow-[0_-2px_10px_rgba(0,0,0,0.08)] pb-[env(safe-area-inset-bottom)]">
      {busy && (
        <p className="pt-1.5 text-center text-[11px] text-foreground/50">
          Recording in progress — tap Done before leaving
        </p>
      )}
      <ul className="mx-auto flex w-full max-w-2xl">
        {TABS.map(({ tab, href, label }) => {
          const isActive = tab === active;
          const inert = busy && tab !== "capture";
          // The border-t-2 doubles as the active-tab indicator line, sitting
          // just under the nav's own hairline border.
          const base = `block border-t-2 py-3 text-center text-sm ${
            isActive
              ? "border-foreground font-semibold text-foreground"
              : "border-transparent text-foreground/50"
          }`;
          return (
            <li key={tab} className="flex-1">
              {inert ? (
                <span aria-disabled="true" className={`${base} opacity-40`}>
                  {label}
                </span>
              ) : (
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={`${base} transition-colors hover:text-foreground`}
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
