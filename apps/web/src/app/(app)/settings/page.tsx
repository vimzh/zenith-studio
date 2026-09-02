import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AppearanceSetting } from "@/components/settings/appearance-setting";
import { settingsContent } from "@/data/home";
import { projectsContent } from "@/data/projects";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <header className="border-b border-border pb-5">
        <Link
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          href="/home"
        >
          <ChevronLeft aria-hidden className="size-4" strokeWidth={1.5} />
          {projectsContent.project.back}
        </Link>
        <h1 className="text-xl font-medium tracking-tight">
          {settingsContent.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {settingsContent.description}
        </p>
      </header>
      <AppearanceSetting />
    </div>
  );
}
