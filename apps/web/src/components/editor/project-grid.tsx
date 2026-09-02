"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, LayoutGrid, Pencil, Plus, Settings, Trash2 } from "lucide-react";
import { checkStyleConsistency } from "@zenith/core";
import { hydrateProjects, projects, session, useSessionSelector } from "@/lib/editor";
import { projectsContent } from "@/data/projects";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjectSelector } from "@/components/app/use-projects";
import { AssetThumbnail } from "./asset-thumbnail";
import { StyleViolationBadge } from "./project-style-panel";

/**
 * The library, as projects rather than a flat wall of assets.
 *
 * A project is one game. Its style profile is what makes the grouping worth
 * more than a folder: everything generated inside it is conditioned on the same
 * palette, view and proportions, so the set stays coherent instead of drifting
 * a little with every session.
 *
 * Opening one is a route, not a mode: `/project/[id]` shows what is inside and
 * puts the file explorer in the sidebar. The library screen itself has no
 * sidebar, so the explorer appearing is what "you are inside a project" looks
 * like.
 *
 * Assets that belong to no project are still shown, in their own section. They
 * are not broken and must not be hidden — every asset in every existing browser
 * is one of these.
 */

const copy = projectsContent.library;
const selectAssets = (current: typeof session) => current.list();
const selectHydrated = (current: typeof session) => current.hydrated;

