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
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-foreground/10 bg-background pb-[env(safe-area-inset-bottom)]">
      {busy && (
        <p className="pt-1.5 text-center text-[11px] text-foreground/50">
          Recording in progress — tap Done before leaving
        </p>
      )}
      <ul className="mx-auto flex w-full max-w-2xl">
        {TABS.map(({ tab, href, label }) => {
          const isActive = tab === active;
          const inert = busy && tab !== "capture";
          const base = `block py-3 text-center text-sm ${
            isActive ? "font-medium text-foreground" : "text-foreground/50"
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
