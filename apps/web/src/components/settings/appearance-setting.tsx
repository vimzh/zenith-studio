"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { useMounted } from "@/hooks/use-mounted";
import { settingsContent } from "@/data/home";

const icons = {
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
} as const;

const { appearance } = settingsContent;

export function AppearanceSetting() {
  const { setTheme, theme } = useTheme();
  // next-themes resolves the theme from localStorage, so the selected state is
  // only knowable in the browser. Gate on mount to avoid a hydration mismatch.
  const mounted = useMounted();

  return (
    <section className="py-8">
      <h2 className="text-sm font-medium">{appearance.title}</h2>
      <p className="mt-1 max-w-lg text-sm leading-relaxed text-muted-foreground">
        {appearance.description}
      </p>

      <ToggleGroup
        aria-label={appearance.label}
        className="mt-5 inline-flex gap-1 rounded-md border border-border bg-card p-1"
        onValueChange={(value) => {
          if (value) setTheme(value);
        }}
        type="single"
        value={mounted ? (theme ?? "") : ""}
      >
        {appearance.options.map((option) => {
          const Icon = icons[option.icon];

          return (
            <ToggleGroupItem
              aria-label={option.label}
              className="gap-2"
              key={option.value}
              value={option.value}
            >
              <Icon aria-hidden className="size-4" strokeWidth={1.5} />
              {option.label}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </section>
  );
}
