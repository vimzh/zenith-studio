import {
  activeCanvasSize,
  deleteAsset as deleteAssetEverywhere,
  projects,
  session,
  type AssetType,
} from "@/lib/editor";
import { CANVAS_PRESETS, DEFAULT_PRESET_ID } from "@/lib/pixel";
import { readEnum, readOptionalString, readString } from "../args";
import { assetNavigation } from "../navigation";
import { ToolError, type ToolDefinition } from "../types";
import { requireActiveAsset } from "./active";

/**
 * Context — what exists, and what is open.
 *
 * An asset is any single pixel-art thing: a tile, a texture, a character sprite,
 * an icon. One flat library, no projects or folders (phase 14).
 */

const ASSET_TYPES = ["character", "tile", "texture", "tileset", "item", "ui"] as const;

const PRESET_IDS = CANVAS_PRESETS.map((preset) => preset.id);

const PRESET_SUMMARY = CANVAS_PRESETS.map(
  (preset) => `${preset.id} (${String(preset.width)}x${String(preset.height)}, ${String(preset.colors.length)} colours)`,
).join("; ");

export const listAssets: ToolDefinition = {
  scope: "always",
  name: "list_assets",
  description:
    "List library asset IDs, names, types, dimensions, frame counts and open status. Start here to find assets; optionally filter by type or case-insensitive name substring.",
  readOnly: true,
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [...ASSET_TYPES],
        description: "Only return assets of this type.",
      },
      query: {
        type: "string",
        description: "Only return assets whose name contains this text, case-insensitively.",
      },
    },
  },
  example: {},
  execute: (args) => {
    const type = args["type"] === undefined ? undefined : readEnum(args, "type", ASSET_TYPES);
    const query = readOptionalString(args, "query")?.toLowerCase();

    const assets = session.list().filter((asset) => {
      if (type !== undefined && asset.type !== type) return false;
      if (query !== undefined && !asset.name.toLowerCase().includes(query)) return false;
      return true;
    });

    if (assets.length === 0) {
      return session.size === 0
        ? "The library is empty. Call create_asset to make one."
        : `No assets match that filter. The library holds ${String(session.size)} asset(s); call list_assets with no arguments to see them all.`;
    }

    const lines = assets.map((asset) => {
      const open = asset.id === session.activeId ? "  [open]" : "";
      return `${asset.id}  ${asset.name}  (${asset.type})  ${String(asset.width)}x${String(asset.height)}  ${String(asset.frameCount)} frame(s)${open}`;
    });
    return `${String(assets.length)} asset(s):\n${lines.join("\n")}`;
  },
};

export const createAsset: ToolDefinition = {
  scope: "always",
  name: "create_asset",
  description:
    `Create a new pixel-art asset and open it in the editor, replacing whatever was open. The preset fixes both canvas size and palette: ${PRESET_SUMMARY}. Defaults to ${DEFAULT_PRESET_ID}. The new asset starts fully transparent. Returns its id.`,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Human-readable name, e.g. 'cobblestone'." },
      type: {
        type: "string",
        enum: [...ASSET_TYPES],
        description:
          "What kind of thing this is. Type unlocks capability rather than implying a folder: a tile can be seam-checked, a character gets directions and animations.",
      },
      preset: {
        type: "string",
        enum: [...PRESET_IDS],
        description: `Canvas size and palette. Defaults to ${DEFAULT_PRESET_ID}.`,
      },
    },
    required: ["name"],
  },
  example: { name: "cobblestone", type: "tile", preset: "tile-32" },
  execute: (args) => {
    const name = readString(args, "name");
    const type = readEnum<AssetType>(args, "type", ASSET_TYPES, "tile");
    const preset = args["preset"] === undefined ? DEFAULT_PRESET_ID : readEnum(args, "preset", PRESET_IDS as readonly string[]);

    // The project's resolution, unless the caller named a preset — that is an
    // explicit size for this one asset and outranks the project default.
    const projectSize = args["preset"] === undefined ? activeCanvasSize(type) : null;

    let id: string;
    try {
      id = session.create({
        name,
        type,
        preset,
        ...(projectSize === null ? {} : { width: projectSize, height: projectSize }),
      });
    } catch (error) {
      throw new ToolError(error instanceof Error ? error.message : String(error));
    }

    // Into the folder the human has open, not the project root. The explorer's
    // selection is the only thing that knows where "here" is.
    if (projects.activeProjectId !== null) {
      projects.place(id, projects.activeProjectId, projects.activeFolderId);
    }

    assetNavigation.request(id);

    const store = session.active;
    const size = store === null ? "" : ` at ${String(store.width)}x${String(store.height)}`;
    const colors = store === null ? 0 : store.palette.colors.length;
    return `Created ${type} '${name}' as ${id}${size} on a ${String(colors)}-colour palette, and opened it. Every pixel is transparent; call read_canvas to see it or get_palette for the colours.`;
  },
};

