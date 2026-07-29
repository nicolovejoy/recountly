// Shared shell for the three tab routes (issue #29): header (brand + build
// stamp — lives here, not in RecorderClient, so smoke-checklist step 1 works
// on every tab), the page, and the fixed bottom TabBar (phone-only) / top
// TopNav (md+, issue #35 — same tabs.ts source of truth as TabBar). /login
// sits outside the (tabs) group and stays bare. The route group does not
// affect URLs — (tabs)/page.tsx still serves /.

import BrandLamp from "../BrandLamp";
import { CaptureGuardProvider } from "../CaptureGuard";
import { ConfirmProvider } from "../ConfirmDialog";
import PendingSaveRecovery from "../PendingSaveRecovery";
import TabBar from "../TabBar";
import TopNav from "../TopNav";

// Inlined at build time from next.config.ts ("Mar 4, 2:37 pm", Pacific).
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME;

export default function TabsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <CaptureGuardProvider>
      <ConfirmProvider>
        <PendingSaveRecovery />
        {/* pb-28 keeps the fixed phone tab bar from covering page content, with
            room for the busy-hint line + safe-area inset; md+ has no bottom
            bar (TopNav lives in the header instead), so the reserve shrinks. */}
        <main className="mx-auto flex min-h-full w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-8 pb-28 md:pb-8">
          <header className="sticky top-0 z-30 -mx-5 flex items-center justify-between border-b border-hairline bg-background/90 px-5 py-3 backdrop-blur">
            <BrandLamp />
            <div className="flex items-center gap-6">
              <TopNav />
              {BUILD_TIME && (
                <span
                  className="group rounded-full px-2 py-1 text-[12px] text-muted tabular-nums transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                  title="Last build date"
                >
                  <span className="hidden group-hover:inline">last build: </span>
                  {BUILD_TIME} PT
                </span>
              )}
            </div>
          </header>
          {children}
        </main>
        <TabBar />
      </ConfirmProvider>
    </CaptureGuardProvider>
  );
}
