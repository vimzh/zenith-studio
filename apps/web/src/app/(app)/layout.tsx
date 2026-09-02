import { AppShell } from "@/components/app/app-shell";
import { CommandPalette } from "@/components/command-palette";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell>
      {children}
      <CommandPalette />
    </AppShell>
  );
}
