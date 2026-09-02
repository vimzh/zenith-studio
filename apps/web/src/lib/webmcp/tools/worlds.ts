import { createGrid, paletteHexes, TRANSPARENT, type Grid } from "@zenith/core";
import { projects, session } from "@/lib/editor";
import { assembleMap, createTerrain, type EdgeRule, type Side } from "@/lib/tileset";
import { resizeCanvas } from "@/lib/transform";
import { readEnum, readInteger, readString } from "../args";
import { assetNavigation } from "../navigation";
import { ToolError, type ToolDefinition } from "../types";
import { requireActiveAsset } from "./active";
import { generateAsset } from "./generation";

function splitTileset(sheet: Grid, tileSize: number): Grid[] {
  if (sheet.width % tileSize !== 0 || sheet.height % tileSize !== 0) throw new ToolError(`The open tileset is ${String(sheet.width)}x${String(sheet.height)}, not divisible by tile_size ${String(tileSize)}.`);
  const tiles: Grid[] = [];
  for (let oy = 0; oy < sheet.height; oy += tileSize) for (let ox = 0; ox < sheet.width; ox += tileSize) { const tile = createGrid(tileSize, tileSize, TRANSPARENT); for (let y = 0; y < tileSize; y += 1) tile.cells.set(sheet.cells.subarray((oy + y) * sheet.width + ox, (oy + y) * sheet.width + ox + tileSize), y * tileSize); tiles.push(tile); }
  return tiles;
}

export const generateTexture: ToolDefinition = {
  // Delegates to generate_asset, so it reaches a paid model call.
  network: true,
  scope: "always", name: "generate_texture", description: "Generate a seamless material texture, pixelise it into the selected preset palette, add it to the library, and open it as an indexed texture asset.",
  inputSchema: { type: "object", properties: { prompt: { type: "string" }, name: { type: "string" }, preset: { type: "string" } }, required: ["prompt"] }, example: { prompt: "seamless mossy cobblestone, top-down", name: "Mossy cobblestone", preset: "tile-32" },
  execute: (args) => generateAsset.execute({ prompt: `${readString(args, "prompt")}; seamless repeating texture, matching edges`, name: args["name"], preset: args["preset"], type: "texture" }),
};

export const generateIsometricTile: ToolDefinition = {
  // Delegates to generate_asset, so it reaches a paid model call.
  network: true,
  scope: "always", name: "generate_isometric_tile", description: "Generate a clean 2:1 isometric diamond tile on a transparent background, pixelise it to the indexed grid, add it to the library, and open it.",
  inputSchema: { type: "object", properties: { prompt: { type: "string" }, name: { type: "string" } }, required: ["prompt"] }, example: { prompt: "grass block with dirt sides", name: "Isometric grass" },
  execute: (args) => generateAsset.execute({ prompt: `${readString(args, "prompt")}; single clean 2:1 isometric diamond tile`, name: args["name"], type: "tile", background: "transparent", size: "1536x1024", preset: "tile-32" }),
};

export const assembleMapTool: ToolDefinition = {
  scope: "tileset", name: "assemble_map", description: "Assemble the open 47-tile sheet into a map. layout is rows of 0 and 1 where 1 paints the terrain.",
  inputSchema: { type: "object", properties: { layout: { type: "string" }, tile_size: { type: "integer", minimum: 2, maximum: 128 }, edges: { type: "string", enum: ["clip", "extend"] }, name: { type: "string" } }, required: ["layout", "tile_size"] }, example: { layout: "0110\n1111\n1111\n0110", tile_size: 32, name: "Island" },
  execute: (args) => { const active = requireActiveAsset(); const rows = readString(args, "layout").trim().split("\n"); const width = rows[0]?.length ?? 0; if (width === 0 || rows.some((row) => row.length !== width || /[^01]/.test(row))) throw new ToolError("layout must be equal-length rows containing only 0 and 1."); const terrain = createTerrain(width, rows.length); const filled = rows.join("").split("").map((cell) => cell === "1"); const tileSize = readInteger(args, "tile_size", 2, 128); const tiles = splitTileset(active.store.readComposite(), tileSize); if (tiles.length < 47) throw new ToolError(`A blob map needs 47 tiles; this sheet contains ${String(tiles.length)}.`); const grid = assembleMap({ ...terrain, filled }, tiles, readEnum<EdgeRule>(args, "edges", ["clip", "extend"], "clip")); const id = session.create({ name: typeof args["name"] === "string" ? args["name"] : `${active.name} map`, type: "tile", width: grid.width, height: grid.height, palette: paletteHexes(active.store.palette), grid }); projects.inherit(active.id, id); assetNavigation.request(id); return `Created map ${id}, ${String(width)}x${String(rows.length)} cells (${String(grid.width)}x${String(grid.height)} pixels).`; },
};

export const extendMapTool: ToolDefinition = {
  scope: "tile", name: "extend_map", description: "Grow the open map by whole tile cells on one side, preserving every existing pixel and padding with transparency.",
  inputSchema: { type: "object", properties: { side: { type: "string", enum: ["north", "south", "east", "west"] }, cells: { type: "integer", minimum: 1 }, tile_size: { type: "integer", minimum: 1 } }, required: ["side", "cells", "tile_size"] }, example: { side: "east", cells: 2, tile_size: 32 },
  execute: (args) => { const { id, store } = requireActiveAsset(); const side = readEnum<Side>(args, "side", ["north", "south", "east", "west"]); const amount = readInteger(args, "cells", 1) * readInteger(args, "tile_size", 1); const width = store.width + (side === "east" || side === "west" ? amount : 0); const height = store.height + (side === "north" || side === "south" ? amount : 0); const anchor = side === "north" ? "bottom" : side === "south" ? "top" : side === "west" ? "right" : "left"; session.reshape(id, (frames) => ({ width, height, frames: frames.map((frame) => resizeCanvas(frame, width, height, anchor)) })); return `Extended ${side} by ${String(amount)} pixels.`; },
};
