import type { ReactNode } from "react";
import { SiteNavbar } from "@/components/layout/site-navbar";
import { StickyNavbarShell } from "@/components/layout/sticky-navbar-shell";

export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <StickyNavbarShell>
        <div className="px-[14%]">
          <SiteNavbar />
        </div>
      </StickyNavbarShell>
      <main className="px-[14%]">{children}</main>
    </>
  );
}
