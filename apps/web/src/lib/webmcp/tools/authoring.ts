import { BUILTIN_PALETTES, paletteHexes } from "@zenith/core";
import {
  buildCharacterFromReference,
  generateTileset,
  importImageAsAsset,
  projects,
  recolorAsset,
  session,
  type AssetType,
} from "@/lib/editor";
import { DIRECTIONS, DIRECTION_SETS, type Direction, type DirectionSet } from "@/lib/directions";
import { CANVAS_PRESETS } from "@/lib/pixel";
import { encodeIndexedPng } from "@/lib/export";
import { estimateSkeleton } from "@/lib/skeleton";
import { readEnum, readOptionalInteger, readOptionalString, readString } from "../args";
import { assetNavigation } from "../navigation";
import { deriveImage } from "../api";
import { decodeBase64Png } from "../raster";
import { ToolError, type ToolArgs, type ToolDefinition } from "../types";
import { requireActiveAsset } from "./active";

/**
 * Authoring tools — the deferred half of the catalog that makes assets.
 *
 * Everything here wraps library code that the human UI already calls, so the
 * agent and the human reach the same implementation. That matters more than it
 * sounds: a second code path for the agent is a second set of bugs, and the two
 * would drift the first time either side was fixed.
 *
 * None of these calls a model. The generation tools that cost money and time
 * live in `generation.ts` and say so in their descriptions; these are
 * deterministic, so an agent should reach for them first.
 */

const ASSET_TYPES: readonly AssetType[] = ["character", "tile", "texture", "tileset", "item", "ui"];
const SETS = Object.keys(DIRECTION_SETS) as DirectionSet[];

/** Named palettes an agent can ask for without listing sixteen hex strings. */
const NAMED_PALETTES: Readonly<Record<string, { label: string; colors: readonly string[] }>> = Object.freeze(
  Object.fromEntries([
    ...Object.entries(BUILTIN_PALETTES).map(([id, palette]) => [
      id,
      { label: palette.name, colors: paletteHexes(palette) },
    ]),
    ...CANVAS_PRESETS.map((preset) => [preset.id, { label: preset.name, colors: preset.colors }]),
  ])
);

const PALETTE_NAMES = Object.keys(NAMED_PALETTES);

/**
 * An 8x8 PNG, so the Agent Console's Run button works without an upload.
 *
 * A placeholder string would make the example unrunnable, and the tool-surface
 * test executes every example — an example that cannot run is not an example.
 * Kept tiny because it ships inside the tool schema on every listing.
 */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAN0lEQVR42mNggII7qyr+I2MGZIAuiVWRjU3Af2SMIumWt+o/NoyiAFkhshhOUxjQAbIgTt3Y+ACUCFRDgJyrvQAAAABJRU5ErkJggg==";

export const generateTilesetTool: ToolDefinition = {
  name: "generate_tileset",
  scope: "tile",
  description:
    "Build one 47-tile blob-autotile sheet from the open tile. Instant, deterministic and free; shared texture and matching edges. Optional edge_index outlines or darkens tile borders.",
  inputSchema: {
    type: "object",
    properties: {
      edge_index: {
        type: "integer",
        minimum: 0,
        maximum: 254,
        description: "Palette index to draw tile edges in. Omit for no edge treatment.",
      },
    },
  },
  example: {},
  execute: (args) => {
    const { id, store } = requireActiveAsset();
    const edge = readOptionalInteger(args, "edge_index", 0, store.palette.colors.length - 1);
    return generateTileset(id, edge);
  },
};

