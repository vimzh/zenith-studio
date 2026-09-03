import {
  bucketFill,
  checkSeamlessTiling,
  createPalette,
  expectedSize,
  hexToOklab,
  MAX_PALETTE_SIZE,
  DEFAULT_PALETTE_SIZE,
  nearestIndex,
  oklabDistance,
  styleBrief,
  TRANSPARENT,
  type DocumentStore,
  type Grid,
  type StyleProfile,
} from "@zenith/core";
import { assertGenerationDestination, projects, session, type AssetSummary, type AssetType } from "@/lib/editor";
import { encodeIndexedPng } from "@/lib/export";
import { CANVAS_PRESETS, DEFAULT_PRESET_ID, findPreset } from "@/lib/pixel";
import { frameToCanvas, pixelizeAsync } from "@/lib/pixelize";
import { deriveImage, deriveImages, generateImage, type GenerateResponse } from "../api";
import { assetNavigation } from "../navigation";
import { decodeBase64Png } from "../raster";
import {
  readArray,
  readEnum,
  readInteger,
  readOptionalInteger,
  readOptionalString,
  readString,
} from "../args";
import { ToolError, type ToolDefinition } from "../types";
import { asOneEdit, assertEditTarget, captureEditTarget, requireActiveAsset, toToolError } from "./active";

/**
 * Generation — the one path that leaves the browser.
 *
 * A model returns a soft, anti-aliased, thousand-colour image no matter how the
 * prompt is phrased. What makes it pixel art is the step after: the pipeline
 * detects the grid the model was gesturing at, resolves each cell to a single
 * palette index, and binarises alpha. So this tool is generate *and* pixelise —
 * splitting them would let a raster image into the library, and the whole point
 * is that one never exists as an asset.
 */

const ASSET_TYPES = ["character", "tile", "texture", "item", "ui"] as const;

/** Types that are a subject on a background, rather than filling their frame. */
const SPRITE_TYPES = new Set<AssetType>(["character", "item", "ui"]);
const SIZES = ["1024x1024", "1024x1536", "1536x1024"] as const;
const BACKGROUNDS = ["transparent", "opaque"] as const;

export function generationKind(
  type: AssetType,
  background?: (typeof BACKGROUNDS)[number],
): "sprite" | "texture" {
  if (background !== undefined) return background === "transparent" ? "sprite" : "texture";
  return SPRITE_TYPES.has(type) ? "sprite" : "texture";
}


/**
 * The style context a generation should carry, when there is a project to carry it.
 *
 * Two levers, in increasing strength. The brief is words: camera angle, outline,
 * shading, the exact palette, and the feature-count bound that stops the model
 * composing finer than the grid can hold. The reference is an image: the
 * project's own art, handed to `images.edit` so the model is *shown* the style
 * rather than told it.
 *
 * Showing beats telling here, which is why references exist at all — but the
 * brief still travels with them, because an edit request with no instructions
 * drifts toward reproducing its source.
 */
interface StyleContext {
  readonly id: string;
  readonly project: string;
  readonly style: StyleProfile;
  readonly brief: string;
  /** A reference asset rendered as a PNG, when the project has one. */
  readonly reference: { readonly id: string; readonly png: Uint8Array } | null;
}

function activeStyleContext(assetType: string): StyleContext | null {
  const projectId = projects.activeProjectId;
  const project = projectId === null ? undefined : projects.getProject(projectId);
  if (project === undefined) return null;

  return {
    id: project.id,
    project: project.name,
    style: project.style,
    // Not `lockPalette` — see `StyleBriefOptions`. A project palette handed to
    // an image model as a law makes every asset in the project look like the
    // same asset. It stays in the contract, where `check_style_consistency`
    // reports it and `conform_to_style` applies it when the human asks.
    brief: styleBrief(project.style, assetType, { lockPalette: false }),
    reference: firstUsableReference(project.style),
  };
}

/**
 * The first reference that still resolves to art.
 *
 * References are asset ids and assets can be deleted, so a stale id is a normal
 * state rather than an error — it is skipped, not reported, because failing a
 * generation over a reference the user removed weeks ago would be absurd.
 */
function firstUsableReference(style: StyleProfile): StyleContext["reference"] {
  for (const id of style.references) {
    const store = session.get(id);
    if (store === undefined) continue;
    const palette = store.palette.colors.map((colour) => colour.hex);
    // Upscaled, because a 32x32 PNG gives the model almost nothing to read.
    const scale = Math.max(1, Math.floor(512 / Math.max(store.width, store.height)));
    return { id, png: encodeIndexedPng(store.readComposite(), palette, { scale }) };
  }
  return null;
}

interface GeneratedArtwork {
  readonly grid: Grid;
  /** The palette `grid` is indexed against — locked, or the one the image had. */
  readonly palette: readonly string[];
  readonly model: string;
  /** How the pixeliser read the image, for the message handed back to the agent. */
  readonly note: string;
}

/**
 * Prompt to indexed grid: the whole generation path, minus where it lands.
 *
 * Shared by `generate_asset`, which creates an asset from it, and
 * `draw_from_prompt`, which writes it into the asset already open. Splitting on
 * the destination rather than duplicating the pipeline matters because every
 * step here is a hard-won default — the framing crop, the palette conformance,
 * the square check — and a second copy would drift from this one silently.
 */
