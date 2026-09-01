import Link from "next/link";
import { HouseIcon, PackageIcon } from "lucide-react";
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
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { homeContent } from "@/data/home";

export function HomeSidebar() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader className="border-b">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  size="lg"
                  tooltip={homeContent.sidebar.brand.name}
                >
                  <Link
                    aria-label={homeContent.sidebar.brand.homeLabel}
                    href="/home"
                  >
                    <span className="grid size-8 shrink-0 place-items-center bg-primary text-primary-foreground">
                      <PackageIcon aria-hidden="true" />
                    </span>
                    <span className="font-medium">
                      {homeContent.sidebar.brand.name}
                    </span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <nav aria-label={homeContent.sidebar.label}>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        isActive
                        tooltip={homeContent.sidebar.home.label}
                      >
                        <Link
                          aria-current="page"
                          href={homeContent.sidebar.home.href}
                        >
                          <HouseIcon aria-hidden="true" />
                          <span>{homeContent.sidebar.home.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </nav>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarRail />
        </Sidebar>

        <SidebarInset>
          <header className="flex h-16 items-center gap-3 border-b px-4">
            <SidebarTrigger
              aria-label={homeContent.sidebar.toggleLabel}
              className="size-11"
            />
            <h1 className="font-mono text-sm">{homeContent.title}</h1>
          </header>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
