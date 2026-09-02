"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Copy, Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { projectsContent } from "@/data/projects";
import {
  SEED_ASSETS,
  downloadLibrary,
  deleteAsset,
  importLibrary,
  session,
  undoDeleteAsset,
  useSessionSelector,
  useStorageState,
  assetStorage,
  type AssetType,
} from "@/lib/editor";
import { assetNavigation, findTool, runTool } from "@/lib/webmcp";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AssetThumbnail } from "./asset-thumbnail";
import { NewAssetDialog } from "./new-asset-dialog";

/**
 * The library — every asset in one flat grid.
 *
 * An asset is any single pixel-art thing: a grass block, a cobblestone texture,
 * a character sprite, a health bar. Type is metadata that unlocks capability
 * later, not a folder. Grouping is deferred to phase 14.
 */

/**
 * Types a prompt may ask for.
 *
 * Not `TYPE_FILTERS`, which carries "all" for the filter dropdown and "tileset",
 * which is derived from a tile by `generate_tileset` rather than generated from
 * a description. Passing either through would earn a rejection from the tool.
 */
const GENERATABLE_TYPES: readonly AssetType[] = ["character", "tile", "texture", "item", "ui"];

const TYPE_FILTERS: readonly (AssetType | "all")[] = [
  "all",
  "character",
  "tile",
  "texture",
  "tileset",
  "item",
  "ui",
];

const selectAssets = (current: typeof session) => current.list();
const selectHydrated = (current: typeof session) => current.hydrated;
const selectDeleted = (current: typeof session) => current.lastDeleted;
const GENERATE_ASSET = (() => {
  const definition = findTool("generate_asset");
  if (definition === undefined) throw new Error("The generate_asset tool is not registered.");
  return definition;
})();