async function generateArtwork(params: {
  readonly prompt: string;
  readonly type: AssetType;
  readonly kind: "sprite" | "texture";
  readonly width: number;
  /**
   * Colours the result must land in, or undefined to keep what the image had.
   *
   * Locked only where the caller chose a palette *for this generation* — a
   * canvas preset. A project's palette is deliberately not a lock: see
   * `activeStyleContext`.
   */
  readonly lockedColors?: readonly string[];
  readonly style: StyleContext | null;
  readonly size?: (typeof SIZES)[number];
}): Promise<GeneratedArtwork> {
  const { kind, lockedColors, prompt, style, width } = params;
  const conditioned = style === null ? prompt : `${prompt}. ${style.brief}`;

  // A reference is stronger than a brief, because it shows rather than tells.
  // It only applies when the project has one; otherwise this is text-only
  // generation with a richer prompt.
  const generated =
    style?.reference != null
      ? await deriveImage(
          style.reference.png,
          `Draw a completely new subject: ${conditioned} Match the reference image's palette, outline treatment, ` +
            `shading depth and pixel scale exactly. Do not reproduce the reference's subject.`,
          kind,
          // Explicit, though it is the default: `vary` keeps the camera and
          // changes the subject, which is what conditioning a new asset on a
          // reference means. Leaving it implicit is how rotation broke — a
          // default that silently meant the opposite of what was wanted.
          "vary",
        )
      : await generateImage({
          prompt: conditioned,
          // Sent only when it is a law. Naming colours the model may not leave
          // is what makes a project's assets look like one another instead of
          // like themselves.
          ...(lockedColors === undefined ? {} : { palette: [...lockedColors] }),
          // Composition, rather than asset type alone, decides whether this
          // fills the frame. Isometric tiles are still tiles, but isolated.
          kind,
          // The grid the result lands on. Without it the model composes for
          // 1024px and the resampler averages the detail into mud — which is
          // exactly what "it looks ugly at 32x32" is, every time.
          cells: width,
          ...(params.size === undefined ? {} : { size: params.size }),
        });

  const raster = await decodeBase64Png(generated.image);

  /**
   * Sprites get framed first; tiles and textures never do.
   *
   * A model returns the subject floating in the middle of a flat background —
   * measured at 47% of the frame width on a full-body character, so 17 of 32
   * columns were background and the character was drawn in about 15x22. The
   * framing step drops the background, crops to the subject, and scales it to
   * fill the canvas, which is most of the difference between a muddy sprite
   * and a readable one.
   *
   * A tile is excluded because it legitimately fills its frame and has no
   * background: the flood fill would start from a border that is real artwork
   * and eat any mortar line running to the edge, and the coverage check would
   * accept the holed result because it is still tightly bounded.
   */
  const framed = kind === "sprite" ? frameToCanvas(raster, width, width, { padding: Math.max(2, Math.round(width / 32)) }) : null;
  const source = framed?.image ?? raster;

  let result;
  try {
    result = await pixelizeAsync(source, {
      targetWidth: width,
      maxColors: lockedColors?.length ?? DEFAULT_PALETTE_SIZE,
    });
  } catch (error) {
    throw toToolError(error);
  }
  if (result.palette.length === 0) {
    throw new ToolError(
      "Pixelisation produced an empty palette; the generated image had no opaque pixels.",
    );
  }
  if (result.grid.width !== width || result.grid.height !== width) {
    throw new ToolError(
      `Pixelisation produced a ${String(result.grid.width)}x${String(result.grid.height)} grid but the target is ` +
        `${String(width)}x${String(width)}. Ask for a square size, or pick a preset matching the aspect ratio.`,
    );
  }

  const confidence =
    result.confidence < 0.5
      ? ` Grid confidence was low (${result.confidence.toFixed(2)}), so the detector preserved rather than guessed — call read_canvas and check it reads correctly.`
      : "";
  const warnings = result.warnings.length === 0 ? "" : `\nWarnings: ${result.warnings.join("; ")}`;

  return {
    grid:
      lockedColors === undefined
        ? result.grid
        : conformToPalette(result.grid, result.palette, lockedColors),
    palette: lockedColors ?? result.palette,
    model: generated.model,
    note: `detected cell size ${String(result.scale)}, input classified '${result.kind}'${confidence}${warnings}`,
  };
}

