"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
} from "@/components/ui/sidebar";
import { homeContent } from "@/data/home";
import { ProjectExplorer } from "@/components/app/project-explorer";

/**
 * Decides what the primary sidebar is, per route.
 *
 * The library screen is a full-width grid of projects and has nothing to
 * navigate to — a rail holding "Home" and "Settings" beside it is chrome for
 * its own sake. Inside a project or an asset, the same space becomes the file
 * explorer, which is the one place hierarchy is worth showing. Opening a
 * project is exactly that: the explorer appearing is what being inside one
 * looks like.
 *
 * Client, because the decision is the pathname. `profile` arrives already
 * rendered from the server shell so the async profile lookup stays on the
 * server — passing a node rather than the data is what keeps that boundary.
 */
export function AppChrome({
  children,
  profile,
}: {
  children: ReactNode;
  profile: ReactNode;
}) {
  const pathname = usePathname();
  const showExplorer =
    pathname.startsWith("/asset/") || pathname.startsWith("/project/");

  if (!showExplorer) {
    return <SidebarInset className="h-dvh min-h-0 overflow-auto">{children}</SidebarInset>;
  }

  return (
    <ResizablePanelGroup className="min-h-dvh" orientation="horizontal">
      <ResizablePanel
        defaultSize={248}
        groupResizeBehavior="preserve-pixel-size"
        maxSize={360}
        minSize={200}
      >
        <Sidebar className="w-full" collapsible="none">
          <SidebarHeader className="h-11 shrink-0 justify-center border-b border-border p-0">
            <span className="flex items-center px-3 text-sm font-medium tracking-tight">
              {homeContent.sidebar.brand.name}
            </span>
          </SidebarHeader>
          <SidebarContent className="min-h-0">
            <ProjectExplorer />
          </SidebarContent>
          {profile}
        </Sidebar>
      </ResizablePanel>

      <ResizableHandle aria-label="Resize sidebar" />

      <ResizablePanel>
        <SidebarInset className="h-dvh min-h-0 overflow-auto">{children}</SidebarInset>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
