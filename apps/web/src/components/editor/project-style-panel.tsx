"use client";

import { useCallback, useState } from "react";
import {
  DIRECTION_SETS,
  MAX_PALETTE_SIZE,
  OUTLINES,
  PROJECTIONS,
  PROPORTIONS,
  SHADINGS,
  VIEWS,
  checkStyleConsistency,
  createPalette,
  type CanvasSizes,
  type StyleProfile,
  type StyleReport,
} from "@zenith/core";
import { AlertTriangle, Plus, X } from "lucide-react";
import { useProjectSelector } from "@/components/app/use-projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { projects, session, useSessionSelector } from "@/lib/editor";
import { cn } from "@/lib/utils";

const CANVAS_TYPES = ["character", "tile", "texture", "item", "ui"] as const;
const selectAssets = (current: typeof session) => current.list();

interface StyleSelectProps {
  readonly label: string;
  readonly options: readonly string[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}

function StyleSelect({ label, options, value, onChange }: StyleSelectProps) {
  return (
    <label className="grid gap-1 font-mono text-[11px] text-muted-foreground">
      {label}
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger className="w-full rounded-sm bg-card text-xs" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-sm">
          {options.map((option) => (
            <SelectItem key={option} value={option}>{option}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function StyleViolationBadge({
  report,
  className,
}: {
  readonly report: StyleReport;
  readonly className?: string;
}) {
  if (report.conforms) return null;

  const kinds = [...new Set(report.violations.map((violation) => violation.kind))];
  return (
    <Badge
      className={cn("h-5 rounded-sm px-1.5 font-mono text-[10px]", className)}
      title={report.violations.map((violation) => violation.message).join("\n")}
      variant="destructive"
    >
      <AlertTriangle aria-hidden className="size-3" />
      {kinds.join(" · ")}
    </Badge>
  );
}

export function ProjectStylePanel({ projectId }: { readonly projectId: string }) {
  const project = useProjectSelector(
    useCallback((library) => library.getProject(projectId), [projectId]),
  );
  const projectAssetIds = useProjectSelector(
    useCallback((library) => library.assetsInProject(projectId), [projectId]),
  );
  const assets = useSessionSelector(selectAssets);
  const [result, setResult] = useState<string | null>(null);

  if (project === undefined) {
    return <p className="font-mono text-xs text-destructive">Project not found.</p>;
  }

  const style = project.style;
  const projectIdSet = new Set(projectAssetIds);
  const projectAssets = assets.filter((asset) => projectIdSet.has(asset.id));
  const violations = projectAssets.flatMap((asset) => {
    const store = session.get(asset.id);
    if (store === undefined) return [];
    const grids = Array.from({ length: store.frameCount }, (_, frame) => store.readComposite(frame));
    const report = checkStyleConsistency(grids, style, asset.type, store.palette);
    return report.conforms ? [] : [{ asset, report }];
  });

  const patchStyle = (patch: Partial<StyleProfile>) => {
    projects.setStyle(projectId, patch);
    setResult(null);
  };
  const setPalette = (colors: readonly string[]) => {
    patchStyle({
      palette: createPalette({ id: style.palette.id, name: style.palette.name, colors }),
    });
  };
  const setCanvasSize = (type: keyof CanvasSizes, value: string) => {
    const size = Number(value);
    if (Number.isInteger(size) && size >= 4 && size <= 256) {
      patchStyle({ canvasSizes: { ...style.canvasSizes, [type]: size } });
    }
  };
  const toggleReference = (assetId: string, checked: boolean) => {
    patchStyle({
      references: checked
        ? [...style.references, assetId]
        : style.references.filter((id) => id !== assetId),
    });
  };
  const conformAll = () => {
    let changed = 0;
    let resized = 0;
    let conformed = 0;
    for (const asset of projectAssets) {
      const outcome = session.conformStyle(asset.id, style, asset.type);
      if (outcome === null) continue;
      changed += outcome.changed;
      resized += Number(outcome.resized);
      conformed += 1;
    }
    setResult(
      `Conformed ${String(conformed)} asset${conformed === 1 ? "" : "s"}: `
      + `${String(changed)} pixel${changed === 1 ? "" : "s"} remapped, `
      + `${String(resized)} resized.`,
    );
  };

  return (
    <section className="grid gap-4 rounded-sm border border-border bg-card p-3" aria-label="Project style">
      <header>
        <h2 className="text-sm font-medium">Style profile</h2>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          The exact contract used for every asset in {project.name}.
        </p>
      </header>

      <fieldset className="grid gap-2 border-0 p-0">
        <legend className="mb-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Palette
        </legend>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {style.palette.colors.map((color, index) => (
            <div className="grid gap-1" key={String(index)}>
              <Input
                aria-label={`Palette colour ${String(index + 1)}`}
                className="h-8 cursor-pointer rounded-sm border-border p-0.5"
                onChange={(event) => {
                  const colors = style.palette.colors.map((entry) => entry.hex);
                  colors[index] = event.target.value;
                  setPalette(colors);
                }}
                type="color"
                value={color.hex}
              />
              <span className="truncate text-center font-mono text-[9px] text-muted-foreground">
                {color.hex}
              </span>
              {style.palette.colors.length > 1 ? (
                <Button
                  aria-label={`Remove palette colour ${String(index + 1)}`}
                  className="h-5 rounded-sm px-1"
                  onClick={() => setPalette(style.palette.colors.filter((_, item) => item !== index).map((entry) => entry.hex))}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        {style.palette.colors.length < MAX_PALETTE_SIZE ? (
          <Button
            className="w-fit rounded-sm"
            onClick={() => setPalette([...style.palette.colors.map((color) => color.hex), "#000000"])}
            size="xs"
            type="button"
            variant="outline"
          >
            <Plus aria-hidden /> Add colour
          </Button>
        ) : null}
      </fieldset>

      <fieldset className="grid grid-cols-2 gap-2 border-0 p-0 sm:grid-cols-5">
        <legend className="mb-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Canvas sizes
        </legend>
        {CANVAS_TYPES.map((type) => (
          <label className="grid gap-1 font-mono text-[11px] text-muted-foreground" key={type}>
            {type}
            <Input
              className="h-7 rounded-sm font-mono text-xs"
              max={256}
              min={4}
              onChange={(event) => setCanvasSize(type, event.target.value)}
              type="number"
              value={style.canvasSizes[type]}
            />
          </label>
        ))}
      </fieldset>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StyleSelect label="view" onChange={(view) => patchStyle({ view: view as StyleProfile["view"] })} options={VIEWS} value={style.view} />
        <StyleSelect label="projection" onChange={(projection) => patchStyle({ projection: projection as StyleProfile["projection"] })} options={PROJECTIONS} value={style.projection} />
        <StyleSelect label="directions" onChange={(directionSet) => patchStyle({ directionSet: directionSet as StyleProfile["directionSet"] })} options={DIRECTION_SETS} value={style.directionSet} />
        <StyleSelect label="outline" onChange={(outline) => patchStyle({ outline: outline as StyleProfile["outline"] })} options={OUTLINES} value={style.outline} />
        <StyleSelect label="shading" onChange={(shading) => patchStyle({ shading: shading as StyleProfile["shading"] })} options={SHADINGS} value={style.shading} />
        <StyleSelect label="proportions" onChange={(proportions) => patchStyle({ proportions: proportions as StyleProfile["proportions"] })} options={PROPORTIONS} value={style.proportions} />
      </div>

      <label className="grid gap-1 font-mono text-[11px] text-muted-foreground">
        Art direction notes
        <Textarea
          className="min-h-16 rounded-sm font-sans text-xs"
          onChange={(event) => patchStyle({ notes: event.target.value })}
          placeholder="Muted, worn, industrial…"
          value={style.notes ?? ""}
        />
      </label>

      <fieldset className="grid gap-2 border-0 p-0">
        <legend className="mb-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Reference assets
        </legend>
        {projectAssets.length === 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground">No assets in this project.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {projectAssets.map((asset) => (
              <label className="flex min-w-0 items-center gap-2 text-xs" key={asset.id}>
                <Checkbox
                  checked={style.references.includes(asset.id)}
                  onCheckedChange={(checked) => toggleReference(asset.id, checked === true)}
                />
                <span className="truncate">{asset.name}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">{asset.id}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="grid gap-2 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <p className="text-xs">
            {violations.length === 0
              ? `${String(projectAssets.length)} asset${projectAssets.length === 1 ? "" : "s"} conform.`
              : `${String(violations.length)} asset${violations.length === 1 ? "" : "s"} violate this profile.`}
          </p>
          <Button
            className="ml-auto rounded-sm"
            disabled={projectAssets.length === 0}
            onClick={conformAll}
            size="sm"
            type="button"
          >
            Conform all
          </Button>
        </div>
        {violations.length > 0 ? (
          <ul className="grid gap-1">
            {violations.map(({ asset, report }) => (
              <li className="flex items-center gap-2 rounded-sm border border-destructive/20 px-2 py-1.5" key={asset.id}>
                <span className="min-w-0 truncate text-xs">{asset.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{asset.id}</span>
                <StyleViolationBadge className="ml-auto" report={report} />
              </li>
            ))}
          </ul>
        ) : null}
        {result === null ? null : (
          <p aria-live="polite" className="font-mono text-[11px] text-muted-foreground">{result}</p>
        )}
      </div>
    </section>
  );
}