export function AssetLibrary({
  initialPrompt = "",
  initialType,
}: {
  initialPrompt?: string;
  initialType?: string;
}) {
  const assets = useSessionSelector(selectAssets);
  const hydrated = useSessionSelector(selectHydrated);
  const lastDeleted = useSessionSelector(selectDeleted);
  const storageState = useStorageState();

  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AssetType | "all">("all");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const prompt = initialPrompt.trim();
  const [notice, setNotice] = useState<string | null>(
    prompt === "" ? null : "Generating your asset… this usually takes 20–40 seconds."
  );
  const fileInput = useRef<HTMLInputElement | null>(null);
  const generationStarted = useRef(false);
  const router = useRouter();

  // Read storage, then seed only if it came back empty. Seeding before
  // hydration would duplicate the examples on every visit.
  useEffect(() => {
    void session.hydrate().then(() => {
      if (session.size === 0) {
        for (const asset of SEED_ASSETS) {
          session.create(asset);
        }
      }
    });
  }, []);

  useEffect(() => {
    if (!hydrated || prompt === "" || generationStarted.current) return;

    generationStarted.current = true;
    // The type travels with the prompt. `generate_asset` defaults to tile, and
    // a character generated as a tile gets autotiling instead of directions and
    // a skeleton — the character workflow is then unreachable from the very
    // asset it was meant for, with nothing reporting a problem.
    const requested = GENERATABLE_TYPES.includes(initialType as AssetType)
      ? { prompt, type: initialType }
      : { prompt };
    void runTool(GENERATE_ASSET, requested, "console").then((outcome) => {
      const id = session.activeId;
      if (outcome.ok && id !== null) {
        router.replace(`/asset/${id}`);
        return;
      }
      setNotice(outcome.text);
      router.replace("/home");
    });
  }, [hydrated, initialType, prompt, router]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter(
      (asset) =>
        (typeFilter === "all" || asset.type === typeFilter) &&
        (needle === "" || asset.name.toLowerCase().includes(needle))
    );
  }, [assets, query, typeFilter]);

  const onCreated = useCallback(
    (id: string) => {
      setCreating(false);
      router.push(`/asset/${id}`);
    },
    [router]
  );

  const onDuplicate = useCallback((id: string) => {
    session.duplicate(id);
  }, []);

  const onDelete = useCallback((id: string) => {
    // close() reassigns the active asset, which would leave the route pointing
    // at something else. Ask navigation to follow — see AGENTS.md.
    deleteAsset(id);
    const next = session.activeId;
    if (next !== null) {
      assetNavigation.request(next);
    }
  }, []);

  const onImport = useCallback(async (file: File) => {
    try {
      const result = importLibrary(JSON.parse(await file.text()));
      setNotice(
        `Imported ${String(result.imported)} asset${result.imported === 1 ? "" : "s"}` +
          (result.skipped > 0 ? `, skipped ${String(result.skipped)}.` : ".")
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That file could not be imported.");
    }
  }, []);

  const onExport = useCallback(() => {
    void assetStorage.flush().then(() => downloadLibrary());
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-10">
      <header className="flex flex-wrap items-center gap-2 pb-5">
        <Button asChild className="h-8 rounded-sm px-2 text-muted-foreground" size="sm" variant="ghost">
          <Link href="/home">
            <ChevronLeft aria-hidden className="size-4" strokeWidth={1.5} />
            {projectsContent.project.back}
          </Link>
        </Button>
        <Input
          aria-label="Search assets"
          className="h-8 w-48 rounded-sm border border-border bg-card px-2 text-sm"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search…"
          type="search"
          value={query}
        />

        <Select
          onValueChange={(value) => setTypeFilter(value as AssetType | "all")}
          value={typeFilter}
        >
          <SelectTrigger aria-label="Filter by type" className="rounded-sm bg-card font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_FILTERS.map((option) => (
              <SelectItem key={option} value={option}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <StorageIndicator state={storageState} />

          <Input
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void onImport(file);
              }
              event.target.value = "";
            }}
            ref={fileInput}
            type="file"
          />
          <IconButton icon={Upload} label="Import library" onClick={() => fileInput.current?.click()} />
          <IconButton icon={Download} label="Export library" onClick={onExport} />



          <Button
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-sm text-primary-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
            onClick={() => setCreating(true)}
            type="button"
          >
            <Plus aria-hidden className="size-4" strokeWidth={1.5} />
            New asset
          </Button>
        </div>
      </header>

      {creating ? (
        <NewAssetDialog onClose={() => setCreating(false)} onCreated={onCreated} />
      ) : null}

      <Dialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent className="rounded-md">
          <DialogHeader>
            <DialogTitle>Rename asset</DialogTitle>
            <DialogDescription>The pixels, frames, and asset type stay unchanged.</DialogDescription>
          </DialogHeader>
          <Input aria-label="Asset name" autoFocus value={renameName} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && renameTarget !== null && renameName.trim() !== "") { session.rename(renameTarget, renameName.trim()); setRenameTarget(null); }
          }} />
          <DialogFooter className="rounded-b-md">
            <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button disabled={renameName.trim() === ""} onClick={() => { if (renameTarget !== null) session.rename(renameTarget, renameName.trim()); setRenameTarget(null); }}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {storageState === "unavailable" ? (
        <p className="mt-4 rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          Changes are not being saved. {assetStorage.reason} Export the library to
          keep your work.
        </p>
      ) : null}

      {lastDeleted !== null ? (
        <p className="mt-4 flex items-center gap-3 rounded-sm border border-border bg-card px-3 py-2 text-sm">
          Deleted <span className="font-medium">{lastDeleted.name}</span>.
          <Button
            className="h-auto p-0 underline underline-offset-2 hover:bg-transparent hover:text-foreground"
            onClick={() => undoDeleteAsset()}
            variant="ghost"
            type="button"
          >
            Undo
          </Button>
        </p>
      ) : null}

      {notice !== null ? (
        <p className="mt-4 flex items-center gap-3 rounded-sm border border-border bg-card px-3 py-2 text-sm">
          {notice}
          <Button
            className="ml-auto h-auto p-0 underline underline-offset-2 hover:bg-transparent"
            onClick={() => setNotice(null)}
            variant="ghost"
            type="button"
          >
            Dismiss
          </Button>
        </p>
      ) : null}

      {!hydrated ? (
        <p className="py-20 text-center font-mono text-xs text-muted-foreground">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="py-20 text-center font-mono text-xs text-muted-foreground">
          {assets.length === 0 ? "No assets yet" : "Nothing matches"}
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {visible.map((asset) => {
            const store = session.get(asset.id);
            if (store === undefined) {
              return null;
            }

            return (
              <li className="group relative" key={asset.id}>
                <Link
                  className={cn(
                    "flex flex-col gap-2 rounded-md border border-border bg-card p-3 transition-colors",
                    "hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  )}
                  href={`/asset/${asset.id}`}
                >
                  <div className="flex h-24 items-center justify-center overflow-hidden">
                    <AssetThumbnail size={88} store={store} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm">{asset.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {asset.type} · {asset.width}×{asset.height}
                    </p>
                  </div>
                </Link>

                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <IconButton
                    icon={Pencil}
                    label={`Rename ${asset.name}`}
                    onClick={() => { setRenameTarget(asset.id); setRenameName(asset.name); }}
                  />
                  <IconButton
                    icon={Copy}
                    label={`Duplicate ${asset.name}`}
                    onClick={() => onDuplicate(asset.id)}
                  />
                  <IconButton
                    icon={Trash2}
                    label={`Delete ${asset.name}`}
                    onClick={() => onDelete(asset.id)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StorageIndicator({ state }: { state: ReturnType<typeof useStorageState> }) {
  const label =
    state === "saving" ? "saving…" : state === "ready" ? "saved" : state === "unavailable" ? "not saved" : "";

  return (
    <span
      aria-live="polite"
      className={cn(
        "font-mono text-[11px]",
        state === "unavailable" ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {label}
    </span>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className={cn(
        "flex size-7 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground transition-colors",
        "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
      onClick={onClick}
      size="icon-sm"
      title={label}
      type="button"
      variant="outline"
    >
      <Icon aria-hidden className="size-3.5" strokeWidth={1.5} />
    </Button>
  );
}