export const generateAsset: ToolDefinition = {
  scope: "always",
  network: true,
  name: "generate_asset",
  description:
    "Create and open an indexed asset from a prompt, applying project style/reference. Returns ID, size and pixelisation warnings. Slow and paid (20–157s measured); concurrent calls refused. Never retry merely for slowness: retries buy images. Prefer deterministic tools when suitable.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "What to draw. Name the subject, pose or action, view angle, and key materials; for a texture, name only its surface material(s). Style is enforced afterwards.",
      },
      name: {
        type: "string",
        description: "Name for the new asset. Defaults to the prompt.",
      },
      type: {
        type: "string",
        enum: [...ASSET_TYPES],
        description:
          "Asset type. Determines which tools apply to it later. Defaults to tile.",
      },
      preset: {
        type: "string",
        enum: CANVAS_PRESETS.map((preset) => preset.id),
        description: `Canvas size and palette for the finished asset. Defaults to ${DEFAULT_PRESET_ID}.`,
      },
      size: {
        type: "string",
        enum: [...SIZES],
        description: "Aspect ratio to ask the model for. Defaults to square.",
      },
      background: {
        type: "string",
        enum: [...BACKGROUNDS],
        description:
          "Composition override. Defaults to transparent for characters, items and UI, and opaque for tiles and textures. Use transparent for an isolated tile such as an isometric diamond.",
      },
    },
    required: ["prompt"],
  },
  example: {
    prompt: "a mossy cobblestone tile, top-down",
    type: "tile",
    preset: "tile-32",
  },
  execute: async (args) => {
    const prompt = readString(args, "prompt");
    const type = readEnum<AssetType>(args, "type", ASSET_TYPES, "tile");
    const size =
      args["size"] === undefined ? undefined : readEnum(args, "size", SIZES);
    const background =
      args["background"] === undefined
        ? undefined
        : readEnum(args, "background", BACKGROUNDS);
    const kind = generationKind(type, background);
    const name =
      args["name"] === undefined
        ? prompt.slice(0, 40)
        : readString(args, "name");

    const presetId =
      args["preset"] === undefined
        ? DEFAULT_PRESET_ID
        : readEnum(
            args,
            "preset",
            CANVAS_PRESETS.map((each) => each.id),
          );
    const preset = findPreset(presetId);
    if (preset === undefined) throw new ToolError(`No preset '${presetId}'.`);

    // Inside a project, generation is conditioned on the style contract rather
    // than on the sentence alone. This is the whole argument for projects:
    // "generate a slime enemy" is underspecified in a chat window and fully
    // determined here — camera angle, outline, shading, palette, feature scale.
    const style = activeStyleContext(type);
    const destination = { projectId: projects.activeProjectId, folderId: projects.activeFolderId };
    const targetWidth = style === null ? preset.width : (expectedSize(style.style, type) ?? preset.width);

    const artwork = await generateArtwork({
      prompt,
      type,
      kind,
      width: targetWidth,
      // Inside a project the asset keeps the colours the image actually had.
      // Outside one, the preset is a palette the caller picked for this call,
      // so it still applies.
      ...(style === null ? { lockedColors: preset.colors } : {}),
      style,
      ...(size === undefined ? {} : { size }),
    });

    assertGenerationDestination(destination);
    const id = session.create({
      name,
      type,
      grid: artwork.grid,
      palette: [...artwork.palette],
      width: targetWidth,
      height: targetWidth,
    });
    if (destination.projectId !== null && !projects.place(id, destination.projectId, destination.folderId)) {
      throw new ToolError(`The generation destination changed before '${id}' could be placed. The asset is available in the loose library.`);
    }
    assetNavigation.request(id);

    return (
      `Generated '${name}' as ${id} with ${MODEL_NOTE(artwork.model)}, pixelised to ` +
      `${String(targetWidth)}x${String(targetWidth)} on a ${String(artwork.palette.length)}-colour palette ` +
      `${style === null ? `conformed to the '${presetId}' preset` : `of its own, matching the '${style.project}' project's form but not its colours — run check_style_consistency and conform_to_style if you want it inside the project palette`} ` +
      `(${artwork.note})\n` +
      `It is open in the editor. Call read_canvas to see it.`
    );
  },
};

/**
 * Generation into the asset the human already has open.
 *
 * The chat's missing verb. Asked to "make a bush" on an empty canvas the model
 * had no way to generate into it — every generative tool it could reach either
 * created a different asset or needed existing art to edit — so it hand-drew
 * the sprite one `set_pixels` call at a time: eight turns, the whole turn
 * budget, and a shapeless green mass at the end of it. One image call does the
 * same job in one turn and produces art.
 *
 * It replaces the current frame rather than adding an asset, because that is
 * what "draw a bush on this canvas" means, and it goes through `asOneEdit`, so
 * a single Ctrl+Z puts back whatever was there.
 */
export const drawFromPrompt: ToolDefinition = {
  network: true,
  name: "draw_from_prompt",
  description:
    "Replace the open asset's current frame from a prompt, matching its palette/project style; one undo. Use for new subjects, not pixel-by-pixel sprite drawing. Slow and paid (20–157s measured); concurrent calls refused; retries buy images. Use deterministic edits or inpaint_region for local changes.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "What to draw. Name the subject, pose or action, view angle, and key materials; for a texture, name only its surface material(s). Style is enforced afterwards.",
      },
      background: {
        type: "string",
        enum: [...BACKGROUNDS],
        description:
          "Composition override. Defaults to transparent for characters, items and UI, and opaque for tiles and textures. Use transparent for an isolated subject on a tile canvas.",
      },
    },
    required: ["prompt"],
  },
  example: { prompt: "a round leafy bush" },
  execute: async (args) => {
    const active = requireActiveAsset();
    const target = captureEditTarget(active);
    const prompt = readString(args, "prompt");
    const background =
      args["background"] === undefined ? undefined : readEnum(args, "background", BACKGROUNDS);

    // The summary's type is a string; only the five real types drive generation
    // rules, and anything else is treated as a tile rather than refused.
    const type = (ASSET_TYPES as readonly string[]).includes(active.type)
      ? (active.type as AssetType)
      : "tile";
    const { store } = active;
    if (store.width !== store.height) {
      throw new ToolError(
        `'${active.name}' is ${String(store.width)}x${String(store.height)}. Generation targets a square canvas; ` +
          `draw this one with the editing tools, or create a square asset.`,
      );
    }

    const artwork = await generateArtwork({
      prompt,
      type,
      kind: generationKind(type, background),
      width: store.width,
      style: activeStyleContext(type),
    });

    assertEditTarget(target);
    const merge = planGeneratedPalette(store, artwork.palette);
    const changed = asOneEdit(store, "draw_from_prompt", () => {
      store.setPalette(merge.colors);
      return store.writeRegion(0, 0, conformToPalette(artwork.grid, artwork.palette, merge.colors));
    });
    if (store.revision === target.revision) {
      throw new ToolError("The generated artwork did not change the pixels or palette. No undo entry was created.");
    }

    return (
      `Drew '${prompt}' into '${active.name}' with ${MODEL_NOTE(artwork.model)}, pixelised to ` +
      `${String(store.width)}x${String(store.width)} (${artwork.note}). ${String(changed)} pixel(s) changed on ` +
      `frame ${String(target.frame)}.${describeMerge(merge)} One undo restores the pixels and palette. Call read_canvas to see it.`
    );
  },
};

