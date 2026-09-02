"use client";

import { useCallback, useState } from "react";
import { Download, X } from "lucide-react";
import type { DocumentStore } from "@zenith/core";
import {
  exportEngine,
  exportGif,
  exportIndexedPng,
  exportPalette,
  exportPng,
  exportSpritesheet,
} from "@/lib/editor";
import type { Engine, PaletteFormat } from "@/lib/export";
import { useStoreSelector } from "@/lib/pixel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Export dialog.
 *
 * Every format the app can produce, in one place, with the result reported
 * rather than assumed — an export that silently produced nothing is worse than
 * one that says why it could not.
 */

const selectFrameCount = (store: DocumentStore) => store.frameCount;

const ENGINES: readonly { id: Engine; label: string; note: string }[] = [
  { id: "godot", label: "Godot 4", note: "PNG + .import with filtering off" },
  { id: "unity", label: "Unity", note: "PNG + .meta, Point filter, pre-sliced" },
  { id: "phaser", label: "Phaser 3", note: "PNG + atlas JSON + loader snippet" },
  { id: "love", label: "LÖVE", note: "PNG + Lua quads, nearest filter" },
];

const PALETTES: readonly { id: PaletteFormat; label: string }[] = [
  { id: "gpl", label: "GIMP / Aseprite (.gpl)" },
  { id: "pal", label: "JASC (.pal)" },
  { id: "ase", label: "Adobe swatch (.ase)" },
  { id: "hex", label: "Hex list (.hex)" },
  { id: "txt", label: "Paint.NET (.txt)" },
  { id: "png-strip", label: "PNG strip" },
];

export function ExportDialog({
  name,
  onClose,
  store,
}: {
  name: string;
  onClose: () => void;
  store: DocumentStore;
}) {
  const frameCount = useStoreSelector(store, selectFrameCount);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const run = useCallback(async (work: () => string | Promise<string>) => {
    try {
      setFailed(false);
      setStatus(await work());
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, []);

  return (
    <div
      aria-label="Export"
      aria-modal="true"
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-6"
      role="dialog"
    >
      <div className="flex max-h-full w-[min(560px,100%)] flex-col overflow-auto rounded-md border border-border bg-background">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">Export {name}</h2>
          <Button
            aria-label="Close"
            className="flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onClose}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X aria-hidden className="size-4" strokeWidth={1.5} />
          </Button>
        </header>

        <div className="flex flex-col gap-5 p-4">
          <Section title="Image">
            <Action label="PNG at 8x" onClick={() => run(() => exportPng(store, name, 8))} />
            <Action
              label="Indexed PNG-8"
              note="Keeps palette indices — supports runtime palette swapping"
              onClick={() => run(() => exportIndexedPng(store, name))}
            />
            <Action
              disabled={frameCount < 2}
              label="Animated GIF"
              note={frameCount < 2 ? "Needs at least two frames" : `${String(frameCount)} frames`}
              onClick={() => run(() => exportGif(store, name))}
            />
            <Action
              label="Spritesheet + atlas"
              note="PNG plus Aseprite-shaped JSON"
              onClick={() => run(() => exportSpritesheet(store, name))}
            />
          </Section>

          <Section title="Game engine">
            {ENGINES.map((engine) => (
              <Action
                key={engine.id}
                label={engine.label}
                note={engine.note}
                onClick={() => run(() => exportEngine(store, name, engine.id))}
              />
            ))}
          </Section>

          <Section title="Palette">
            {PALETTES.map((format) => (
              <Action
                key={format.id}
                label={format.label}
                onClick={() => run(() => exportPalette(store, name, format.id))}
              />
            ))}
          </Section>
        </div>

        {status !== null ? (
          <p
            aria-live="polite"
            className={cn(
              "border-t border-border px-4 py-3 text-sm",
              failed ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {status}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

function Action({
  disabled,
  label,
  note,
  onClick,
}: {
  disabled?: boolean;
  label: string;
  note?: string;
  onClick: () => void;
}) {
  return (
    <Button
      className={cn(
        "h-auto whitespace-normal flex items-center justify-start gap-3 rounded-sm border border-border px-3 py-2 text-left text-sm transition-colors",
        "hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40"
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
      variant="outline"
    >
      <Download aria-hidden className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <span className="min-w-0">
        {label}
        {note !== undefined ? (
          <span className="block font-mono text-[11px] text-muted-foreground">{note}</span>
        ) : null}
      </span>
    </Button>
  );
}
