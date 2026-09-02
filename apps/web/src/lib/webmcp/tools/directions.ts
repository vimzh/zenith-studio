import { projects, session } from "@/lib/editor";
import { DIRECTIONS, DIRECTION_SETS, mirrorGrid, mirrorOf, type Direction, type DirectionSet, type View, VIEWS } from "@/lib/directions";
import { readEnum } from "../args";
import { assetNavigation } from "../navigation";
import { ToolError, type ToolArgs, type ToolDefinition } from "../types";
import { requireActiveAsset } from "./active";
import { activeDerivationSource, deriveFromSource } from "./generation";

const SETS = Object.keys(DIRECTION_SETS) as DirectionSet[];

function baseName(name: string): string {
  for (const direction of DIRECTIONS) {
    const suffix = ` ${direction}`;
    if (name.toLowerCase().endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return name;
}

function directionName(base: string, direction: Direction): string { return `${base} ${direction}`; }

function findDirection(base: string, direction: Direction) {
  const expected = directionName(base, direction).toLowerCase();
  return session.list().find((asset) => asset.name.toLowerCase() === expected);
}

export const getDirections: ToolDefinition = {
  scope: "character", name: "get_directions", description: "List directional assets belonging to the open character by their shared name and report missing directions.", readOnly: true,
  inputSchema: { type: "object", properties: { set: { type: "string", enum: [...SETS] } } }, example: { set: "cardinal4" },
  execute: (args) => { const { name } = requireActiveAsset(); const base = baseName(name); const set = readEnum<DirectionSet>(args, "set", SETS, "ordinal8"); const wanted = DIRECTION_SETS[set]; const have = wanted.filter((direction) => findDirection(base, direction) !== undefined); const missing = wanted.filter((direction) => !have.includes(direction)); return `Directions for '${base}': ${have.join(", ") || "none"}. Missing: ${missing.join(", ") || "none"}.`; },
};

export const selectDirection: ToolDefinition = {
  scope: "character", name: "select_direction", description:
    "Open the asset for one facing direction of the current character, making it the target of every editing and perception tool. Directions are separate assets sharing a name and palette; get_directions lists which exist, which are mirror-derived, and which are missing. The human's view follows, so they see the direction you are working on.",
  inputSchema: { type: "object", properties: { direction: { type: "string", enum: [...DIRECTIONS] } }, required: ["direction"] }, example: { direction: "west" },
  execute: (args) => { const { name } = requireActiveAsset(); const direction = readEnum<Direction>(args, "direction", DIRECTIONS); const asset = findDirection(baseName(name), direction); if (asset === undefined) throw new ToolError(`No ${direction} direction exists yet.`); session.open(asset.id); assetNavigation.request(asset.id); return `Opened ${asset.id} '${asset.name}'.`; },
};

export const deriveDirectionByMirror: ToolDefinition = {
  scope: "character", name: "derive_direction_by_mirror", description: "Create a direction by an exact horizontal mirror. Valid for east/west and diagonal left/right pairs.",
  inputSchema: { type: "object", properties: { from_direction: { type: "string", enum: [...DIRECTIONS] }, to_direction: { type: "string", enum: [...DIRECTIONS] } }, required: ["from_direction", "to_direction"] }, example: { from_direction: "east", to_direction: "west" },
  execute: (args) => {
    const from = readEnum<Direction>(args, "from_direction", DIRECTIONS); const to = readEnum<Direction>(args, "to_direction", DIRECTIONS);
    if (mirrorOf(from) !== to) throw new ToolError(`${from} does not mirror to ${to}.`);
    const active = requireActiveAsset(); const base = baseName(active.name); const source = findDirection(base, from) ?? (active.name === base ? session.list().find((item) => item.id === active.id) : undefined);
    if (source === undefined) throw new ToolError(`No ${from} source exists for '${base}'.`);
    const store = session.get(source.id); if (store === undefined) throw new ToolError(`No source asset '${source.id}'.`);
    const id = session.create({ name: directionName(base, to), type: source.type, width: store.width, height: store.height, palette: store.palette.colors.map((color) => color.hex), grid: mirrorGrid(store.readComposite()) });
    projects.inherit(source.id, id);
    assetNavigation.request(id); return `Created ${to} as ${id} by pixel-exact mirroring from ${from}.`;
  },
};

async function generateDirection(args: ToolArgs): Promise<string> {
  const from = readEnum<Direction>(args, "from_direction", DIRECTIONS); const to = readEnum<Direction>(args, "to_direction", DIRECTIONS);
  const view = readEnum<View>(args, "to_view", VIEWS, "low top-down"); const active = requireActiveAsset(); const base = baseName(active.name);
  const source = findDirection(base, from) ?? session.list().find((item) => item.id === active.id); if (source === undefined) throw new ToolError(`No ${from} source exists.`);
  session.open(source.id);
  // `mode: "rotate"` rather than the default. The default prompt preserves the
  // camera angle, which silently defeated this tool entirely: every direction
  // came back as the source view, filed under a direction it did not depict,
  // with nothing reporting a problem. Measured on ten chests turned to a side
  // and a back — twenty generations, twenty unchanged front views.
  const result = await deriveFromSource(
    activeDerivationSource(),
    `Redraw this exact character seen facing ${to}, in a ${view} view. Preserve identity, proportions, palette, lighting and the transparent background.`,
    directionName(base, to),
    "rotate",
  );
  return `${result.message} Generated ${to} from ${from}; inspect it with read_canvas and repair asymmetrical details if necessary.`;
}

export const rotateCharacter: ToolDefinition = {
  network: true,
  scope: "character", name: "rotate_character", description: "Generate one new character direction. Slow and paid; prefer derive_direction_by_mirror when possible.",
  inputSchema: { type: "object", properties: { from_direction: { type: "string", enum: [...DIRECTIONS] }, to_direction: { type: "string", enum: [...DIRECTIONS] }, from_view: { type: "string", enum: [...VIEWS] }, to_view: { type: "string", enum: [...VIEWS] } }, required: ["from_direction", "to_direction"] }, example: { from_direction: "south", to_direction: "east", to_view: "low top-down" }, execute: generateDirection,
};

export const generateDirectionSet: ToolDefinition = {
  network: true,
  scope: "character", name: "generate_direction_set", description: "Complete a directional set, using exact mirrors first and model edits only where needed.",
  inputSchema: { type: "object", properties: { set: { type: "string", enum: [...SETS] }, base_direction: { type: "string", enum: [...DIRECTIONS] }, view: { type: "string", enum: [...VIEWS] } }, required: ["set"] }, example: { set: "cardinal4", base_direction: "south" },
  execute: async (args) => {
    const set = readEnum<DirectionSet>(args, "set", SETS); const baseDirection = readEnum<Direction>(args, "base_direction", DIRECTIONS, "south"); const view = readEnum<View>(args, "view", VIEWS, "low top-down");
    const active = requireActiveAsset(); const base = baseName(active.name); if (findDirection(base, baseDirection) === undefined && active.name === base) session.rename(active.id, directionName(base, baseDirection));
    const created: string[] = [];
    for (const target of DIRECTION_SETS[set]) {
      if (findDirection(base, target) !== undefined) continue;
      const partner = mirrorOf(target); const mirrorSource = partner === null ? undefined : findDirection(base, partner);
      if (partner !== null && mirrorSource !== undefined) { session.open(mirrorSource.id); await deriveDirectionByMirror.execute({ from_direction: partner, to_direction: target }); created.push(`${target} (mirror)`); continue; }
      const source = findDirection(base, baseDirection) ?? session.list().find((asset) => asset.id === active.id); if (source === undefined) throw new ToolError(`The base direction ${baseDirection} is missing.`);
      session.open(source.id); await generateDirection({ from_direction: baseDirection, to_direction: target, to_view: view }); created.push(`${target} (generated)`);
    }
    return created.length === 0 ? `The ${set} set is already complete.` : `Completed ${set}: ${created.join(", ")}.`;
  },
};