/**
 * Fits generated art into an asset's palette, widening it where it has to.
 *
 * An empty canvas takes the generated palette outright: its colours are a
 * preset default nobody chose for this subject, and forcing a bush through
 * sixteen general-purpose colours is the staleness this stopped doing
 * elsewhere. Anything already drawn keeps every colour it uses, and the
 * generation spends whatever slots are spare.
 *
 * Plans only: the caller commits the palette and pixels together so both undo.
 */
function planGeneratedPalette(
  store: DocumentStore,
  generated: readonly string[],
): PaletteMerge & { readonly adopted: boolean } {
  const existing = store.palette.colors.map((colour) => colour.hex);
  const used = usedPaletteIndices(store);

  if (used.size === 0) {
    const colors = [...generated];
    return { colors, added: colors, unmatched: [], adopted: true };
  }

  const merge = mergePalette(existing, generated, used);
  return { ...merge, adopted: false };
}

/** Says what happened to the palette, because silently losing a colour is the bug. */
function describeMerge(merge: PaletteMerge & { readonly adopted?: boolean }): string {
  if (merge.adopted === true) {
    return ` The canvas was empty, so it took the generated ${String(merge.colors.length)}-colour palette.`;
  }
  const grew =
    merge.added.length === 0
      ? ""
      : ` Added ${merge.added.join(", ")} to the palette (now ${String(merge.colors.length)} colours).`;
  const lost =
    merge.unmatched.length === 0
      ? ""
      : ` The palette is full, so ${merge.unmatched.join(", ")} were matched to their nearest existing shade — ` +
        `clear unused colours or call set_palette if those need to be exact.`;
  return `${grew}${lost}`;
}

export const deriveVariant: ToolDefinition = {
  network: true,
  name: "derive_variant",
  description:
    "Derive one same-size variation from the open asset; source unchanged. Preserves identity, perspective, scale, pixel cadence, lighting and palette complexity; checks tile seams. One slow, paid image call.",
  inputSchema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description:
          "The material change to make, e.g. 'add patchy moss between the stones while preserving the grey rock'.",
      },
      name: {
        type: "string",
        description:
          "Name for the new asset. Defaults to the source name plus the instruction.",
      },
    },
    required: ["instruction"],
  },
  example: {
    instruction:
      "add patchy moss between the stones while preserving the grey rock",
    name: "Mossy cobblestone",
  },
  execute: async (args) => {
    const source = activeDerivationSource();
    const instruction = readString(args, "instruction");
    const name =
      args["name"] === undefined
        ? `${source.summary.name} — ${instruction.slice(0, 32)}`
        : readString(args, "name");
    const result = await deriveFromSource(source, instruction, name, "vary");
    assetNavigation.request(result.id);
    return `${result.message} It is open in the editor; call read_canvas to inspect it.`;
  },
};

const VARIATION_DIRECTIONS = [
  [
    "Reinforced",
    "upgrade it with purposeful metal bands, rivets, and a heavier lock while keeping the original construction readable",
  ],
  [
    "Arcane",
    "infuse it with restrained runes, a luminous crystal lock, and magical seams with a strong focal point",
  ],
  [
    "Overgrown",
    "let moss, roots, mushrooms, and age reclaim selected surfaces without obscuring the functional form",
  ],
  [
    "Royal",
    "turn it into a rare gilded version with jewel accents, ornamental trim, and confident value separation",
  ],
  [
    "Frozen",
    "make an icebound variant with frost buildup, cold metal, and icicles that respect the original silhouette",
  ],
  [
    "Corrupted",
    "make a dangerous corrupted variant with warped details, cracks, and an ominous internal energy",
  ],
] as const;

export function planVariationFamily(
  sourceName: string,
  count: number,
  brief: string | undefined,
  creativity: "focused" | "inventive" | "wild",
  concepts?: readonly string[],
): readonly { name: string; instruction: string }[] {
  const freedom =
    creativity === "focused"
      ? "Keep the transformation restrained and production-safe."
      : creativity === "wild"
        ? "Push the concept boldly with one surprising signature detail, but never lose the source object's identity or game readability."
        : "Make it clearly distinct with one memorable signature detail while preserving family coherence.";
  const directions =
    concepts ??
    VARIATION_DIRECTIONS.slice(0, count).map(
      ([label, direction]) => `${label}: ${direction}`,
    );
  return directions.map((concept, index) => ({
    name: `${sourceName} — ${concept.split(":", 1)[0]?.trim().slice(0, 32) || `Variant ${String(index + 1)}`}`,
    instruction: `${brief === undefined ? "Create a distinct family variant" : brief.trim()}. Creative direction: ${concept}. ${freedom}`,
  }));
}

