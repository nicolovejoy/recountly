"use client";

// Desktop top-nav (issue #35): horizontal link row in the sticky header,
// shown at md+ as a sibling to the phone-only bottom TabBar. Deliberately a
// thin renderer over the SAME source of truth as TabBar — TABS/activeTab
// from src/lib/tabs.ts — plus the same capture-guard busy/inert behavior
// (navigating away mid-recording would unmount the recorder and kill the
// session; see CaptureGuard.tsx).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, activeTab } from "@/lib/tabs";
import { useCaptureGuard } from "./CaptureGuard";

export default function TopNav() {
  const pathname = usePathname();
  const active = activeTab(pathname);
  const { busy } = useCaptureGuard();

  return (
    <ul className="hidden items-center gap-6 text-sm md:flex">
      {TABS.map(({ tab, href, label }) => {
        const isActive = tab === active;
        const inert = busy && tab !== "capture";
        const className = isActive
          ? "font-semibold text-accent"
          : "text-muted transition-colors hover:text-foreground";
        return (
          <li key={tab}>
            {inert ? (
              <span aria-disabled="true" className={`${className} opacity-40`}>
                {label}
              </span>
            ) : (
              <Link href={href} aria-current={isActive ? "page" : undefined} className={className}>
                {label}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
