import { directionFamily, projects, session } from "@/lib/editor";
import { DIRECTIONS, DIRECTION_SETS, directionFromName, mirrorGrid, mirrorOf, type Direction, type DirectionSet, type View, VIEWS } from "@/lib/directions";
import { readEnum } from "../args";
import { assetNavigation } from "../navigation";
import { ToolError, type ToolArgs, type ToolDefinition } from "../types";
import { requireActiveAsset } from "./active";
import { activeDerivationSource, deriveFromSource, deriveFromSources } from "./generation";

const SETS = Object.keys(DIRECTION_SETS) as DirectionSet[];
export const FACING: Record<Direction, string> = {
  north: "back view, facing away from the viewer",
  "north-east": "rear three-quarter view, facing screen-right",
  east: "strict side profile facing screen-right, with the nose pointing right",
  "south-east": "front three-quarter view, facing screen-right",
  south: "front view, facing the viewer",
  "south-west": "front three-quarter view, facing screen-left",
  west: "strict side profile facing screen-left, with the nose pointing left",
  "north-west": "rear three-quarter view, facing screen-left",
};

function baseName(name: string): string {
  const direction = directionFromName(name);
  return direction === undefined ? name : name.slice(0, -direction.length - 1);
}

function directionName(base: string, direction: Direction): string { return `${base} ${direction}`; }

function findDirection(base: string, direction: Direction, sourceId: string) {
  return directionFamily(sourceId, base).assets.get(direction);
}

export const getDirections: ToolDefinition = {
  scope: "character", name: "get_directions", description: "List directional assets belonging to the open character by their shared name and report missing directions.", readOnly: true,
  inputSchema: { type: "object", properties: { set: { type: "string", enum: [...SETS] } } }, example: { set: "cardinal4" },
  execute: (args) => { const { id, name } = requireActiveAsset(); const base = baseName(name); const set = readEnum<DirectionSet>(args, "set", SETS, "ordinal8"); const wanted = DIRECTION_SETS[set]; const have = wanted.filter((direction) => findDirection(base, direction, id) !== undefined); const missing = wanted.filter((direction) => !have.includes(direction)); return `Directions for '${base}': ${have.join(", ") || "none"}. Missing: ${missing.join(", ") || "none"}.`; },
};

export const selectDirection: ToolDefinition = {
  scope: "character", name: "select_direction", description:
    "Open the asset for one facing direction of the current character, making it the target of every editing and perception tool. Directions are separate assets sharing a name and palette; get_directions lists which exist, which are mirror-derived, and which are missing. The human's view follows, so they see the direction you are working on.",
  inputSchema: { type: "object", properties: { direction: { type: "string", enum: [...DIRECTIONS] } }, required: ["direction"] }, example: { direction: "west" },
  execute: (args) => { const { id, name } = requireActiveAsset(); const direction = readEnum<Direction>(args, "direction", DIRECTIONS); const asset = findDirection(baseName(name), direction, id); if (asset === undefined) throw new ToolError(`No ${direction} direction exists yet.`); session.open(asset.id); assetNavigation.request(asset.id); return `Opened ${asset.id} '${asset.name}'.`; },
};

export const deriveDirectionByMirror: ToolDefinition = {
  scope: "character", name: "derive_direction_by_mirror", description: "Create a direction by an exact horizontal mirror. Valid for east/west and diagonal left/right pairs.",
  inputSchema: { type: "object", properties: { from_direction: { type: "string", enum: [...DIRECTIONS] }, to_direction: { type: "string", enum: [...DIRECTIONS] } }, required: ["from_direction", "to_direction"] }, example: { from_direction: "east", to_direction: "west" },
  execute: (args) => {
    const from = readEnum<Direction>(args, "from_direction", DIRECTIONS); const to = readEnum<Direction>(args, "to_direction", DIRECTIONS);
    if (mirrorOf(from) !== to) throw new ToolError(`${from} does not mirror to ${to}.`);
    return mirrorDirection(requireActiveAsset(), from, to);
  },
};

function mirrorDirection(active: ReturnType<typeof requireActiveAsset>, from: Direction, to: Direction): string {
  const base = baseName(active.name); const source = findDirection(base, from, active.id) ?? (active.name === base ? session.list().find((item) => item.id === active.id) : undefined);
  if (source === undefined) throw new ToolError(`No ${from} source exists for '${base}'.`);
  const store = session.get(source.id); if (store === undefined) throw new ToolError(`No source asset '${source.id}'.`);
  const id = session.create({ name: directionName(base, to), type: source.type, width: store.width, height: store.height, palette: store.palette.colors.map((color) => color.hex), grid: mirrorGrid(store.readComposite()) });
  projects.inherit(source.id, id);
  assetNavigation.request(id); return `Created ${to} as ${id} by pixel-exact mirroring from ${from}.`;
}

function turnInstruction(from: Direction, fromView: View | undefined, to: Direction, view: View): string {
  return `The source faces ${from}${fromView === undefined ? "" : ` in a ${fromView} view`}. Redraw this exact character facing ${to}: ${FACING[to]}, in a ${view} view. Change the visible surfaces and silhouette to match the target direction; do not return the source view unchanged. Preserve identity, proportions, palette, lighting and the transparent background.`;
}