export const generateVariationSet: ToolDefinition = {
  network: true,
  name: "generate_variation_set",
  description:
    "Create 2–6 editable variations from the untouched open source. Materials, rarity, age, biome, ornament or magic vary; silhouette, perspective, scale, pixel cadence and lighting persist. Slow/paid: one image each. Requires explicit request for multiple variants.",
  inputSchema: {
    type: "object",
    properties: {
      count: {
        type: "integer",
        minimum: 2,
        maximum: 6,
        description:
          "Number of distinct variations. Required so paid generation is deliberate.",
      },
      brief: {
        type: "string",
        description:
          "Optional art direction shared by the family, e.g. 'fantasy dungeon loot with increasing rarity'.",
      },
      creativity: {
        type: "string",
        enum: ["focused", "inventive", "wild"],
        description:
          "How far concepts may depart from the source while preserving identity. Defaults to inventive.",
      },
      concepts: {
        type: "array",
        minItems: 2,
        maxItems: 6,
        items: { type: "string" },
        description:
          "Optional custom concept directions. Use concise, visually distinct ideas; the array length must match count.",
      },
    },
    required: ["count"],
  },
  example: {
    count: 4,
    brief: "fantasy dungeon chest progression",
    creativity: "inventive",
  },
  execute: async (args) => {
    const source = activeDerivationSource();
    const concepts =
      args["concepts"] === undefined ? undefined : readVariationConcepts(args);
    const count = readInteger(args, "count", 2, 6);
    if (concepts !== undefined && concepts.length !== count) {
      throw new ToolError(
        `'concepts' contains ${String(concepts.length)} directions but 'count' is ${String(count)}. Make them match.`,
      );
    }
    const brief = readOptionalString(args, "brief");
    const creativity = readEnum(
      args,
      "creativity",
      ["focused", "inventive", "wild"] as const,
      "inventive",
    );
    const plan = planVariationFamily(
      source.summary.name,
      count,
      brief,
      creativity,
      concepts,
    );
    const created: DerivationResult[] = [];

    for (const variation of plan) {
      try {
        const result = await deriveFromSource(source, variation.instruction, variation.name);
        created.push(result);
        assetNavigation.request(result.id);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (created.length === 0) throw error;
        assetNavigation.request(created.at(-1)!.id);
        return (
          `Created ${String(created.length)} of ${String(count)} requested variations from '${source.summary.name}'. ` +
          `The next variation failed: ${reason}\nCreated assets:\n${created.map((item) => `- ${item.name} (${item.id})`).join("\n")}\n` +
          `The original source is unchanged; the last successful variation is open.`
        );
      }
    }

    assetNavigation.request(created.at(-1)!.id);
    return (
      `Created ${String(created.length)} coherent variations from '${source.summary.name}' (${source.id}):\n` +
      `${created.map((item) => `- ${item.name} (${item.id})`).join("\n")}\n` +
      `Every variation was independently derived from the original source, which remains unchanged. The last variation is open.`
    );
  },
};

function readVariationConcepts(
  args: Readonly<Record<string, unknown>>,
): readonly string[] {
  const concepts = readArray(args, "concepts");
  if (concepts.length < 2 || concepts.length > 6) {
    throw new ToolError(
      `'concepts' must contain 2-6 directions, received ${String(concepts.length)}.`,
    );
  }
  return concepts.map((concept, index) => {
    if (
      typeof concept !== "string" ||
      concept.trim().length === 0 ||
      concept.length > 240
    ) {
      throw new ToolError(
        `'concepts[${String(index)}]' must be a non-empty string of 240 characters or fewer.`,
      );
    }
    return concept.trim();
  });
}

export interface DerivationSource {
  readonly id: string;
  readonly store: DocumentStore;
  readonly summary: AssetSummary;
  readonly png: Uint8Array;
  readonly palette: readonly string[];
  readonly kind: "sprite" | "texture";
}

interface DerivationResult {
  readonly id: string;
  readonly name: string;
  readonly message: string;
}

/** Capture a source without changing which asset the route is showing. */
export function activeDerivationSource(sourceId?: string): DerivationSource {
  const id = sourceId ?? session.activeId;
  if (id === null)
    throw new ToolError("No asset is open. Open the source asset first.");
  const store = session.get(id);
  if (store === undefined)
    throw new ToolError(`The source asset '${id}' no longer exists.`);
  const summary = session.list().find((asset) => asset.id === id);
  if (summary === undefined)
    throw new ToolError(`The open asset '${id}' no longer exists.`);
  if (store.width !== store.height) {
    throw new ToolError(
      `Image-model variations currently require a square source; '${summary.name}' is ${String(store.width)}x${String(store.height)}.`,
    );
  }
  const palette = store.palette.colors.map((colour) => colour.hex);
  const scale = Math.max(1, Math.floor(1024 / store.width));
  const grid = store.readComposite();
  const fillsCanvas = !grid.cells.includes(TRANSPARENT);
  return {
    id,
    store,
    summary,
    png: encodeIndexedPng(grid, palette, { scale }),
    palette,
    kind:
      (summary.type === "tile" || summary.type === "texture") && fillsCanvas
        ? "texture"
        : "sprite",
  };
}

export async function deriveFromSource(
  source: DerivationSource,
  instruction: string,
  name: string,
  /**
   * Which clause the server prompt uses.
   *
   * Explicit at every call site, including the ones taking the default. The
   * default used to mean the opposite of what rotation wanted — "preserve the
   * camera angle" silently beat "face east" — and leaning on a default that has
   * just changed meaning is how that bug gets made twice.
   */
  mode: "vary" | "rotate" | "pose" = "vary",
): Promise<DerivationResult> {
  const generated = await deriveImage(source.png, instruction, source.kind, mode);
  return finishDerivation({ source, instruction, name, mode }, generated);
}

