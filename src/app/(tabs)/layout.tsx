// Shared shell for the three tab routes (issue #29): header (brand + build
// stamp — lives here, not in RecorderClient, so smoke-checklist step 1 works
// on every tab), the page, and the fixed bottom TabBar. /login sits outside
// the (tabs) group and stays bare. The route group does not affect URLs —
// (tabs)/page.tsx still serves /.

import BrandLamp from "../BrandLamp";
import { CaptureGuardProvider } from "../CaptureGuard";
import TabBar from "../TabBar";

// Inlined at build time from next.config.ts ("Mar 4, 2:37 pm", Pacific).
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME;

export default function TabsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <CaptureGuardProvider>
      {/* pb-28 keeps the fixed tab bar from covering page content, with room
          for the busy-hint line + safe-area inset. */}
      <main className="mx-auto flex min-h-full w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-8 pb-28">
        <header className="flex items-center justify-between">
          <BrandLamp />
          {BUILD_TIME && (
            <span className="text-[10px] text-foreground/40 tabular-nums">{BUILD_TIME} PT</span>
          )}
        </header>
        {children}
      </main>
      <TabBar />
    </CaptureGuardProvider>
  );
}