export const setPaletteTool: ToolDefinition = {
  name: "set_palette",
  description:
    "Remap the open asset by nearest Oklab colour, preserving structure. Pass a named palette or 2–255 explicit hex colors.",
  inputSchema: {
    type: "object",
    properties: {
      palette: { type: "string", enum: [...PALETTE_NAMES], description: "A named palette." },
      colors: {
        type: "array",
        minItems: 2,
        maxItems: 255,
        items: { type: "string" },
        description: "Explicit hex colours, e.g. ['#0f380f', '#9bbc0f']. Max 255.",
      },
    },
  },
  example: { palette: "gb-dmg" },
  execute: (args) => {
    const { id } = requireActiveAsset();
    const named = readOptionalString(args, "palette");
    const raw = args["colors"];

    if (named !== undefined) {
      const entry = NAMED_PALETTES[named];
      if (entry === undefined) {
        throw new ToolError(`No palette '${named}'. Available: ${PALETTE_NAMES.join(", ")}.`);
      }
      return recolorAsset(id, entry.colors, entry.label);
    }

    if (!Array.isArray(raw)) {
      throw new ToolError(`Pass either palette (one of ${PALETTE_NAMES.join(", ")}) or colors as an array of hex strings.`);
    }
    const colors = raw.map((value, index) => {
      if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
        throw new ToolError(`colors[${String(index)}] must be a hex colour like '#3a5a40'.`);
      }
      return value;
    });
    if (colors.length < 2 || colors.length > 255) {
      throw new ToolError(`A palette needs 2 to 255 colours, received ${String(colors.length)}.`);
    }
    return recolorAsset(id, colors, "custom palette");
  },
};

export const estimateSkeletonTool: ToolDefinition = {
  name: "estimate_skeleton",
  scope: "character",
  readOnly: true,
  description:
    "Estimate the open character's skeleton from its silhouette: joints normalised 0-1 across the content bounds, origin top-left, x right, y down, each on a pixel of the part it names. A held staff is ignored. Read this, then pass changed joints to animate_with_skeleton.",
  inputSchema: {
    type: "object",
    properties: {
      character_type: { type: "string", enum: ["bipedal", "bipedal-chibi", "quadrupedal"], description: "Defaults to bipedal." },
    },
  },
  example: { character_type: "bipedal" },
  execute: (args) => {
    const { id, name } = requireActiveAsset();
    const store = session.get(id);
    if (store === undefined) throw new ToolError(`No asset '${id}' is open.`);

    const type = readEnum<"bipedal" | "bipedal-chibi" | "quadrupedal">(
      args,
      "character_type",
      ["bipedal", "bipedal-chibi", "quadrupedal"],
      "bipedal",
    );
    const pose = estimateSkeleton(store.readComposite(), type);
    if (pose === null) {
      throw new ToolError(`'${name}' is empty, so it has no silhouette to estimate a skeleton from.`);
    }

    const joints = Object.entries(pose.joints)
      .map(([joint, at]) => `${joint} (${at.x.toFixed(2)}, ${at.y.toFixed(2)})`)
      .join(", ");
    return `${pose.type} skeleton for '${name}', normalised within the content bounds: ${joints}.`;
  },
};

export const importImageTool: ToolDefinition = {
  network: true,
  name: "import_image",
  scope: "always",
  description:
    "Open a base64 PNG as an editable indexed asset. Local pixelisation detects the grid, chooses cell colours, binarises alpha and reduces the palette. Use for supplied images, not simple bitmap resizing.",
  inputSchema: {
    type: "object",
    properties: {
      image: { type: "string", description: "Base64-encoded PNG. No data: URL prefix." },
      name: { type: "string", description: "Name for the new asset." },
      target_width: { type: "integer", minimum: 8, maximum: 128, description: "Output width in pixels. Defaults to the detected native size." },
      max_colors: { type: "integer", minimum: 2, maximum: 255, description: "Palette size cap. Defaults to 16." },
      type: { type: "string", enum: [...ASSET_TYPES], description: "Asset type. Defaults to tile." },
    },
    required: ["image", "name"],
  },
  example: { image: TINY_PNG, name: "Reference sprite" },
  execute: async (args) => {
    const raster = await decodeBase64Png(readString(args, "image"));
    const { id, summary } = importImageAsAsset(raster, readString(args, "name"), {
      targetWidth: readOptionalInteger(args, "target_width", 8, 128),
      maxColors: readOptionalInteger(args, "max_colors", 2, 255),
      type: readEnum<AssetType>(args, "type", ASSET_TYPES, "tile"),
    });
    session.open(id);
    assetNavigation.request(id);
    return `${summary} Opened as ${id}; it is fully editable.`;
  },
};