export interface DerivationRequest {
  readonly source: DerivationSource;
  readonly instruction: string;
  readonly name: string;
  readonly mode: "vary" | "rotate" | "pose";
}

/**
 * Several derivations as one action, bought concurrently.
 *
 * A direction set's three turned views were generated one after another, each
 * a two-minute wait, for a bill that is the same either way. Results come back
 * settled and in order: each success is already an asset beside its source,
 * and one failure does not discard the views drawn beside it.
 */
export async function deriveFromSources(
  requests: readonly DerivationRequest[],
): Promise<PromiseSettledResult<DerivationResult>[]> {
  const generated = await deriveImages(
    requests.map((request) => ({ source: request.source.png, instruction: request.instruction, kind: request.source.kind, mode: request.mode })),
  );
  return Promise.all(
    generated.map(async (outcome, index): Promise<PromiseSettledResult<DerivationResult>> => {
      if (outcome.status === "rejected") return outcome;
      try {
        return { status: "fulfilled", value: await finishDerivation(requests[index] as DerivationRequest, outcome.value) };
      } catch (error) {
        return { status: "rejected", reason: toToolError(error) };
      }
    }),
  );
}

/** Everything after the image: pixelise, check, and file the asset beside its source. */
async function finishDerivation({ source, name }: DerivationRequest, generated: GenerateResponse): Promise<DerivationResult> {
  const raster = await decodeBase64Png(generated.image);
  let result;
  try {
    result = await pixelizeAsync(raster, {
      targetWidth: source.store.width,
      maxColors: Math.max(DEFAULT_PALETTE_SIZE, source.store.palette.colors.length),
    });
  } catch (error) {
    throw toToolError(error);
  }
  if (result.palette.length === 0) {
    throw new ToolError(
      "The variation contained no opaque pixels, so it was not saved. The source is unchanged.",
    );
  }
  if (
    result.grid.width !== source.store.width ||
    result.grid.height !== source.store.height
  ) {
    throw new ToolError(
      `The variation resolved to ${String(result.grid.width)}x${String(result.grid.height)}, not the source's ` +
        `${String(source.store.width)}x${String(source.store.height)} grid, so it was not saved. The source is unchanged.`,
    );
  }
  if (result.confidence < 0.5) {
    throw new ToolError(
      `Grid recovery confidence was only ${result.confidence.toFixed(2)}, so the variation was not saved. ` +
        `The source is unchanged; retry with more specific art direction.`,
    );
  }

  const sourcePalette = source.palette;
  const id = session.create({
    name,
    type: source.summary.type,
    grid: conformToPalette(result.grid, result.palette, sourcePalette),
    palette: sourcePalette,
    width: source.store.width,
    height: source.store.height,
  });
  // Beside its source, folder included — a variation of a chest belongs where
  // the chest is, not at the project root.
  projects.inherit(source.id, id);
  const seam =
    source.kind === "texture" ? checkSeamlessTiling(result.grid) : null;
  const seamNote =
    seam === null
      ? ""
      : seam.seamless
        ? " Seam validation passed."
        : ` Seam validation found ${String(seam.leftRight.mismatches.length + seam.topBottom.mismatches.length)} edge pairing(s) to inspect.`;
  const warnings =
    result.warnings.length === 0
      ? ""
      : ` Warnings: ${result.warnings.join("; ")}.`;
  return {
    id,
    name,
    message:
      `Created '${name}' as ${id} from '${source.summary.name}' (${source.id}) with ${MODEL_NOTE(generated.model)}. ` +
      `The source is unchanged; the variation is an indexed ${String(source.store.width)}x${String(source.store.height)} grid ` +
      `using ${String(result.palette.length)} colours.${seamNote}${warnings}`,
  };
}

/**
 * Remaps a pixelised grid onto a fixed palette, matching in Oklab.
 *
 * The pipeline extracts the colours the image actually used; the asset has to
 * use the project's. Matching perceptually rather than by RGB distance is the
 * difference between a green landing on a darker green and landing on a grey of
 * similar numeric value.
 */
/** Shared with `animate_with_text`, which must land frames in the asset's own palette. */
/**
 * Oklab distance past which an incoming colour is one this palette does not have.
 *
 * Measured against the case that produced it. Asked to add red cherries to a
 * bush, the model's `#c0392b` sat 0.084 from the nearest palette entry
 * (`#96513c`, a brown) and `#e74c3c` sat 0.133 from `#d98f5c` — both plainly
 * different colours, both silently replaced by the one they were nearest to.
 * A colour the palette genuinely has lands at 0.001-0.008. 0.05 separates those
 * two populations with room on either side.
 */
const NEW_COLOUR_DISTANCE = 0.05;

export interface PaletteMerge {
  /** The palette to write into. Every used entry keeps its index. */
  readonly colors: readonly string[];
  readonly added: readonly string[];
  /** Incoming colours there was no room for; these still get nearest-matched. */
  readonly unmatched: readonly string[];
}

/**
 * Makes room in an asset's palette for colours the incoming art actually needs.
 *
 * The reason the cherries came out orange. The palette cap applies to live
 * colours, not slots: a bush generated into the
 * general 16-colour preset used seven of them and left nine holding blues and
 * greys nothing on the canvas referred to. Conforming the edit to "the palette"
 * mapped red onto a brown while those nine slots sat unused.
 *
 * So: keep every entry the art actually uses, at its current index — that is
 * what makes this safe, because no existing pixel changes meaning — and spend
 * the rest on colours the incoming art needs and this palette cannot express.
 * Only when there is genuinely no room does a colour fall back to its nearest
 * neighbour, and then the caller reports it rather than hiding it.
 */
