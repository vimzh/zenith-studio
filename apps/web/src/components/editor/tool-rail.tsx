"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EDITOR_TOOLS, type ToolId } from "./tools";

/** Square brush edges. Odd sizes centre on the cursor; 1 is a single pixel. */
const BRUSH_SIZES = [1, 2, 3, 4, 6, 8] as const;

export function ToolRail({
  active,
  brushSize,
  onBrushSize,
  onSelect,
}: {
  active: ToolId;
  brushSize: number;
  onBrushSize: (size: number) => void;
  onSelect: (tool: ToolId) => void;
}) {
  // Brush size only means something for the tools that paint; showing it for
  // the eyedropper or the marquee would imply it changes them.
  const paints = active === "pencil" || active === "eraser";

  return (
    <div
      aria-label="Drawing tools"
      className="flex flex-col gap-1 border-r border-border bg-card"
      role="toolbar"
    >
      {EDITOR_TOOLS.map((tool) => {
        const Icon = tool.icon;
        const isActive = active === tool.id;

        return (
          <Button
            aria-label={`${tool.label} (${tool.shortcut})`}
            aria-pressed={isActive}
            className={cn(
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
            key={tool.id}
            onClick={() => onSelect(tool.id)}
            size="icon"
            title={`${tool.label} (${tool.shortcut})`}
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden className="size-4" strokeWidth={1.5} />
          </Button>
        );
      })}

      {paints ? (
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          <span className="text-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            px
          </span>
          {BRUSH_SIZES.map((size) => (
            <Button
              aria-label={`Brush size ${String(size)}`}
              aria-pressed={brushSize === size}
              className={cn(
                "flex size-8 items-center justify-center rounded-sm font-mono text-[11px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                brushSize === size
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
              key={size}
              onClick={() => onBrushSize(size)}
              title={`${String(size)}×${String(size)} brush`}
              type="button"
              variant="ghost"
            >
              {size}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
