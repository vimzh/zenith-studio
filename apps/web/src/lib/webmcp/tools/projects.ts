import {
  VIEWS,
  PROJECTIONS,
  DIRECTION_SETS,
  OUTLINES,
  SHADINGS,
  PROPORTIONS,
  checkStyleConsistency,
  createPalette,
  describeStyleReport,
  type StyleProfile,
} from "@zenith/core";
import { projects, session } from "@/lib/editor";
import { readArray, readBoolean, readEnum, readInteger, readOptionalString, readString } from "../args";
import { assetNavigation } from "../navigation";
import { ToolError, type ToolDefinition } from "../types";
import { requireActiveAsset, toToolError } from "./active";

/**
 * Projects and the style contract.
 *
 * This is the group that makes a project worth having. A flat library cannot
 * notice that the enemy you generated three sessions later is 48x48 and
 * soft-edged where the hero is 32x32 and hard; a project can, because it holds
 * what the game is supposed to look like.
 *
 * The conformance half is deterministic on purpose. Palette and size are fixed
 * by arithmetic rather than by asking a model to try harder — a style rule
 * enforced by persuasion is not a rule.
 */

function activeProject(): { id: string; name: string; style: StyleProfile } {
  const id = projects.activeProjectId;
  const project = id === null ? undefined : projects.getProject(id);
  if (id === null || project === undefined) {
    throw new ToolError(
      "No project is open. Call list_projects to see what exists, open_project to open one, or create_project to start one.",
    );
  }
  return { id, name: project.name, style: project.style };
}

export const listProjects: ToolDefinition = {
  scope: "always",
  name: "list_projects",
  description:
    "List project IDs, names, asset counts, canvas/palette sizes and the open project. Call before opening a project or inspecting its style contract.",
  readOnly: true,
  inputSchema: { type: "object", properties: {} },
  example: {},
  execute: () => {
    const all = projects.listProjects();
    if (all.length === 0) {
      return "No projects yet. Call create_project to start one; assets created outside a project are simply unconstrained.";
    }
    const lines = all.map((project) => {
      const count = projects.assetsInProject(project.id).length;
      const open = project.id === projects.activeProjectId ? "  [open]" : "";
      return (
        `${project.id}  ${project.name}  ${String(count)} asset(s)  ` +
        `${String(project.style.palette.colors.length)} colours  ` +
        `character ${String(project.style.canvasSizes.character)}px${open}`
      );
    });
    return `${String(all.length)} project(s):\n${lines.join("\n")}`;
  },
};

export const createProject: ToolDefinition = {
  scope: "always",
  name: "create_project",
  description:
    "Create a project with a default style contract and request its visible project route. Returns its ID; use set_style_profile to set palette, sizes and art direction.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "What the game is called, e.g. 'Moss Hollow'." },
      notes: {
        type: "string",
        description:
          "Free-text art direction, e.g. 'grimy industrial, muted, heavy wear'. Used to steer generation. Never checked — it is a brief, not a rule.",
      },
    },
    required: ["name"],
  },
  example: { name: "Moss Hollow", notes: "damp forest ruins, mossy stone, muted greens" },
  execute: (args) => {
    const name = readString(args, "name");
    const notes = readOptionalString(args, "notes");
    const id = projects.createProject(name, notes === undefined ? {} : { notes });
    projects.openProject(id);
    assetNavigation.requestProject(id);
    const project = projects.getProject(id);
    return (
      `Created project '${name}' as ${id} and opened it. Style: ` +
      `${String(project?.style.palette.colors.length ?? 0)} colours, characters ` +
      `${String(project?.style.canvasSizes.character ?? 0)}px, tiles ${String(project?.style.canvasSizes.tile ?? 0)}px, ` +
      `${project?.style.view ?? "side"} view, ${project?.style.outline ?? "dark"} outline. ` +
      `Call set_style_profile to change any of it.`
    );
  },
};

export const openProject: ToolDefinition = {
  scope: "always",
  name: "open_project",
  description:
    "Open a project, making its style contract the one that generation is conditioned on and that conform_to_style and check_style_consistency measure against.",
  inputSchema: {
    type: "object",
    properties: { project_id: { type: "string", description: "Id from list_projects." } },
    required: ["project_id"],
  },
  example: { project_id: "project_001" },
  execute: (args) => {
    const id = readString(args, "project_id");
    if (!projects.openProject(id)) {
      const known = projects.listProjects().map((project) => project.id);
      throw new ToolError(
        known.length === 0
          ? `No project '${id}'. There are none — call create_project first.`
          : `No project '${id}'. Known ids: ${known.join(", ")}.`,
      );
    }
    const project = projects.getProject(id);
    assetNavigation.requestProject(id);
    return `Opened project '${project?.name ?? id}' with ${String(projects.assetsInProject(id).length)} asset(s).`;
  },
};

