"use client";

import { useEffect, useRef, useState } from "react";
import { paletteHexes, type DocumentStore } from "@zenith/core";
import { Upload } from "lucide-react";
import { encodeIndexedPng } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { session } from "@/lib/editor";
import { DIRECTIONS, DIRECTION_SETS, type Direction } from "@/lib/directions";
import { findTool, runTool } from "@/lib/webmcp";
import { assetNavigation } from "@/lib/webmcp/navigation";
import { buildCharacterFromConcept } from "@/lib/webmcp/tools/authoring";
import { cn } from "@/lib/utils";
import { AssetThumbnail } from "./asset-thumbnail";

type DirectionSet = "cardinal4" | "ordinal8";
type TargetSize = 32 | 48 | 64 | 96 | 128;

function blobBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The concept image could not be read."));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string") {
        reject(new Error("The concept image could not be read."));
        return;
      }
      const comma = value.indexOf(",");
      if (comma < 0) {
        reject(new Error("The concept image has an invalid data URL."));
        return;
      }
      resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function fileBase64Png(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Could not prepare the concept image.");
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => value === null ? reject(new Error("Could not encode the concept image as PNG.")) : resolve(value), "image/png"),
    );
    return await blobBase64(png);
  } finally {
    bitmap.close();
  }
}

/**
 * The open asset, rendered as something a model can read.
 *
 * Upscaled to roughly 512px on its long side for the same reason a style
 * reference is: a 32x32 PNG gives an image model almost nothing to work from.
 * The scale stays an integer so the source it sees is the art, not a resampled
 * approximation of it.
 */
async function storeBase64Png(store: DocumentStore): Promise<string> {
  const scale = Math.max(1, Math.floor(512 / Math.max(store.width, store.height)));
  const png = encodeIndexedPng(store.readComposite(), paletteHexes(store.palette), { scale });
  // Through a Blob rather than String.fromCharCode over the array: a 512x512
  // PNG is hundreds of thousands of bytes and spreading that into a call
  // overflows the stack, which is exactly how the exporter broke once.
  return await blobBase64(new Blob([png as BlobPart], { type: "image/png" }));
}

async function executeTool(name: string, args: Readonly<Record<string, unknown>>): Promise<string> {
  const tool = findTool(name);
  if (tool === undefined) throw new Error(`The ${name} tool is not registered.`);
  const outcome = await runTool(tool, args, "console");
  if (!outcome.ok) throw new Error(outcome.text);
  return outcome.text;
}

