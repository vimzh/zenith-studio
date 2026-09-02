"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AIPromptInput from "@/components/smoothui/ai-prompt-input";
import { landingContent } from "@/data/landing";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const { prompt: copy } = landingContent;

/**
 * The prompt box, with the asset type chosen alongside it.
 *
 * The type is picked rather than inferred from the wording. It decides which
 * tools the asset gets afterwards — a character unlocks directions and
 * skeletons, a tile unlocks autotiling — and generating everything as a tile
 * left the character workflow unreachable from the character you just made,
 * with nothing anywhere reporting a problem.
 */
export function LandingPrompt({ className }: { className?: string }) {
  const router = useRouter();
  const [type, setType] = useState<string>("tile");

  return (
    <div className={cn("mx-auto flex w-full max-w-2xl flex-col gap-2", className)}>
      <AIPromptInput
        className="bg-black text-white"
        maxLength={500}
        onSubmit={(value) =>
          router.push(
            `/home?prompt=${encodeURIComponent(value)}&type=${encodeURIComponent(type)}`
          )
        }
        placeholder={copy.placeholder}
      />

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <span className="font-mono text-[0.7rem] text-muted-foreground">{copy.typeLabel}</span>
        {copy.types.map((option) => (
          <Button
            aria-pressed={type === option.id}
            className={cn(
              "h-6 rounded-sm border px-2 font-mono text-[0.7rem] transition-colors",
              type === option.id
                ? "border-foreground/40 bg-foreground text-background"
                : "border-border bg-transparent text-muted-foreground hover:text-foreground"
            )}
            key={option.id}
            onClick={() => setType(option.id)}
            size="sm"
            type="button"
            variant="outline"
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