function describeStyle(name: string, style: StyleProfile): string {
  const palette = style.palette.colors
    .map((colour, index) => `${index.toString(16).toUpperCase()}=${colour.hex}`)
    .join("  ");
  return [
    `Style contract for '${name}':`,
    `  palette (${String(style.palette.colors.length)}): ${palette}`,
    `  canvas sizes: character ${String(style.canvasSizes.character)}, tile ${String(style.canvasSizes.tile)}, texture ${String(style.canvasSizes.texture)}, item ${String(style.canvasSizes.item)}, ui ${String(style.canvasSizes.ui)}`,
    `  view: ${style.view}   projection: ${style.projection}   directions: ${style.directionSet}`,
    `  outline: ${style.outline}   shading: ${style.shading}   proportions: ${style.proportions}`,
    `  references: ${style.references.length === 0 ? "none" : style.references.join(", ")}`,
    style.notes === undefined ? "  notes: none" : `  notes: ${style.notes}`,
  ].join("\n");
}

export const getStyleProfile: ToolDefinition = {
  scope: "always",
  name: "get_style_profile",
  description:
    "Read the open project's palette, canvas sizes, camera, directions, outline, shading, proportions, references and art brief. Consult before generating project assets.",
  readOnly: true,
  inputSchema: { type: "object", properties: {} },
  example: {},
  execute: () => {
    const { name, style } = activeProject();
    return describeStyle(name, style);
  },
};

export const setStyleProfile: ToolDefinition = {
  scope: "always",
  name: "set_style_profile",
  description:
    "Update only supplied fields of the open project's style contract; existing artwork is unchanged. Returns newly violating assets. Use check_style_consistency and explicit conform_to_style to repair them.",
  inputSchema: {
    type: "object",
    properties: {
      view: { type: "string", enum: [...VIEWS], description: "Camera angle the art is drawn for." },
      projection: { type: "string", enum: [...PROJECTIONS] },
      direction_set: { type: "string", enum: [...DIRECTION_SETS], description: "How many facings characters have." },
      outline: { type: "string", enum: [...OUTLINES] },
      shading: { type: "string", enum: [...SHADINGS] },
      proportions: { type: "string", enum: [...PROPORTIONS] },
      colors: {
        type: "array",
        items: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        minItems: 1,
        maxItems: 255,
        description: "Exact project palette as 1–255 six-digit hex colours.",
      },
      character_size: { type: "integer", minimum: 4, maximum: 256, description: "Canvas size for characters, in pixels." },
      tile_size: { type: "integer", minimum: 4, maximum: 256 },
      texture_size: { type: "integer", minimum: 4, maximum: 256 },
      item_size: { type: "integer", minimum: 4, maximum: 256 },
      ui_size: { type: "integer", minimum: 4, maximum: 256 },
      notes: { type: "string", description: "Free-text art direction used to steer generation." },
      reference_asset_ids: { type: "array", items: { type: "string" }, description: "Replace style references with existing project asset IDs; [] clears them." },
    },
  },
  example: { view: "high top-down", outline: "dark", tile_size: 32 },
  execute: (args) => {
    const { id, name, style } = activeProject();

    const patch: { -readonly [K in keyof StyleProfile]?: StyleProfile[K] } = {};
    if (args["view"] !== undefined) patch.view = readEnum(args, "view", VIEWS);
    if (args["projection"] !== undefined) patch.projection = readEnum(args, "projection", PROJECTIONS);
    if (args["direction_set"] !== undefined) patch.directionSet = readEnum(args, "direction_set", DIRECTION_SETS);
    if (args["outline"] !== undefined) patch.outline = readEnum(args, "outline", OUTLINES);
    if (args["shading"] !== undefined) patch.shading = readEnum(args, "shading", SHADINGS);
    if (args["proportions"] !== undefined) patch.proportions = readEnum(args, "proportions", PROPORTIONS);
    if (args["notes"] !== undefined) patch.notes = readString(args, "notes");
    if (args["reference_asset_ids"] !== undefined) {
      const references = args["reference_asset_ids"];
      if (!Array.isArray(references) || references.some((assetId) => typeof assetId !== "string" || !session.has(assetId) || projects.placementOf(assetId).projectId !== id)) {
        throw new ToolError("reference_asset_ids must be an array of existing asset IDs in this project; pass [] to clear stale references.");
      }
      patch.references = [...new Set(references as string[])];
    }
    if (args["colors"] !== undefined) {
      const colors = readArray(args, "colors");
      if (colors.length > 255 || colors.some((color) => typeof color !== "string")) {
        throw new ToolError("'colors' must contain 1–255 hex colour strings.");
      }
      try {
        patch.palette = createPalette({ colors: colors as readonly string[] });
      } catch (error) {
        throw toToolError(error);
      }
    }

    const sizes: { -readonly [K in keyof StyleProfile["canvasSizes"]]: number } = { ...style.canvasSizes };
    let resized = false;
    for (const [key, field] of [
      ["character_size", "character"],
      ["tile_size", "tile"],
      ["texture_size", "texture"],
      ["item_size", "item"],
      ["ui_size", "ui"],
    ] as const) {
      if (args[key] === undefined) continue;
      sizes[field] = readInteger(args, key, 4, 256);
      resized = true;
    }
    if (resized) patch.canvasSizes = sizes;

    if (Object.keys(patch).length === 0) {
      throw new ToolError("No style fields were given, so nothing changed. Pass at least one field to set.");
    }
    projects.setStyle(id, patch);

    const violating = violatingAssets(id);
    const warning =
      violating.length === 0
        ? ""
        : `\nViolating assets: ${violating.join(", ")}. Call check_style_consistency on them, or conform_to_style with all=true to fix the project.`;
    return `${describeStyle(name, projects.getProject(id)?.style ?? style)}${warning}`;
  },
};