async function generateDirection(args: ToolArgs, active = requireActiveAsset()): Promise<string> {
  const from = readEnum<Direction>(args, "from_direction", DIRECTIONS); const to = readEnum<Direction>(args, "to_direction", DIRECTIONS);
  const view = readEnum<View>(args, "to_view", VIEWS, "low top-down"); const base = baseName(active.name);
  const fromView = args["from_view"] === undefined ? undefined : readEnum<View>(args, "from_view", VIEWS);
  const source = findDirection(base, from, active.id) ?? (active.name === base ? session.list().find((item) => item.id === active.id) : undefined); if (source === undefined) throw new ToolError(`No ${from} source exists.`);
  // `mode: "rotate"` rather than the default. The default prompt preserves the
  // camera angle, which silently defeated this tool entirely: every direction
  // came back as the source view, filed under a direction it did not depict,
  // with nothing reporting a problem. Measured on ten chests turned to a side
  // and a back — twenty generations, twenty unchanged front views.
  const result = await deriveFromSource(activeDerivationSource(source.id), turnInstruction(from, fromView, to, view), directionName(base, to), "rotate");
  assetNavigation.request(result.id);
  return `${result.message} Generated ${to} from ${from}; inspect it with read_canvas and repair asymmetrical details if necessary.`;
}

export const rotateCharacter: ToolDefinition = {
  network: true,
  scope: "character", name: "rotate_character", description: "Generate one new character direction. Slow and paid; prefer derive_direction_by_mirror when possible.",
  inputSchema: { type: "object", properties: { from_direction: { type: "string", enum: [...DIRECTIONS] }, to_direction: { type: "string", enum: [...DIRECTIONS] }, from_view: { type: "string", enum: [...VIEWS] }, to_view: { type: "string", enum: [...VIEWS] } }, required: ["from_direction", "to_direction"] }, example: { from_direction: "south", to_direction: "east", to_view: "low top-down" }, execute: generateDirection,
};

export const generateDirectionSet: ToolDefinition = {
  network: true,
  scope: "character", name: "generate_direction_set", description: "Complete a directional set, using exact mirrors first and model edits only where needed. Every view that needs the model is generated concurrently as one paid batch, so an eight-direction set costs one wait rather than four; a view that fails is reported while the others are kept.",
  inputSchema: { type: "object", properties: { set: { type: "string", enum: [...SETS] }, base_direction: { type: "string", enum: [...DIRECTIONS] }, view: { type: "string", enum: [...VIEWS] } }, required: ["set"] }, example: { set: "cardinal4", base_direction: "south" },
  execute: async (args) => {
    const active = requireActiveAsset();
    const set = readEnum<DirectionSet>(args, "set", SETS); const baseDirection = readEnum<Direction>(args, "base_direction", DIRECTIONS, directionFromName(active.name) ?? "south"); const view = readEnum<View>(args, "view", VIEWS, "low top-down");
    const base = baseName(active.name); if (findDirection(base, baseDirection, active.id) === undefined && active.name === base) session.rename(active.id, directionName(base, baseDirection));
    const baseAsset = findDirection(base, baseDirection, active.id);
    if (baseAsset === undefined) throw new ToolError(`The base direction ${baseDirection} is missing.`);

    // Three passes. Mirror what already has a partner; generate one view of
    // every pair that has none, all at once; mirror the partners afterwards.
    const created: string[] = [];
    const missing = DIRECTION_SETS[set].filter((target) => findDirection(base, target, active.id) === undefined);
    const toGenerate: Direction[] = [];
    for (const target of missing) {
      const partner = mirrorOf(target);
      if (partner !== null && findDirection(base, partner, active.id) !== undefined) { mirrorDirection(active, partner, target); created.push(`${target} (mirror)`); continue; }
      if (partner !== null && toGenerate.includes(partner)) continue;
      toGenerate.push(target);
    }
    const failed: string[] = [];
    if (toGenerate.length > 0) {
      const source = activeDerivationSource(baseAsset.id);
      const results = await deriveFromSources(toGenerate.map((target) => ({ source, instruction: turnInstruction(baseDirection, view, target, view), name: directionName(base, target), mode: "rotate" as const })));
      results.forEach((result, index) => {
        const target = toGenerate[index] as Direction;
        if (result.status === "rejected") { failed.push(`${target}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`); return; }
        created.push(`${target} (generated)`);
        // Each success asks for the view in turn, so the human lands on whatever was created last.
        assetNavigation.request(result.value.id);
        const partner = mirrorOf(target);
        if (partner !== null && missing.includes(partner) && findDirection(base, partner, active.id) === undefined) { mirrorDirection(active, target, partner); created.push(`${partner} (mirror)`); }
      });
    }
    if (failed.length > 0) {
      throw new ToolError(`${created.length === 0 ? `No direction of ${set} could be generated` : `Completed part of ${set}: ${created.join(", ")}`}; failed ${failed.join("; ")}. The successful directions are kept; run the set again to retry the rest.`);
    }
    return created.length === 0 ? `The ${set} set is already complete.` : `Completed ${set}: ${created.join(", ")}.`;
  },
};
