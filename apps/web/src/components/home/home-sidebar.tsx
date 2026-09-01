import Link from "next/link";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { SidebarProfileCard } from "@/components/home/sidebar-profile-card";
import { homeContent } from "@/data/home";

export function HomeSidebar() {
  return (
    <SidebarProvider>
      <ResizablePanelGroup className="min-h-dvh" orientation="horizontal">
        <ResizablePanel
          defaultSize={256}
          groupResizeBehavior="preserve-pixel-size"
          maxSize={320}
          minSize={220}
        >
          <Sidebar className="w-full" collapsible="none">
            <SidebarHeader>
              <Link
                aria-label={homeContent.sidebar.brand.homeLabel}
                className="flex min-h-11 items-center px-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                href="/home"
              >
                {homeContent.sidebar.brand.name}
              </Link>
            </SidebarHeader>

            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <nav aria-label={homeContent.sidebar.label}>
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild isActive>
                          <Link
                            aria-current="page"
                            href={homeContent.sidebar.home.href}
                          >
                            <span>{homeContent.sidebar.home.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </nav>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            <SidebarProfileCard />
          </Sidebar>
        </ResizablePanel>

        <ResizableHandle aria-label="Resize sidebar" />

        <ResizablePanel>
          <SidebarInset />
        </ResizablePanel>
      </ResizablePanelGroup>
    </SidebarProvider>
  );
}
