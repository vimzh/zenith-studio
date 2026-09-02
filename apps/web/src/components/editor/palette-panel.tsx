"use client";

import { useState } from "react";
import { TRANSPARENT, paletteHexes, type Cell, type DocumentStore } from "@zenith/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { session } from "@/lib/editor";
import { useStoreSelector } from "@/lib/pixel";
import { cn } from "@/lib/utils";

/**
 * The palette, with a live per-index usage count.
 *
 * Usage counts come from `store.stats()` rather than a scan here — it already
 * walks the grid once per revision, and duplicating that walk in the component
 * would double the work on every change.
 */

const selectPalette = (store: DocumentStore) => paletteHexes(store.palette);
const selectStats = (store: DocumentStore) => store.stats();

export function PalettePanel({
  store,
  selected,
  onSelect,
  opacity,
  onOpacity,
}: {
  store: DocumentStore;
  selected: Cell;
  onSelect: (index: Cell) => void;
  opacity: number;
  onOpacity: (opacity: number) => void;
}) {
  const colors = useStoreSelector(store, selectPalette);
  const { usage } = useStoreSelector(store, selectStats);
  const [editing, setEditing] = useState<{ index: number; hex: string } | null>(null);
  const validHex = editing !== null && /^#[0-9a-f]{6}$/i.test(editing.hex);

  return (
    <div className="flex flex-col gap-2 border-t border-border p-2">
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Palette">
        <Button
          aria-checked={selected === TRANSPARENT}
          aria-label="Transparent"
          className={cn(
            "rounded-sm border",
            "bg-[repeating-conic-gradient(#8a8a8a_0_25%,#6e6e6e_0_50%)] bg-[length:8px_8px]",
            selected === TRANSPARENT ? "border-foreground" : "border-border"
          )}
          onClick={() => onSelect(TRANSPARENT)}
          role="radio"
          size="icon-xs"
          title="Transparent"
          type="button"
          variant="outline"
        />
        {colors.map((hex, index) => (
          <ContextMenu key={`${String(index)}-${hex}`}>
            <ContextMenuTrigger asChild>
              <Button
                aria-checked={selected === index}
                aria-label={`${hex}, ${String(usage.get(index) ?? 0)} pixels`}
                className={cn("rounded-sm border", selected === index ? "border-foreground" : "border-border")}
                onClick={() => onSelect(index)} role="radio" size="icon-xs" style={{ backgroundColor: hex }}
                title={`${hex} · ${String(usage.get(index) ?? 0)} px · right-click to edit`} type="button" variant="outline"
              />
            </ContextMenuTrigger>
            <ContextMenuContent className="rounded-md">
              <ContextMenuItem onSelect={() => setEditing({ index, hex })}>Edit colour…</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
      <p className="font-mono text-[11px] text-muted-foreground">
        {selected === TRANSPARENT ? "transparent" : colors[selected] ?? "—"}
      </p>
      <div className="flex items-center gap-3">
        <label className="w-14 font-mono text-[11px] text-muted-foreground" htmlFor="brush-opacity">Opacity</label>
        <Slider
          aria-label="Brush opacity"
          id="brush-opacity"
          max={100}
          min={0}
          onValueChange={(value) => onOpacity(value[0] ?? 100)}
          step={25}
          value={[opacity]}
        />
        <span className="w-8 text-right font-mono text-[11px] text-muted-foreground">{opacity}%</span>
      </div>
      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="rounded-md">
          <DialogHeader>
            <DialogTitle>Edit palette colour</DialogTitle>
            <DialogDescription>Enter a six-digit hex colour. Existing pixels keep this palette index.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              aria-label="Pick colour"
              className="size-8 shrink-0 cursor-pointer rounded-sm p-0.5"
              type="color"
              value={validHex ? editing.hex : "#000000"}
              onChange={(event) => { if (editing !== null) setEditing({ ...editing, hex: event.target.value }); }}
            />
            <Input aria-label="Hex colour" className="font-mono" maxLength={7} value={editing?.hex ?? ""} onChange={(event) => { if (editing !== null) setEditing({ ...editing, hex: event.target.value }); }} />
          </div>
          <div className="h-10 rounded-sm border border-border" style={{ backgroundColor: validHex ? editing.hex : "transparent" }} />
          <DialogFooter className="rounded-b-md">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={!validHex} onClick={() => { if (editing !== null && validHex) session.setPaletteColor(store.id, editing.index, editing.hex); setEditing(null); }}>Save colour</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
