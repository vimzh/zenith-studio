"use client";

import { useCallback, useState } from "react";
import { Compass, Grid2x2, Palette, PersonStanding, RotateCw, Shapes, Sparkles, WandSparkles } from "lucide-react";
import { paletteHexes, type DocumentStore, type Region } from "@zenith/core";
import {
  directionFamily,
  generateDirections,
  generateTileset,
  readabilityOf,
  recolorAsset,
  rotateAsset,
  session,
  useSessionSelector,
  type AssetType,
  type ProjectLibrary,
} from "@/lib/editor";
import { BUILTIN_PALETTES, paletteHexes as hexesOf } from "@zenith/core";
import { CANVAS_PRESETS } from "@/lib/pixel";
import {
  DIRECTION_SETS,
  generationCount,
  mirrorableFrom,
  planDirectionSet,
  type DirectionSet,
} from "@/lib/directions";
import { TEMPLATE_NAMES, type CharacterType } from "@/lib/skeleton";
import { useStoreSelector } from "@/lib/pixel";
import { animationPanelCopy, directionPanelCopy, skeletonPanelCopy } from "@/data/agent";
import { useProjectSelector } from "@/components/app/use-projects";
import { cn } from "@/lib/utils";
import { Button as ShadcnButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { findTool, runTool } from "@/lib/webmcp";
import { ReferenceTray } from "./reference-tray";
import type { Facing, SkeletonController } from "./use-skeleton-rig";

/**
 * The contextual panel.
 *
 * Which tools appear depends on the asset's type, for the same reason the
 * WebMCP registry is view-scoped: a tile has no directions and a character has
 * no autotile set, and showing both to everyone makes the useful half harder to
 * find.
 */

const selectPalette = (store: DocumentStore) => paletteHexes(store.palette);
const selectProjectRevision = (library: ProjectLibrary) => library.revision;

async function executeTool(name: string, args: Readonly<Record<string, unknown>>): Promise<string> {
  const tool = findTool(name);
  if (tool === undefined) throw new Error(`The ${name} tool is not registered.`);
  const outcome = await runTool(tool, args, "console");
  if (!outcome.ok) throw new Error(outcome.text);
  return outcome.text;
}

export function AssetPanel({
  assetId,
  selection,
  skeleton,
  store,
  type,
}: {
  assetId: string;
  selection: Region | null;
  skeleton: SkeletonController;
  store: DocumentStore;
  type: AssetType;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (work: () => string | Promise<string>) => {
    setBusy(true);
    try {
      setFailed(false);
      setStatus(await work());
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-3 border-t border-border p-3">
      <TypeSection assetId={assetId} type={type} />

      {type === "character" ? (
        <>
          <DirectionsSection assetId={assetId} busy={busy} run={run} />
          <AnimationSection busy={busy} run={run} />
          <SkeletonSection busy={busy} run={run} skeleton={skeleton} />
        </>
      ) : null}

      {type === "tile" || type === "texture" ? (
        <TilesetSection assetId={assetId} busy={busy} run={run} store={store} />
      ) : null}

      <PaletteSection assetId={assetId} busy={busy} run={run} />
      <TransformSection assetId={assetId} busy={busy} run={run} />
      <InpaintSection busy={busy} run={run} selection={selection} />
      <ReferenceTray
        allowDirectionGeneration={type === "character"}
        assetId={assetId}
        store={store}
      />

      {status !== null ? (
        <p
          aria-live="polite"
          className={cn(
            "font-mono text-[11px] leading-relaxed",
            failed ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}

function Section({
  children,
  icon: Icon,
  title,
}: {
  children: React.ReactNode;
  icon: typeof Compass;
  title: string;
}) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        <Icon aria-hidden className="size-3" strokeWidth={1.5} />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Button({
  busy,
  children,
  onClick,
}: {
  busy?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <ShadcnButton
      className={cn(
        "h-auto w-full justify-start whitespace-normal rounded-sm border border-border px-2 py-1.5 text-left text-xs transition-colors",
        "hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40"
      )}
      disabled={busy}
      onClick={onClick}
      type="button"
      variant="outline"
    >
      {children}
    </ShadcnButton>
  );
}

/** The five things an asset can be. Type decides which capabilities apply. */
const ASSET_TYPES: readonly AssetType[] = ["character", "tile", "texture", "item", "ui"];

/**
 * What the asset is, and therefore what it can do.
 *
 * Every generative entry point defaults to `tile`, so a character generated
 * from a prompt arrives typed as one — and the Directions, Animation and
 * Skeleton sections are character-only, as is the `scope: "character"` half of
 * the tool surface. The asset was plainly a character and the whole directional
 * workflow was unreachable, with nothing on screen saying why. Changing type is
 * metadata: no rebuild, no lost undo history.
 */
function TypeSection({ assetId, type }: { assetId: string; type: AssetType }) {
  return (
    <Section icon={Shapes} title="Type">
      <Select onValueChange={(value) => session.setType(assetId, value as AssetType)} value={type}>
        <SelectTrigger aria-label="Asset type" className="w-full rounded-sm font-mono text-[11px]" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ASSET_TYPES.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
        Decides which tools apply: a character gets directions, animation and a
        skeleton; a tile gets seam checking and tilesets.
      </p>
    </Section>
  );
}

function DirectionsSection({
  assetId,
  busy,
  run,
}: {
  assetId: string;
  busy: boolean;
  run: (work: () => string | Promise<string>) => Promise<void>;
}) {
  const [set, setSet] = useState<DirectionSet>("cardinal4");

  /**
   * What this set would actually cost, shown before the click.
   *
   * Mirroring only helps once a partner exists. A front- or back-facing base
   * has none — so "generate cardinal4" from that single sprite mirrors nothing.
   * Promising free mirrors and delivering zero is worse than saying plainly
   * that three of the four need a model.
   */
  const projectRevision = useProjectSelector(selectProjectRevision);
  const family = useSessionSelector(useCallback(() => {
    // Placement changes do not bump the editor session's revision.
    void projectRevision;
    return directionFamily(assetId);
  }, [assetId, projectRevision]));
  const base = family.direction ?? (set === "side2" ? "east" : "south");
  const have = [...new Set([...family.assets.keys(), base])];
  const plan = planDirectionSet(have, set);
  // `mirrorableFrom`, not the plan's mirror count: the plan assumes every
  // generation succeeds, so it counts west as mirrorable because east will
  // exist by then. With no generator east never arrives and west is unreachable
  // too, so the plan's number promises assets that cannot be produced.
  const mirrored = mirrorableFrom(have, set).length;
  const missing = plan.filter((step) => step.method !== "have").length;
  const needsModel = missing - mirrored;
  const withGeneration = generationCount(plan);

  return (
    <Section icon={Compass} title="Directions">
      <Select
        onValueChange={(value) => setSet(value as DirectionSet)}
        value={set}
      >
        <SelectTrigger aria-label="Direction set" className="mb-1.5 w-full rounded-sm font-mono text-[11px]" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(DIRECTION_SETS) as DirectionSet[]).map((option) => (
            <SelectItem key={option} value={option}>
              {option} ({DIRECTION_SETS[option].length})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mb-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {missing === 0
          ? directionPanelCopy.complete(set)
          : mirrored > 0
            ? directionPanelCopy.mirrored(mirrored, needsModel)
            : directionPanelCopy.missing(missing, withGeneration)}
      </p>
      <Button
        busy={busy || mirrored === 0}
        onClick={() => void run(() => generateDirections(assetId, set))}
      >
        {mirrored > 0 ? `Create ${String(mirrored)} by mirroring` : "Nothing to derive"}
      </Button>
      <div className="mt-1">
        <Button
          busy={busy || missing === 0}
          onClick={() => void run(() => executeTool("generate_direction_set", {
            set,
            base_direction: base,
          }))}
        >
          Complete {set}
        </Button>
      </div>
    </Section>
  );
}

function AnimationSection({
  busy,
  run,
}: {
  busy: boolean;
  run: (work: () => string | Promise<string>) => Promise<void>;
}) {
  const [description, setDescription] = useState("");
  const [effects, setEffects] = useState("");
  const [frames, setFrames] = useState(4);

  return (
    <Section icon={Sparkles} title={animationPanelCopy.title}>
      <div className="grid grid-cols-[1fr_4.5rem] gap-1.5">
        <Input
          aria-label={animationPanelCopy.descriptionLabel}
          className="h-7 rounded-sm text-xs"
          onChange={(event) => setDescription(event.target.value)}
          placeholder={animationPanelCopy.descriptionPlaceholder}
          value={description}
        />
        <Input
          aria-label={animationPanelCopy.framesLabel}
          className="h-7 rounded-sm font-mono text-xs"
          max={12}
          min={2}
          onChange={(event) => setFrames(Math.max(2, Math.min(12, Number(event.target.value) || 2)))}
          type="number"
          value={frames}
        />
      </div>
      <Input
        aria-label={animationPanelCopy.effectsLabel}
        className="mt-1.5 h-7 rounded-sm text-xs"
        onChange={(event) => setEffects(event.target.value)}
        placeholder={animationPanelCopy.effectsPlaceholder}
        value={effects}
      />
      <div className="mt-1.5">
        <Button
          busy={busy || description.trim() === ""}
          onClick={() =>
            void run(() =>
              executeTool("animate_with_text", {
                description: description.trim(),
                frames,
                ...(effects.trim() === "" ? {} : { effects: effects.trim() }),
              }),
            )
          }
        >
          {animationPanelCopy.generateLabel}
        </Button>
      </div>
      <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {animationPanelCopy.hint}
      </p>
    </Section>
  );
}

function InpaintSection({
  busy,
  run,
  selection,
}: {
  busy: boolean;
  run: (work: () => string | Promise<string>) => Promise<void>;
  selection: Region | null;
}) {
  const [prompt, setPrompt] = useState("");
  const selected = selection === null
    ? "Select a region first"
    : `Inpaint ${String(selection.width)}×${String(selection.height)} selection`;

  return (
    <Section icon={WandSparkles} title="Inpaint selection">
      <Textarea
        aria-label="Inpaint instruction"
        className="min-h-14 rounded-sm text-xs"
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="Repair the shield edge…"
        value={prompt}
      />
      <div className="mt-1.5">
        <Button
          busy={busy || selection === null || prompt.trim() === ""}
          onClick={() => {
            if (selection === null) return;
            void run(() => executeTool("inpaint_region", { ...selection, prompt: prompt.trim() }));
          }}
        >
          {selected}
        </Button>
      </div>
    </Section>
  );
}

function TilesetSection({
  assetId,
  busy,
  run,
  store,
}: {
  assetId: string;
  busy: boolean;
  run: (work: () => string | Promise<string>) => Promise<void>;
  store: DocumentStore;
}) {
  const palette = useStoreSelector(store, selectPalette);
  const [edge, setEdge] = useState<number>(-1);

  return (
    <Section icon={Grid2x2} title="Autotile">
      <Select
        onValueChange={(value) => setEdge(Number(value))}
        value={String(edge)}
      >
        <SelectTrigger aria-label="Edge colour" className="mb-1.5 w-full rounded-sm font-mono text-[11px]" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="-1">No edge treatment</SelectItem>
          {palette.map((hex, index) => (
            <SelectItem key={hex} value={String(index)}>Edge: {hex}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        busy={busy}
        onClick={() => void run(() => generateTileset(assetId, edge < 0 ? undefined : edge))}
      >
        Derive 47-tile set
      </Button>
    </Section>
  );
}

function SkeletonSection({
  busy,
  run,
  skeleton,
}: {
  busy: boolean;
  run: (work: () => string | Promise<string>) => Promise<void>;
  skeleton: SkeletonController;
}) {
  const [template, setTemplate] = useState("walk");
  const [frames, setFrames] = useState(4);
  const copy = skeletonPanelCopy;
  const open = skeleton.pose !== null;
  const quadruped = skeleton.type === "quadrupedal";

  return (
    <Section icon={PersonStanding} title={copy.title}>
      <div className="flex flex-col gap-1">
        <Select
          onValueChange={(value) => void run(() => skeleton.estimate(value as CharacterType))}
          value={skeleton.type}
        >
          <SelectTrigger aria-label={copy.typeLabel} className="w-full rounded-sm font-mono text-[11px]" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {copy.types.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button busy={busy} onClick={() => void run(() => skeleton.estimate())}>
          {open ? copy.reestimateLabel : copy.estimateLabel}
        </Button>
        {open ? (
          <>
            {quadruped ? null : (
              <>
                <Select onValueChange={(value) => skeleton.setFacing(value as Facing)} value={skeleton.facing}>
                  <SelectTrigger aria-label={copy.facingLabel} className="w-full rounded-sm font-mono text-[11px]" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {copy.facings.map((entry) => (
                      <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  onValueChange={(value) => {
                    setTemplate(value);
                    skeleton.applyTemplatePose(value);
                  }}
                  value={template}
                >
                  <SelectTrigger aria-label={copy.templateLabel} className="w-full rounded-sm font-mono text-[11px]" size="sm">
                    <SelectValue placeholder={copy.templatePlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_NAMES.map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-[1fr_4.5rem] gap-1">
                  <Button busy={busy} onClick={() => void run(() => skeleton.buildCycle(template, frames))}>
                    {copy.buildCycleLabel(template)}
                  </Button>
                  <Input
                    aria-label={copy.framesLabel}
                    className="h-7 rounded-sm font-mono text-xs"
                    max={32}
                    min={2}
                    onChange={(event) => setFrames(Math.max(2, Math.min(32, Number(event.target.value) || 2)))}
                    type="number"
                    value={frames}
                  />
                </div>
              </>
            )}
            <Button busy={busy} onClick={() => void run(skeleton.bake)}>
              {copy.bakeLabel}
            </Button>
            <div className="grid grid-cols-2 gap-1">
              <Button onClick={skeleton.reset}>{copy.resetLabel}</Button>
              <Button onClick={skeleton.hide}>{copy.hideLabel}</Button>
            </div>
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              {quadruped ? copy.quadrupedHint : copy.hint}
            </p>
          </>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * Palette swapping.
 *
 * Offers the hardware palettes from `@zenith/core` alongside the editor presets
 * — Game Boy and PICO-8 shipped in core from phase 01 and were unreachable from
 * the app until now.
 *
 * Colours are matched perceptually into the selected palette, so palettes with
 * fewer entries work without invalidating existing pixels.
 */
function PaletteSection({
  assetId,
  busy,
  run,
}: {
  assetId: string;
  busy: boolean;
  run: (work: () => string | Promise<string>) => Promise<void>;
}) {
  const options = [
    ...Object.entries(BUILTIN_PALETTES).map(([id, palette]) => ({
      id: `core:${id}`,
      label: `${palette.name} (${String(palette.colors.length)})`,
      colors: hexesOf(palette),
    })),
    ...CANVAS_PRESETS.map((preset) => ({
      id: `preset:${preset.id}`,
      label: `${preset.name} (${String(preset.colors.length)})`,
      colors: preset.colors,
    })),
  ];

  return (
    <Section icon={Palette} title="Palette">
      <Select
        onValueChange={(value) => {
          const option = options.find((entry) => entry.id === value);
          if (option !== undefined) {
            void run(() => recolorAsset(assetId, option.colors, option.label));
          }
        }}
        value=""
      >
        <SelectTrigger
          aria-label="Swap palette"
          className="w-full rounded-sm font-mono text-[11px]"
          disabled={busy}
          size="sm"
        >
          <SelectValue placeholder="Swap palette…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
        Colours are matched to the nearest shade in the selected palette.
      </p>
    </Section>
  );
}

function TransformSection({
  assetId,
  busy,
  run,
}: {
  assetId: string;
  busy: boolean;
  run: (work: () => string | Promise<string>) => Promise<void>;
}) {
  return (
    <Section icon={RotateCw} title="Transform">
      <div className="flex flex-col gap-1">
        <Button busy={busy} onClick={() => void run(() => rotateAsset(assetId, 90))}>
          Rotate 90° — exact, no resampling
        </Button>
        <Button busy={busy} onClick={() => void run(() => readabilityOf(assetId))}>
          Check readability at 1×
        </Button>
      </div>
    </Section>
  );
}