export const buildCharacterTool: ToolDefinition = {
  network: true,
  name: "build_character_from_reference",
  scope: "always",
  description:
    "Extract one base sprite from exactly one image (base64 PNG) or source_asset_id (selected-frame composite/palette); source unchanged. Slow paid edit then local framing/pixelisation. Inspect before generate_direction_set; import_image is for clean sprites.",
  inputSchema: {
    type: "object",
    properties: {
      image: { type: "string", description: "Base64-encoded PNG of the concept art. No data: URL prefix." },
      source_asset_id: { type: "string", description: "Existing asset ID from list_assets. Uses its selected-frame composite and palette, without altering it. Omit image when supplied." },
      name: { type: "string", description: "Base name; each direction is named '<name> <direction>'." },
      direction_set: { type: "string", enum: [...SETS], description: "Defaults to cardinal4." },
      base_direction: { type: "string", enum: [...DIRECTIONS], description: "Direction shown by the reference. Defaults to south/front, or east for side2." },
      target_width: { type: "integer", minimum: 8, maximum: 128, description: "Square sprite size in pixels. Defaults to 32." },
    },
    required: ["name"],
  },
  example: { image: TINY_PNG, name: "Knight", direction_set: "cardinal4", base_direction: "south" },
  execute: async (args) => {
    const result = await buildCharacterFromConcept(args);
    session.open(result.baseId);
    assetNavigation.request(result.baseId);
    return result.summary;
  },
};

/** Shared concept preparation used by the UI tray and the WebMCP wrapper. */
export async function buildCharacterFromConcept(args: ToolArgs): Promise<{
  readonly baseId: string;
  readonly summary: string;
}> {
  const destination = { projectId: projects.activeProjectId, folderId: projects.activeFolderId };
  if ((args["image"] === undefined) === (args["source_asset_id"] === undefined)) {
    throw new ToolError("Pass exactly one of image or source_asset_id for the character reference.");
  }
  const targetWidth = readOptionalInteger(args, "target_width", 8, 128) ?? 32;
  const name = readString(args, "name");
  const directionSet = readEnum<DirectionSet>(args, "direction_set", SETS, "cardinal4");
  const defaultBase: Direction = directionSet === "side2" ? "east" : "south";
  const baseDirection = readEnum<Direction>(args, "base_direction", DIRECTIONS, defaultBase);
  if (!DIRECTION_SETS[directionSet].some((direction) => direction === baseDirection)) {
    throw new ToolError(`${baseDirection} is not part of ${directionSet}.`);
  }

  let source: Uint8Array;
  if (args["source_asset_id"] !== undefined) {
    const id = readString(args, "source_asset_id");
    const store = session.get(id);
    if (store === undefined) throw new ToolError(`No asset '${id}'. Call list_assets for valid source_asset_id values.`);
    // Match the reference tray's nearest-neighbour staging without a base64 round trip.
    const scale = Math.max(1, Math.floor(512 / Math.max(store.width, store.height)));
    source = encodeIndexedPng(store.readComposite(), paletteHexes(store.palette), { scale });
  } else {
    // Decode first so malformed uploads fail before a paid request is attempted.
    const sourceBase64 = readString(args, "image");
    await decodeBase64Png(sourceBase64);
    const binary = atob(sourceBase64);
    source = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  const extracted = await deriveImage(
    source,
    `Extract the most visually prominent character as one complete, clean, isolated full-body game-character reference prepared for a ${String(targetWidth)}x${String(targetWidth)} sprite.`,
    "sprite",
    "extract",
  );
  const raster = await decodeBase64Png(extracted.image);
  const existing = new Set(session.list().map((asset) => asset.id));
  const summary = await buildCharacterFromReference(raster, name, {
    directionSet,
    baseDirection,
    targetWidth,
    destination,
  });

  const base = session.list().find(
    (asset) => !existing.has(asset.id) && asset.name === `${name} ${baseDirection}`,
  );
  if (base === undefined) {
    throw new ToolError(`The extracted base direction '${name} ${baseDirection}' was not created.`);
  }
  return {
    baseId: base.id,
    summary: `Extracted one clean character raster with ${extracted.model}, then ${summary}`,
  };
}

/** Kept for the tool-surface tests, which assert the exported set of this file. */
export const AUTHORING_TOOLS: readonly ToolDefinition[] = [
  generateTilesetTool,
  setPaletteTool,
  estimateSkeletonTool,
  importImageTool,
  buildCharacterTool,
];