export function ProjectGrid() {
  const router = useRouter();
  const assets = useSessionSelector(selectAssets);
  const hydrated = useSessionSelector(selectHydrated);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  // One game is one resolution, so it is a property of the project rather than
  // a choice repeated on every asset. Every type starts here; the style panel
  // can still tune one type afterwards.
  const [resolution, setResolution] = useState(32);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const view = useProjectSelector(
    useCallback(
      (library) =>
        library.listProjects().map((project) => ({
          project,
          assetIds: library.assetsInProject(project.id),
        })),
      []
    )
  );

  const placed = useProjectSelector(
    useCallback((library) => {
      const ids = new Set<string>();
      for (const project of library.listProjects()) {
        for (const id of library.assetsInProject(project.id)) ids.add(id);
      }
      return ids;
    }, [])
  );

  // Both stores, because this screen shows projects *and* the loose assets that
  // belong to none. Hydrating only the tree left every pre-existing asset
  // invisible on the one screen that is supposed to prove they still work.
  useEffect(() => {
    void session.hydrate();
    void hydrateProjects();
  }, []);

  const open = useCallback((id: string) => {
    projects.openProject(id);
    router.push(`/project/${id}`);
  }, [router]);

  const create = useCallback(() => {
    const id = projects.createProject(name, {
      canvasSizes: {
        character: resolution,
        tile: resolution,
        texture: resolution,
        item: resolution,
        ui: resolution,
      },
    });
    setCreating(false);
    setName("");
    projects.createFolder(id, "Characters");
    projects.createFolder(id, "Tiles");
    open(id);
  }, [name, open, resolution]);

  const loose = assets.filter((asset) => !placed.has(asset.id));

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-10">
      <header className="flex flex-wrap items-center gap-2 pb-5">
        <h1 className="text-sm font-medium">{copy.title}</h1>
        <Button asChild className="ml-auto h-8 rounded-sm" size="sm" variant="ghost">
          <Link href="/home?view=assets">
            <LayoutGrid aria-hidden className="size-4" strokeWidth={1.5} />
            {copy.allAssets}
          </Link>
        </Button>
        <Button asChild className="h-8 rounded-sm" size="sm" variant="ghost">
          <Link href="/settings">
            <Settings aria-hidden className="size-4" strokeWidth={1.5} />
            {copy.settings}
          </Link>
        </Button>
        <Button
          className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-sm text-primary-foreground"
          onClick={() => setCreating(true)}
          type="button"
        >
          <Plus aria-hidden className="size-4" strokeWidth={1.5} />
          {copy.create}
        </Button>
      </header>

      {creating ? (
        <div className="mb-5 flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2">
          <Input
            aria-label="Project name"
            autoFocus
            className="h-8 max-w-xs rounded-sm text-sm"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") create();
              if (event.key === "Escape") setCreating(false);
            }}
            placeholder={copy.namePlaceholder}
            value={name}
          />
          <Select
            onValueChange={(value) => setResolution(Number(value))}
            value={String(resolution)}
          >
            <SelectTrigger
              aria-label={copy.resolutionLabel}
              className="h-8 w-28 rounded-sm font-mono text-xs"
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-sm">
              {copy.resolutions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}×{size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="h-8 rounded-sm" onClick={create} size="sm" type="button">
            {copy.confirm}
          </Button>
          <Button
            className="h-8 rounded-sm"
            onClick={() => setCreating(false)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {copy.cancel}
          </Button>
        </div>
      ) : null}

      {view.length === 0 ? (
        <p className="py-14 text-center font-mono text-xs text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {view.map(({ project, assetIds }) => (
            <li key={project.id}>
              <div className={cn("flex w-full flex-col gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors", "hover:border-foreground/30")}>
                <button
                  aria-label={`Open ${project.name}`}
                  className="flex h-20 items-center gap-1.5 overflow-hidden text-left"
                  onClick={() => open(project.id)}
                  type="button"
                >
                  {assetIds.slice(0, 4).map((id) => {
                    const store = session.get(id);
                    const asset = assets.find((item) => item.id === id);
                    const report = store === undefined || asset === undefined
                      ? null
                      : checkStyleConsistency(
                          Array.from({ length: store.frameCount }, (_, frame) => store.readComposite(frame)),
                          project.style,
                          asset.type,
                          store.palette,
                        );
                    return store === undefined ? null : (
                      <div className="relative" key={id}>
                        <AssetThumbnail size={64} store={store} />
                        {report === null ? null : <StyleViolationBadge className="absolute -right-1 -top-1 px-1" report={report} />}
                      </div>
                    );
                  })}
                  {assetIds.length === 0 ? (
                    <span className="flex w-full items-center justify-center gap-2 font-mono text-[0.7rem] text-muted-foreground">
                      <FolderOpen aria-hidden className="size-4" strokeWidth={1.5} />
                      empty
                    </span>
                  ) : null}
                </button>
                <div className="min-w-0">
                  {renaming === project.id ? (
                    <Input
                      aria-label="Project name"
                      autoFocus
                      className="h-7 rounded-sm"
                      defaultValue={project.name}
                      onBlur={(event) => { projects.renameProject(project.id, event.target.value); setRenaming(null); }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") { projects.renameProject(project.id, event.currentTarget.value); setRenaming(null); }
                        if (event.key === "Escape") setRenaming(null);
                      }}
                    />
                  ) : (
                    <button
                      className="block w-full truncate text-left text-sm hover:underline"
                      onClick={() => open(project.id)}
                      type="button"
                    >
                      {project.name}
                    </button>
                  )}
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {assetIds.length} asset{assetIds.length === 1 ? "" : "s"} ·{" "}
                    {project.style.canvasSizes.character}×{project.style.canvasSizes.character} ·{" "}
                    {project.style.view}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1 border-t border-border pt-2">
                  <Button aria-label={`Rename ${project.name}`} className="ml-auto size-7 rounded-sm" onClick={() => setRenaming(project.id)} size="icon" type="button" variant="ghost"><Pencil aria-hidden className="size-3" /></Button>
                  {confirmDelete === project.id ? (
                    <>
                      <Button className="h-7 rounded-sm" onClick={() => { projects.deleteProject(project.id); setConfirmDelete(null); }} size="sm" type="button" variant="destructive">Delete</Button>
                      <Button className="h-7 rounded-sm" onClick={() => setConfirmDelete(null)} size="sm" type="button" variant="ghost">Cancel</Button>
                    </>
                  ) : (
                    <Button aria-label={`Delete ${project.name}`} className="size-7 rounded-sm" onClick={() => setConfirmDelete(project.id)} size="icon" type="button" variant="ghost"><Trash2 aria-hidden className="size-3" /></Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {hydrated && loose.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {copy.loose.title}
          </h2>
          <p className="mb-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {copy.loose.description}
          </p>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
            {loose.map((asset) => {
              const store = session.get(asset.id);
              return store === undefined ? null : (
                <li key={asset.id}>
                  <button
                    className="flex w-full flex-col gap-2 rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-foreground/30"
                    onClick={() => router.push(`/asset/${asset.id}`)}
                    type="button"
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
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