/** Stages concept art, builds one base sprite, then explicitly completes its direction set. */
export function ReferenceTray({
  allowDirectionGeneration,
  assetId,
  store,
}: {
  readonly allowDirectionGeneration: boolean;
  readonly assetId: string;
  readonly store: DocumentStore;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  /** The staged concept: a file from disk, or the asset already open. */
  const [concept, setConcept] = useState<{ name: string; png: string } | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [outputId, setOutputId] = useState<string | null>(null);
  const [targetSize, setTargetSize] = useState<TargetSize>(32);
  const [directionSet, setDirectionSet] = useState<DirectionSet>("cardinal4");
  const [baseDirection, setBaseDirection] = useState<Direction>("south");
  const [busy, setBusy] = useState<"base" | "directions" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    return () => {
      if (sourceUrl !== null) URL.revokeObjectURL(sourceUrl);
    };
  }, [sourceUrl]);

  const output: DocumentStore | undefined = outputId === null ? undefined : session.get(outputId);

  /**
   * Stages the asset already open, instead of asking for a file.
   *
   * The tray was built for concept art arriving from disk, so with a character
   * on screen the build button simply sat greyed out — the source it wanted was
   * the thing the human was looking at. Explicit rather than a silent fallback:
   * the staged concept shows in the Source preview, so what the model will be
   * given is on screen before anything is spent.
   */
  const stageOpenAsset = async () => {
    setFailed(false);
    try {
      const png = await storeBase64Png(store);
      const name = session.list().find((asset) => asset.id === assetId)?.name ?? "Open asset";
      setConcept({ name, png });
      setOutputId(null);
      setSourceUrl(`data:image/png;base64,${png}`);
      setStatus(`Staged '${name}' as the concept.`);
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const buildBase = async () => {
    if (concept === null) return;
    setBusy("base");
    setFailed(false);
    setStatus("Extracting and pixelising the base sprite…");
    try {
      const result = await buildCharacterFromConcept({
        image: concept.png,
        name: concept.name,
        direction_set: directionSet,
        base_direction: baseDirection,
        target_width: targetSize,
      });
      setOutputId(result.baseId);
      setStatus(result.summary);
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const generateDirections = async () => {
    if (outputId === null) return;
    session.open(outputId);
    assetNavigation.request(outputId);
    setBusy("directions");
    setFailed(false);
    setStatus(`Generating the ${directionSet} set…`);
    try {
      setStatus(await executeTool("generate_direction_set", { set: directionSet, base_direction: baseDirection }));
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        <Upload aria-hidden className="size-3" strokeWidth={1.5} />
        From reference
      </h3>

      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <p className="mb-1 font-mono text-[10px] text-muted-foreground">Source</p>
          <div
            aria-label="Concept source preview"
            className="grid h-24 place-items-center overflow-hidden rounded-sm border border-border bg-muted/20 bg-contain bg-center bg-no-repeat font-mono text-[10px] text-muted-foreground"
            role="img"
            style={sourceUrl === null ? undefined : { backgroundImage: `url(${sourceUrl})` }}
          >
            {sourceUrl === null ? "No concept" : null}
          </div>
        </div>
        <div>
          <p className="mb-1 font-mono text-[10px] text-muted-foreground">Sprite</p>
          <div aria-label="Generated sprite preview" className="grid h-24 place-items-center overflow-hidden rounded-sm border border-border bg-muted/20">
            {output === undefined ? (
              <span className="font-mono text-[10px] text-muted-foreground">Build to preview</span>
            ) : (
              <AssetThumbnail size={88} store={output} />
            )}
          </div>
        </div>
      </div>

      <Input
        accept="image/png,image/jpeg,image/webp"
        aria-label="Concept image"
        className="hidden"
        onChange={(event) => {
          const next = event.target.files?.[0] ?? null;
          event.target.value = "";
          setOutputId(null);
          setFailed(false);
          if (next === null) {
            setConcept(null);
            setSourceUrl(null);
            setStatus(null);
            return;
          }
          setSourceUrl(URL.createObjectURL(next));
          void fileBase64Png(next)
            .then((png) => {
              setConcept({ name: next.name.replace(/\.[^.]+$/, ""), png });
              setStatus("Concept staged locally.");
            })
            .catch((error: unknown) => {
              setConcept(null);
              setFailed(true);
              setStatus(error instanceof Error ? error.message : String(error));
            });
        }}
        ref={input}
        type="file"
      />

      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <Select onValueChange={(value) => setTargetSize(Number(value) as TargetSize)} value={String(targetSize)}>
          <SelectTrigger aria-label="Target sprite size" className="w-full rounded-sm font-mono text-[11px]" size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="32">32×32</SelectItem>
            <SelectItem value="48">48×48</SelectItem>
            <SelectItem value="64">64×64</SelectItem>
            <SelectItem value="96">96×96</SelectItem>
            <SelectItem value="128">128×128</SelectItem>
          </SelectContent>
        </Select>
        <Select
          onValueChange={(value) => {
            const next = value as DirectionSet;
            setDirectionSet(next);
            if (!DIRECTION_SETS[next].some((direction) => direction === baseDirection)) setBaseDirection("south");
          }}
          value={directionSet}
        >
          <SelectTrigger aria-label="Reference direction set" className="w-full rounded-sm font-mono text-[11px]" size="sm"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="cardinal4">cardinal4</SelectItem><SelectItem value="ordinal8">ordinal8</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="mt-1.5">
        <Select onValueChange={(value) => setBaseDirection(value as Direction)} value={baseDirection}>
          <SelectTrigger aria-label="Direction shown by reference" className="w-full rounded-sm font-mono text-[11px]" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIRECTIONS.filter((direction) => DIRECTION_SETS[directionSet].some((candidate) => candidate === direction)).map((direction) => (
              <SelectItem key={direction} value={direction}>Reference faces {direction}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-1.5 grid gap-1">
        <Button className="h-7 justify-start rounded-sm text-xs" disabled={busy !== null} onClick={() => input.current?.click()} size="sm" type="button" variant="outline">
          {concept === null ? "Choose image…" : "Replace image…"}
        </Button>
        <Button
          className="h-7 justify-start rounded-sm text-xs"
          disabled={busy !== null}
          onClick={() => void stageOpenAsset()}
          size="sm"
          type="button"
          variant="outline"
        >
          Use open asset
        </Button>
        <Button
          className="h-7 justify-start rounded-sm text-xs"
          disabled={concept === null || busy !== null}
          onClick={() => void buildBase()}
          size="sm"
          title={concept === null ? "Choose a concept image, or use the open asset." : undefined}
          type="button"
          variant="outline"
        >
          {busy === "base" ? "Building base sprite…" : "Build base sprite"}
        </Button>
        {allowDirectionGeneration ? (
          <Button
            className="h-7 justify-start rounded-sm text-xs"
            disabled={outputId === null || busy !== null}
            onClick={() => void generateDirections()}
            size="sm"
            title={outputId === null ? "Build the base sprite first." : undefined}
            type="button"
            variant="outline"
          >
            {busy === "directions" ? "Generating directions…" : `Generate ${directionSet} directions`}
          </Button>
        ) : null}
      </div>

      {/*
        A disabled button with no explanation is a dead end: "Build base sprite"
        greys out until a concept image is staged, and nothing on screen said so.
        The steps run in order, so the hint names the next one rather than
        listing all three.
      */}
      {busy === null ? (
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {concept === null
            ? "Build from a drawing or photo of one character, or from the asset open right now."
            : outputId === null
              ? "Redraws the concept as one clean base sprite. Takes a minute. To turn a character you already have, use Directions above instead."
              : "Base sprite ready. Generating directions mirrors what it can and draws the rest."}
        </p>
      ) : null}

      {status === null ? null : (
        <p aria-live="polite" className={cn("mt-1.5 font-mono text-[10px] leading-relaxed", failed ? "text-destructive" : "text-muted-foreground")}>{status}</p>
      )}
    </section>
  );
}