export function mergePalette(
  existing: readonly string[],
  incoming: readonly string[],
  used: ReadonlySet<number>,
  limit = MAX_PALETTE_SIZE,
): PaletteMerge {
  const colors = [...existing];
  const added: string[] = [];
  const unmatched: string[] = [];

  /** The entry this colour resolves to, and how far away it is. */
  const nearest = (hex: string): { index: number; distance: number } => {
    const lab = hexToOklab(hex);
    let index = -1;
    let distance = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < colors.length; candidate += 1) {
      const measured = oklabDistance(lab, hexToOklab(colors[candidate] as string));
      if (measured < distance) {
        distance = measured;
        index = candidate;
      }
    }
    return { index, distance };
  };

  // An entry the incoming art itself relies on is not spare, however little the
  // canvas uses it. `used` describes what is *drawn*, and the edit's own
  // colours are not drawn yet — so a near-white the canvas had stopped using
  // was a free slot by that measure, and handing it to a new violet deleted the
  // white the same edit was about to paint with.
  const needed = new Set<number>();
  for (const hex of incoming) {
    const match = nearest(hex);
    if (match.distance <= NEW_COLOUR_DISTANCE && match.index >= 0) needed.add(match.index);
  }

  // Slots to spend, in the order to spend them: grow the palette first, then
  // reclaim entries neither the canvas nor this edit refers to.
  const free: number[] = [];
  for (let index = colors.length; index < limit; index += 1) free.push(index);
  for (let index = 0; index < colors.length; index += 1) {
    if (!used.has(index) && !needed.has(index)) free.push(index);
  }

  for (const hex of incoming) {
    // Measured against the growing list, so two near-identical incoming
    // colours spend one slot rather than two.
    if (nearest(hex).distance <= NEW_COLOUR_DISTANCE) continue;

    const slot = free.shift();
    if (slot === undefined) {
      unmatched.push(hex);
      continue;
    }
    colors[slot] = hex;
    added.push(hex);
  }

  return { colors, added, unmatched };
}

/** Reserve every layer's indices, including hidden or occluded artwork. */
export function usedPaletteIndices(store: DocumentStore): ReadonlySet<number> {
  const used = new Set<number>();
  for (const frame of store.snapshot().frames) for (const layer of frame.layers) {
    for (const cell of layer.grid.cells) {
      if (cell !== TRANSPARENT) used.add(cell);
    }
  }
  return used;
}

export function conformToPalette(
  grid: Grid,
  extracted: readonly string[],
  target: readonly string[],
): Grid {
  const palette = createPalette({ colors: [...target] });
  const lookup = extracted.map((hex) => nearestIndex(palette, hex));

  const cells = new Int16Array(grid.cells.length);
  for (let i = 0; i < grid.cells.length; i += 1) {
    const cell = grid.cells[i] as number;
    cells[i] = cell === TRANSPARENT ? TRANSPARENT : (lookup[cell] ?? 0);
  }
  return { width: grid.width, height: grid.height, cells };
}

function MODEL_NOTE(model: string): string {
  return model === "unknown" ? "the image model" : model;
}

export const pixelizeCanvas: ToolDefinition = {
  name: "pixelize",
  description:
    "Create/open a lossy single-frame/layer copy of the selected composite, with extracted palette and source type/placement. Width 8–128px, height proportional. Original frames/history unchanged; inspect the copy.",
  inputSchema: {
    type: "object",
    properties: {
      target_width: {
        type: "integer",
        minimum: 8,
        maximum: 128,
        description: "Copy width in pixels; height preserves the source aspect ratio.",
      },
      max_colors: {
        type: "integer",
        minimum: 2,
        maximum: 255,
        description: "Palette size cap.",
      },
    },
    required: ["target_width"],
  },
  example: { target_width: 16 },
  execute: async (args) => {
    const source = requireActiveAsset();
    const { id, name, type, store } = source;
    const target = captureEditTarget(source);
    const destination = { ...projects.placementOf(id) };
    const targetWidth = readInteger(args, "target_width", 8, 128);
    const maxColors =
      readOptionalInteger(args, "max_colors", 2, 255) ??
      store.palette.colors.length;

    // Render the current grid as a 1:1 raster so the pipeline can resample it.
    const grid = store.readComposite();
    const palette = store.palette.colors.map((colour) => colour.hex);
    const raster = {
      width: grid.width,
      height: grid.height,
      data: rasterFromGrid(grid, palette),
    };

    let result;
    try {
      result = await pixelizeAsync(raster, { targetWidth, maxColors });
    } catch (error) {
      throw toToolError(error);
    }

    assertEditTarget(target);
    assertGenerationDestination(destination);
    if (result.palette.length === 0) {
      throw new ToolError(
        "The selected frame contains no opaque pixels. No pixelised copy was created.",
      );
    }

    // Grid indices belong to the extracted palette, never to the source palette.
    const copyId = session.create({
      name: `${name} pixelised ${String(result.grid.width)}x${String(result.grid.height)}`,
      type: type as AssetType,
      width: result.grid.width,
      height: result.grid.height,
      palette: result.palette,
      grid: result.grid,
    });
    if (destination.projectId !== null && !projects.place(copyId, destination.projectId, destination.folderId)) {
      throw new ToolError(`Pixelised copy '${copyId}' was created but could not be placed in its source folder. It is available in the loose library.`);
    }
    assetNavigation.request(copyId);
    return `Created and opened pixelised copy '${copyId}' (${String(result.grid.width)}x${String(result.grid.height)}, ${String(result.palette.length)} colours) from frame ${String(target.frame)} of '${id}'. The original asset and its history are unchanged. Inspect the copy to verify its appearance.`;
  },
};

