"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Download, Settings2, Trash2 } from "lucide-react";
import { checkStyleConsistency } from "@zenith/core";
import {
  deleteAsset,
  downloadProject,
  hydrateProjects,
  projects,
  session,
  useSessionSelector,
} from "@/lib/editor";
import { projectsContent } from "@/data/projects";
import { Button } from "@/components/ui/button";
import { useProjectSelector } from "@/components/app/use-projects";
import { AssetThumbnail } from "./asset-thumbnail";
import { ProjectStylePanel, StyleViolationBadge } from "./project-style-panel";

/**
 * One project, opened.
 *
 * The route is what decides which project is open, exactly as `/asset/[id]`
 * decides which asset is: this pushes the id into the library on mount, and the
 * explorer sidebar reads `activeProjectId` back out. Letting the library infer
 * it instead is the divergence `AGENTS.md` describes — the human browses one
 * project while the agent's `project_id` default resolves to another, silently.
 */

const copy = projectsContent.project;
const selectAssets = (current: typeof session) => current.list();

export function ProjectView({ id }: { id: string }) {
  const router = useRouter();
  const assets = useSessionSelector(selectAssets);
  const [ready, setReady] = useState(false);
  const [showStyle, setShowStyle] = useState(false);

  const view = useProjectSelector(
    useCallback(
      (library) => {
        const project = library.getProject(id);
        return project === undefined
          ? null
          : { project, assetIds: library.assetsInProject(id) };
      },
      [id],
    ),
  );

  // Both stores: the project tree says which assets belong here, the session
  // holds the documents those thumbnails draw.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([session.hydrate(), hydrateProjects()]).then(() => {
      if (cancelled) return;
      projects.openProject(id);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (view === null) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3">
        <p className="font-mono text-xs text-muted-foreground">
          {ready ? (
            <>
              <span className="text-foreground">{id}</span> {copy.missing}
            </>
          ) : (
            copy.loading
          )}
        </p>
        {ready ? (
          <Link
            className="rounded-sm border border-border px-3 py-1.5 text-sm hover:border-foreground/30"
            href="/home"
          >
            {copy.back}
          </Link>
        ) : null}
      </div>
    );
  }

  const { project, assetIds } = view;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3">
        <Button asChild size="icon-sm" variant="ghost">
          <Link aria-label={copy.back} href="/home" title={copy.back}>
            <ChevronLeft aria-hidden className="size-4" strokeWidth={1.5} />
          </Link>
        </Button>
        <span className="truncate text-sm font-medium tracking-tight">
          {project.name}
        </span>
        <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
          {assetIds.length} asset{assetIds.length === 1 ? "" : "s"}
          <span className="mx-2 text-border">·</span>
          {project.style.canvasSizes.character}×{project.style.canvasSizes.character}
          <span className="mx-2 text-border">·</span>
          {project.style.view}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            className="h-7 rounded-sm"
            onClick={() => setShowStyle((current) => !current)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Settings2 aria-hidden className="size-3" strokeWidth={1.5} />
            {copy.style}
          </Button>
          <Button
            className="h-7 rounded-sm"
            onClick={() => downloadProject(project.id)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Download aria-hidden className="size-3" strokeWidth={1.5} />
            {copy.export}
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl min-h-0 flex-1 overflow-y-auto px-8 py-8">
        {assetIds.length === 0 ? (
          <p className="py-14 text-center font-mono text-xs text-muted-foreground">
            {copy.empty}
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
            {assetIds.map((assetId) => {
              const store = session.get(assetId);
              const asset = assets.find((entry) => entry.id === assetId);
              if (store === undefined || asset === undefined) return null;
              const report = checkStyleConsistency(
                Array.from({ length: store.frameCount }, (_, frame) =>
                  store.readComposite(frame),
                ),
                project.style,
                asset.type,
                store.palette,
              );

              return (
                <li className="group relative" key={assetId}>
                  <button
                    className="flex w-full flex-col gap-2 rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-foreground/30"
                    onClick={() => router.push(`/asset/${assetId}`)}
                    type="button"
                  >
                    <div className="relative flex h-24 items-center justify-center overflow-hidden">
                      <AssetThumbnail size={88} store={store} />
                      <StyleViolationBadge
                        className="absolute right-0 top-0 px-1"
                        report={report}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm">{asset.name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {asset.type} · {asset.width}×{asset.height}
                      </p>
                    </div>
                  </button>
                  <Button
                    aria-label={`Delete ${asset.name}`}
                    className="absolute bottom-2 right-2 size-6 rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => deleteAsset(assetId)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden className="size-3" strokeWidth={1.5} />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {showStyle ? (
          <div className="mt-5">
            <ProjectStylePanel projectId={project.id} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
