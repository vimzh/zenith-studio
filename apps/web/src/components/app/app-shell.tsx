import type { ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppChrome } from "@/components/app/app-chrome";
import { SidebarProfileCard, loadProfileUser } from "@/components/home/sidebar-profile-card";
import { WebMCPTools } from "@/components/agent/webmcp-tools";

/**
 * The app chrome.
 *
 * Async here rather than in `SidebarProfileCard`: this component is rendered
 * directly by the route layout, so awaiting is legal. The profile card is not —
 * it sits inside `Sidebar`, a client component, where an async component is
 * rejected as an async Client Component and breaks hydration for the page.
 *
 * Which chrome to draw is a per-route decision and lives in `AppChrome`, which
 * is a client component. The profile card is passed to it already rendered, so
 * the async lookup stays here on the server.
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const user = await loadProfileUser();

  return (
    <SidebarProvider>
      <WebMCPTools />
      <AppChrome profile={<SidebarProfileCard user={user} />}>{children}</AppChrome>
    </SidebarProvider>
  );
}