export const reduceColors: ToolDefinition = {
  name: "reduce_colors",
  description:
    "Reduce the open asset to its most-used colours, remapping removed colours by perceptual Oklab distance.",
  inputSchema: {
    type: "object",
    properties: { target_count: { type: "integer", minimum: 2, maximum: 255 } },
    required: ["target_count"],
  },
  example: { target_count: 8 },
  execute: (args) => {
    const { id, store } = requireActiveAsset();
    const target = readInteger(
      args,
      "target_count",
      2,
      store.palette.colors.length,
    );
    const usage = store.stats().usage;
    const colors = store.palette.colors
      .map((color, index) => ({ hex: color.hex, count: usage.get(index) ?? 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, target)
      .map((entry) => entry.hex);
    session.recolor(id, colors);
    return `Reduced the asset to ${String(target)} colours using perceptual nearest-colour remapping.`;
  },
};

export const removeBackground: ToolDefinition = {
  name: "remove_background",
  description:
    "Clear only border-connected pixels matching the active layer's most common border colour. Transparency-dominated borders do nothing; enclosed matching pixels remain.",
  inputSchema: { type: "object", properties: {} },
  example: {},
  execute: () => {
    const { store } = requireActiveAsset();
    const grid = store.readLayer();
    const counts = new Map<number, number>();
    for (let x = 0; x < grid.width; x += 1)
      for (const y of [0, grid.height - 1]) {
        const cell = grid.cells[y * grid.width + x] as number;
        counts.set(cell, (counts.get(cell) ?? 0) + 1);
      }
    for (let y = 1; y < grid.height - 1; y += 1)
      for (const x of [0, grid.width - 1]) {
        const cell = grid.cells[y * grid.width + x] as number;
        counts.set(cell, (counts.get(cell) ?? 0) + 1);
      }
    const background = [...counts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0];
    if (background === undefined || background === TRANSPARENT)
      return "Nothing changed: the border is already transparent.";
    const changed = store.transaction("remove_background", () => {
      let removed = 0;
      const clearComponent = (x: number, y: number) => {
        const start = y * grid.width + x;
        if (grid.cells[start] !== background) return;
        const changes = bucketFill(grid, x, y, TRANSPARENT, {});
        for (const change of changes) grid.cells[change.offset] = change.to;
        removed += changes.length;
      };
      for (let x = 0; x < grid.width; x += 1) for (const y of [0, grid.height - 1]) {
        clearComponent(x, y);
      }
      for (let y = 1; y < grid.height - 1; y += 1) for (const x of [0, grid.width - 1]) {
        clearComponent(x, y);
      }
      if (removed > 0) store.writeRegion(0, 0, grid);
      return removed;
    });
    return `Removed border colour index ${String(background)} from ${String(changed)} pixel(s).`;
  },
};

export const extractPalette: ToolDefinition = {
  scope: "always",
  name: "extract_palette",
  description:
    "Read the most-used colours from an indexed library asset, ordered by usage, for reuse as a palette or generation style reference.",
  readOnly: true,
  inputSchema: {
    type: "object",
    properties: {
      asset_id: { type: "string" },
      count: { type: "integer", minimum: 1, maximum: 255 },
    },
  },
  example: { count: 8 },
  execute: (args) => {
    const id = readOptionalString(args, "asset_id") ?? session.activeId;
    if (id === null) throw new ToolError("No asset is open.");
    const store = session.get(id);
    if (store === undefined) throw new ToolError(`No asset '${id}'.`);
    const count =
      readOptionalInteger(args, "count", 1, 255) ?? store.palette.colors.length;
    const usage = store.stats().usage;
    return store.palette.colors
      .map((color, index) => ({ hex: color.hex, count: usage.get(index) ?? 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, count)
      .map((entry) => entry.hex)
      .join("\n");
  },
};

export const checkGridAlignment: ToolDefinition = {
  name: "check_grid_alignment",
  description:
    "Verify that the open asset is an integer indexed grid with no resampled or partial-alpha pixels.",
  readOnly: true,
  inputSchema: { type: "object", properties: {} },
  example: {},
  execute: () => {
    const { store } = requireActiveAsset();
    return `PASS: ${String(store.width)}x${String(store.height)} integer indexed grid; palette indices 0-${String(store.palette.colors.length - 1)} plus transparent; alpha is binary by construction.`;
  },
};

/** Expands an indexed grid back to RGBA, so the pipeline can resample it. */
function rasterFromGrid(
  grid: { width: number; height: number; cells: Int16Array },
  palette: readonly string[],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(grid.width * grid.height * 4);
  const rgb = palette.map((hex) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]);

  for (let i = 0; i < grid.cells.length; i += 1) {
    const cell = grid.cells[i] as number;
    if (cell < 0) continue;
    const colour = rgb[cell];
    if (colour === undefined) continue;
    data[i * 4] = colour[0] as number;
    data[i * 4 + 1] = colour[1] as number;
    data[i * 4 + 2] = colour[2] as number;
    data[i * 4 + 3] = 255;
  }
  return data;
}