export const openAsset: ToolDefinition = {
  scope: "always",
  name: "open_asset",
  description:
    "Open an existing asset in the editor, making it the target of every editing and perception tool and showing it to the human. Use list_assets to find ids.",
  inputSchema: {
    type: "object",
    properties: {
      asset_id: { type: "string", description: "Id from list_assets, e.g. 'asset_001'." },
    },
    required: ["asset_id"],
  },
  example: { asset_id: "asset_001" },
  execute: (args) => {
    const id = readString(args, "asset_id");
    if (!session.open(id)) {
      const known = session.list().map((asset) => asset.id);
      throw new ToolError(
        known.length === 0
          ? `No asset '${id}'. The library is empty — call create_asset first.`
          : `No asset '${id}'. Known ids: ${known.join(", ")}.`,
      );
    }
    assetNavigation.request(id);

    const store = session.active;
    const summary = session.list().find((asset) => asset.id === id);
    return `Opened ${id} '${summary?.name ?? id}' (${summary?.type ?? "asset"}), ${String(store?.width ?? 0)}x${String(store?.height ?? 0)}. It is now the target of every editing tool.`;
  },
};

export const renameAsset: ToolDefinition = {
  scope: "always",
  name: "rename_asset",
  description: "Rename an asset in the library. The pixels, type, frames, and undo history are unchanged.",
  inputSchema: {
    type: "object",
    properties: {
      asset_id: { type: "string", description: "Id from list_assets." },
      name: { type: "string", description: "New non-empty display name." },
    },
    required: ["asset_id", "name"],
  },
  example: { asset_id: "asset_001", name: "Mossy cobblestone" },
  execute: (args) => {
    const id = readString(args, "asset_id");
    const name = readString(args, "name").trim();
    if (name.length === 0) throw new ToolError("'name' cannot contain only whitespace.");
    if (!session.rename(id, name)) throw new ToolError(`No asset '${id}'. Call list_assets for valid ids.`);
    return `Renamed ${id} to '${name}'.`;
  },
};

export const setAssetType: ToolDefinition = {
  scope: "editor",
  name: "set_asset_type",
  description:
    "Change the open asset's classification only with explicit human confirmation, never inferred from an art prompt. Changes metadata/tools, preserving pixels, palette, frames and history.",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: [...ASSET_TYPES], description: "The asset type explicitly requested by the human." },
    },
    required: ["type"],
  },
  example: { type: "character" },
  execute: (args) => {
    const type = readEnum<AssetType>(args, "type", ASSET_TYPES);
    const active = requireActiveAsset();
    if (active.type === type) return `Asset ${active.id} is already a ${type}; nothing changed.`;
    session.setType(active.id, type);
    return `Changed ${active.id} from ${active.type} to ${type}. Pixels, palette, frames, and undo history are unchanged. Tool availability will refresh on the next turn.`;
  },
};

export const duplicateAsset: ToolDefinition = {
  scope: "always",
  name: "duplicate_asset",
  description: "Duplicate an asset including every frame and pixel. The copy becomes active and opens in the editor.",
  inputSchema: {
    type: "object",
    properties: {
      asset_id: { type: "string", description: "Asset to copy. Defaults to the open asset." },
      name: { type: "string", description: "Optional name for the copy." },
    },
  },
  example: {},
  execute: (args) => {
    const source = readOptionalString(args, "asset_id") ?? session.activeId;
    if (source === null) throw new ToolError("No asset is open. Pass asset_id or call open_asset first.");
    const id = session.duplicate(source, readOptionalString(args, "name"));
    if (id === null) throw new ToolError(`No asset '${source}'. Call list_assets for valid ids.`);
    // Beside the original, folder included — a copy of a chest belongs where
    // the chest is. This placed at the project root, like every other derived
    // asset did before `inherit` existed.
    projects.inherit(source, id);
    assetNavigation.request(id);
    return `Duplicated ${source} as ${id} and opened the copy.`;
  },
};

export const deleteAsset: ToolDefinition = {
  scope: "always",
  name: "delete_asset",
  description: "Delete an asset from the library. The deletion is recoverable with the library's Undo delete action.",
  inputSchema: {
    type: "object",
    properties: { asset_id: { type: "string", description: "Asset id to delete." } },
    required: ["asset_id"],
  },
  example: { asset_id: "asset_001" },
  execute: (args) => {
    const id = readString(args, "asset_id");
    if (!deleteAssetEverywhere(id)) throw new ToolError(`No asset '${id}'. Call list_assets for valid ids.`);
    if (session.activeId !== null) assetNavigation.request(session.activeId);
    return `Deleted ${id}. Use Undo delete in the library to restore it.`;
  },
};

export const describeAsset: ToolDefinition = {
  scope: "always",
  name: "describe_asset",
  description: "Describe an asset's dimensions, frame count, palette usage, coverage, symmetry, and silhouette bounds.",
  readOnly: true,
  inputSchema: {
    type: "object",
    properties: { asset_id: { type: "string", description: "Asset to describe. Defaults to the open asset." } },
  },
  example: {},
  execute: (args) => {
    const id = readOptionalString(args, "asset_id") ?? session.activeId;
    if (id === null) throw new ToolError("No asset is open. Pass asset_id or call open_asset first.");
    const asset = session.list().find((item) => item.id === id);
    const store = session.get(id);
    if (asset === undefined || store === undefined) throw new ToolError(`No asset '${id}'. Call list_assets for valid ids.`);
    const stats = store.stats();
    const used = [...stats.usage.entries()].filter(([, count]) => count > 0).map(([index, count]) => `${String(index)}:${String(count)}`);
    return `${asset.id} '${asset.name}' (${asset.type}), ${String(asset.width)}x${String(asset.height)}, ${String(asset.frameCount)} frame(s). Coverage ${String(Math.round(stats.coverage * 100))}%. Palette usage ${used.join(", ") || "none"}.\nSilhouette:\n${store.silhouette()}`;
  },
};
