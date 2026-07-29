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
    <ul className="hidden items-center gap-1 text-sm md:flex">
      {TABS.map(({ tab, href, label }) => {
        const isActive = tab === active;
        const inert = busy && tab !== "capture";
        // Whole-pill hit area + hover affordance (owner feedback: only the
        // letters were clickable before). Hover bg is the same neutral tint
        // family BrandLamp/other icon buttons use, not accent — active tab
        // keeps text-accent but doesn't get a green hover fill.
        const className = `rounded-full px-3 py-1.5 transition-colors hover:bg-foreground/[0.06] ${
          isActive ? "font-semibold text-accent" : "text-muted hover:text-foreground"
        }`;
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
