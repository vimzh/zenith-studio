"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Settings } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { homeContent } from "@/data/home";

const icons = {
  grid: LayoutGrid,
  settings: Settings,
} as const;

export function AppSidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label={homeContent.sidebar.label}>
      <SidebarMenu className="gap-1">
        {homeContent.sidebar.links.map((link) => {
          const Icon = icons[link.icon];
          const isActive = pathname === link.href;

          return (
            <SidebarMenuItem key={link.href}>
              <SidebarMenuButton asChild isActive={isActive}>
                <Link
                  aria-current={isActive ? "page" : undefined}
                  href={link.href}
                >
                  <Icon aria-hidden className="size-4" strokeWidth={1.5} />
                  <span>{link.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </nav>
  );
}