function violatingAssets(projectId: string): string[] {
  const ids: string[] = [];
  for (const assetId of projects.assetsInProject(projectId)) {
    const store = session.get(assetId);
    const project = projects.getProject(projectId);
    if (store === undefined || project === undefined) continue;
    const type = session.list().find((asset) => asset.id === assetId)?.type ?? "tile";
    const grids = Array.from({ length: store.frameCount }, (_, frame) => store.readComposite(frame));
    if (!checkStyleConsistency(grids, project.style, type, store.palette).conforms) ids.push(assetId);
  }
  return ids;
}

export const addStyleReference: ToolDefinition = {
  scope: "always",
  name: "add_style_reference",
  description:
    "Mark an asset belonging to the open project as a style exemplar shown to the image model during generation. Omit asset_id to use the open asset.",
  inputSchema: {
    type: "object",
    properties: {
      asset_id: { type: "string", description: "Asset to hold up as an exemplar. Defaults to the open asset." },
    },
  },
  example: {},
  execute: (args) => {
    const { id, name, style } = activeProject();
    const assetId = args["asset_id"] === undefined ? session.activeId : readString(args, "asset_id");
    if (assetId === null) {
      throw new ToolError("No asset_id was given and no asset is open. Open one, or pass asset_id.");
    }
    if (session.get(assetId) === undefined) {
      throw new ToolError(`No asset '${assetId}'. Call list_assets for valid ids.`);
    }
    if (projects.placementOf(assetId).projectId !== id) {
      throw new ToolError(`Asset '${assetId}' does not belong to '${name}'. Move it into the project before using it as a reference.`);
    }
    if (style.references.includes(assetId)) {
      return `'${assetId}' is already a style reference for '${name}'.`;
    }

    const references = [...style.references, assetId];
    projects.setStyle(id, { references });
    return `Added '${assetId}' as a style reference for '${name}'. ${String(references.length)} reference(s) now condition generation in this project.`;
  },
};

export const checkStyleConsistencyTool: ToolDefinition = {
  scope: "editor",
  name: "check_style_consistency",
  description:
    "Check the open asset against the open project's palette and type-specific canvas size. Returns exact out-of-palette coordinates and dimensions. Does not certify outline, shading or proportions.",
  readOnly: true,
  inputSchema: { type: "object", properties: {} },
  example: {},
  execute: () => {
    const { id, style } = activeProject();
    const { id: assetId, name, type, store } = requireActiveAsset();
    if (projects.placementOf(assetId).projectId !== id) {
      throw new ToolError(`'${name}' does not belong to the open project. Move it into the project before checking its style.`);
    }
    const grids = Array.from({ length: store.frameCount }, (_, frame) => store.readComposite(frame));

    let report;
    try {
      report = checkStyleConsistency(grids, style, type, store.palette);
    } catch (error) {
      throw toToolError(error);
    }
    const text = describeStyleReport(report, name);
    return report.conforms ? text : `${text}\nCall conform_to_style to fix the palette and size violations deterministically.`;
  },
};

export const conformToStyleTool: ToolDefinition = {
  scope: "editor",
  name: "conform_to_style",
  description:
    "Conform the open asset, or all project assets with all=true: remap to nearest project colours and crop/pad from the top-left to expected sizes, never scale. Deterministic; outline/shading unchanged. Replaces documents and clears prior pixel undo history.",
  inputSchema: {
    type: "object",
    properties: {
      all: { type: "boolean", description: "Conform every asset in the open project instead of only the open asset." },
    },
  },
  example: {},
  execute: (args) => {
    const { id: projectId, style } = activeProject();
    const active = requireActiveAsset();
    const ids = readBoolean(args, "all", false) ? projects.assetsInProject(projectId) : [active.id];
    if (!ids.every((id) => projects.placementOf(id).projectId === projectId)) {
      throw new ToolError("Every asset being conformed must belong to the open project.");
    }

    let changed = 0;
    let resized = 0;
    for (const id of ids) {
      const meta = session.list().find((asset) => asset.id === id);
      if (meta === undefined) continue;
      const result = session.conformStyle(id, style, meta.type);
      if (result === null) continue;
      changed += result.changed;
      if (result.resized) resized += 1;
    }
    const remaining = violatingAssets(projectId);
    if (remaining.length > 0) {
      throw new ToolError(`Conformance finished but these assets still violate the project: ${remaining.join(", ")}.`);
    }
    return `Conformed ${String(ids.length)} asset(s): ${String(changed)} pixel(s) remapped, ${String(resized)} canvas(es) resized. Re-check reports a clean project.`;
  },
};
