import type { ReactNode } from "react";
import { SiteNavbar } from "@/components/layout/site-navbar";
import { StickyNavbarShell } from "@/components/layout/sticky-navbar-shell";

export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dark min-h-dvh bg-background text-foreground [color-scheme:dark]">
      <StickyNavbarShell>
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SiteNavbar />
        </div>
      </StickyNavbarShell>
      <main>{children}</main>
    </div>
  );
}
