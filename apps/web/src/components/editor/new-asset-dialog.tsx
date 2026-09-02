"use client";

import { useCallback, useRef, useState } from "react";
import { Plus, Upload, X } from "lucide-react";
import { BUILTIN_PALETTES, paletteHexes } from "@zenith/core";
import { CANVAS_PRESETS } from "@/lib/pixel";
import { importImageAsAsset, session, type AssetType } from "@/lib/editor";
import { cn } from "@/lib/utils";
import { imageToRaster } from "./raster";

/**
 * Creating an asset.
 *
 * Size and palette are chosen separately here, where the old inline control
 * welded them together through a preset. They are genuinely independent —
 * "8×8 with the PICO-8 palette" is an ordinary thing to want, and a preset list
 * cannot express the combinations.
 */

/** Common pixel-art canvas sizes. Anything else goes in the custom field. */
const SIZES = [8, 16, 24, 32, 48, 64, 96, 128] as const;

const TYPES: readonly AssetType[] = ["tile", "character", "texture", "item", "ui"];

interface PaletteOption {
  readonly id: string;
  readonly label: string;
  readonly colors: readonly string[];
}

const PALETTES: readonly PaletteOption[] = [
  ...Object.entries(BUILTIN_PALETTES).map(([id, palette]) => ({
    id: `core:${id}`,
    label: `${palette.name} · ${String(palette.colors.length)}`,
    colors: paletteHexes(palette),
  })),
  ...CANVAS_PRESETS.map((preset) => ({
    id: `preset:${preset.id}`,
    label: `${preset.name} · ${String(preset.colors.length)}`,
    colors: preset.colors,
  })),
];

export function NewAssetDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AssetType>("tile");
  const [size, setSize] = useState(32);
  const [customSize, setCustomSize] = useState("");
  const [paletteId, setPaletteId] = useState(PALETTES[PALETTES.length - 1]?.id ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const resolved = customSize === "" ? size : Number(customSize);
  const sizeValid = Number.isInteger(resolved) && resolved >= 4 && resolved <= 256;
  const palette = PALETTES.find((option) => option.id === paletteId) ?? PALETTES[0];

  const onCreate = useCallback(() => {
    if (!sizeValid || palette === undefined) {
      return;
    }
    const id = session.create({
      name: name.trim() === "" ? `${type} ${String(resolved)}²` : name.trim(),
      type,
      preset: "tile-32",
      palette: palette.colors,
      width: resolved,
      height: resolved,
    });
    onCreated(id);
  }, [name, onCreated, palette, resolved, sizeValid, type]);

  const onImport = useCallback(
    async (file: File) => {
      if (!sizeValid) {
        return;
      }
      try {
        setFailed(false);
        setStatus("Reading image…");
        const raster = await imageToRaster(file);
        const result = importImageAsAsset(raster, file.name.replace(/\.[^.]+$/, ""), {
          targetWidth: resolved,
          targetHeight: resolved,
          type,
        });
        onCreated(result.id);
      } catch (error) {
        setFailed(true);
        setStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [onCreated, resolved, sizeValid, type]
  );

  return (
    <div
      aria-label="New asset"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6"
      role="dialog"
    >
      <div className="w-[min(420px,100%)] rounded-md border border-border bg-background">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">New asset</h2>
          <button
            aria-label="Close"
            className="flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden className="size-4" strokeWidth={1.5} />
          </button>
        </header>

        <div className="flex flex-col gap-4 p-4">
          <Field label="Name">
            <input
              aria-label="Asset name"
              className="h-8 w-full rounded-sm border border-border bg-card px-2 text-sm"
              onChange={(event) => setName(event.target.value)}
              placeholder={`${type} ${String(resolved)}²`}
              value={name}
            />
          </Field>

          <Field label="Type">
            <div className="flex flex-wrap gap-1">
              {TYPES.map((option) => (
                <Chip active={type === option} key={option} onClick={() => setType(option)}>
                  {option}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Size">
            <div className="flex flex-wrap gap-1">
              {SIZES.map((option) => (
                <Chip
                  active={customSize === "" && size === option}
                  key={option}
                  onClick={() => {
                    setSize(option);
                    setCustomSize("");
                  }}
                >
                  {option}²
                </Chip>
              ))}
              <input
                aria-label="Custom size"
                className={cn(
                  "h-7 w-16 rounded-sm border bg-card px-2 font-mono text-xs",
                  customSize !== "" && !sizeValid ? "border-destructive" : "border-border"
                )}
                inputMode="numeric"
                onChange={(event) => setCustomSize(event.target.value.replace(/\D/g, ""))}
                placeholder="custom"
                value={customSize}
              />
            </div>
            {customSize !== "" && !sizeValid ? (
              <p className="mt-1 font-mono text-[11px] text-destructive">
                Size must be a whole number between 4 and 256.
              </p>
            ) : null}
          </Field>

          <Field label="Palette">
            <select
              aria-label="Palette"
              className="h-8 w-full rounded-sm border border-border bg-card px-2 font-mono text-xs"
              onChange={(event) => setPaletteId(event.target.value)}
              value={paletteId}
            >
              {PALETTES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <input
            accept="image/*"
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

          <div className="flex gap-2">
            <button
              className={cn(
                "inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-sm bg-primary px-3 text-sm text-primary-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:opacity-40"
              )}
              disabled={!sizeValid}
              onClick={onCreate}
              type="button"
            >
              <Plus aria-hidden className="size-4" strokeWidth={1.5} />
              Create blank
            </button>
            <button
              className={cn(
                "inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-sm border border-border px-3 text-sm",
                "hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:opacity-40"
              )}
              disabled={!sizeValid}
              onClick={() => fileInput.current?.click()}
              type="button"
            >
              <Upload aria-hidden className="size-4" strokeWidth={1.5} />
              From image
            </button>
          </div>

          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            An imported image is pixelised to {String(resolved)}×{String(resolved)} and keeps the
            palette the pipeline extracts, not the one chosen above.
          </p>

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
      </div>
    </div>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "h-7 rounded-sm border px-2 font-mono text-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-foreground bg-accent" : "border-border hover:border-foreground/30"
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
