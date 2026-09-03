import type { Atlas } from "@/lib/spritesheet";
import { DEFAULT_FRAME_DURATION_MS } from "@zenith/core";

/**
 * Engine export bundles.
 *
 * The PNG is the easy part. What actually saves time is the sidecar that tells
 * the engine how to import it — because forgetting to set nearest-neighbour
 * filtering is *the* way pixel art arrives blurry, and it is entirely
 * avoidable when the exporter writes the import settings itself.
 *
 * Every file here is text, so every one is testable without an engine.
 */

export type Engine = "godot" | "unity" | "phaser" | "love";

export interface EngineFile {
  readonly path: string;
  readonly contents: string;
}

export interface EngineBundle {
  readonly engine: Engine;
  readonly files: readonly EngineFile[];
  /** One or two lines telling the user what to do with the bundle. */
  readonly instructions: string;
}

export interface EngineOptions {
  readonly name: string;
  readonly atlas: Atlas;
  /** Pixels per world unit. Conventionally the sprite's own height. */
  readonly pixelsPerUnit?: number;
}

/**
 * Godot 4.
 *
 * The `.import` file is the point: `filter=false` and lossless compression are
 * what keep the sprite sharp, and Godot writes this file itself on first import
 * with the project defaults — which are wrong for pixel art.
 */
function godot({ name, atlas, pixelsPerUnit }: EngineOptions): EngineBundle {
  const importFile = [
    "[remap]",
    "",
    'importer="texture"',
    'type="CompressedTexture2D"',
    `uid="uid://zenith_${name}"`,
    `path="res://.godot/imported/${name}.png-zenith.ctex"`,
    "",
    "[deps]",
    "",
    `source_file="res://${name}.png"`,
    `dest_files=["res://.godot/imported/${name}.png-zenith.ctex"]`,
    "",
    "[params]",
    "",
    "compress/mode=0",
    "compress/lossy_quality=0.7",
    "compress/hdr_compression=1",
    "compress/normal_map=0",
    "mipmaps/generate=false",
    "roughness/mode=0",
    "process/fix_alpha_border=true",
    "process/premult_alpha=false",
    "process/normal_map_invert_y=false",
    "detect_3d/compress_to=0",
  ].join("\n");

  const frames = atlas.frames
    .map(
      (frame) =>
        `  {\n    "name": "${frame.filename}",\n    "region": Rect2(${String(frame.frame.x)}, ${String(frame.frame.y)}, ${String(frame.frame.w)}, ${String(frame.frame.h)}),\n    "duration": ${(frame.duration / 1000).toFixed(3)}\n  }`
    )
    .join(",\n");

  const spriteFrames = [
    "; SpriteFrames data for AnimatedSprite2D.",
    "; Regions are in pixels; durations in seconds.",
    `; Source: ${name}.png (${String(atlas.meta.size.w)}x${String(atlas.meta.size.h)})`,
    "",
    "[",
    frames,
    "]",
  ].join("\n");

  return {
    engine: "godot",
    files: [
      { path: `${name}.png.import`, contents: `${importFile}\n` },
      { path: `${name}.frames.txt`, contents: `${spriteFrames}\n` },
      {
        path: `${name}.README.md`,
        contents: [
          `# ${name} — Godot 4`,
          "",
          `1. Copy \`${name}.png\` and \`${name}.png.import\` into your project together.`,
          "2. Godot picks up the import settings automatically — filtering is already off.",
          `3. Slice with \`${name}.frames.txt\` for an AnimatedSprite2D, or use the atlas JSON.`,
          "",
          `Pixels per unit: ${String(pixelsPerUnit ?? atlas.frames[0]?.sourceSize.h ?? 32)}`,
          "",
        ].join("\n"),
      },
    ],
    instructions: `Copy ${name}.png and ${name}.png.import together. Godot reads the import settings from the sidecar, so filtering is already off.`,
  };
}

/**
 * Unity.
 *
 * `filterMode: 0` is Point, `textureCompression: 0` is None, and the
 * `spriteSheet.sprites` list arrives pre-sliced so nobody opens the Sprite
 * Editor to redo work the exporter already knows.
 */
function unity({ name, atlas, pixelsPerUnit }: EngineOptions): EngineBundle {
  const ppu = pixelsPerUnit ?? atlas.frames[0]?.sourceSize.h ?? 32;
  const height = atlas.meta.size.h;

  const sprites = atlas.frames
    .map((frame) =>
      [
        `    - serializedVersion: 2`,
        `      name: ${frame.filename}`,
        `      rect:`,
        `        serializedVersion: 2`,
        `        x: ${String(frame.frame.x)}`,
        // Unity's texture origin is bottom-left; the atlas is top-left.
        `        y: ${String(height - frame.frame.y - frame.frame.h)}`,
        `        width: ${String(frame.frame.w)}`,
        `        height: ${String(frame.frame.h)}`,
        `      alignment: 0`,
        `      pivot: {x: 0.5, y: 0.5}`,
      ].join("\n")
    )
    .join("\n");

  const meta = [
    "fileFormatVersion: 2",
    "TextureImporter:",
    "  serializedVersion: 12",
    "  textureType: 8",
    "  spriteMode: 2",
    `  spritePixelsToUnits: ${String(ppu)}`,
    "  filterMode: 0",
    "  textureCompression: 0",
    "  mipmaps:",
    "    mipMapMode: 0",
    "    enableMipMap: 0",
    "  wrapU: 1",
    "  wrapV: 1",
    "  spriteSheet:",
    "    serializedVersion: 2",
    "    sprites:",
    sprites,
    "  userData: Zenith Studio",
  ].join("\n");

  return {
    engine: "unity",
    files: [{ path: `${name}.png.meta`, contents: `${meta}\n` }],
    instructions: `Place ${name}.png.meta beside ${name}.png before opening Unity. Filtering is Point, compression None, and the sheet arrives pre-sliced.`,
  };
}

/** Phaser 3 reads the atlas JSON directly; the snippet is the whole integration. */
function phaser({ name, atlas }: EngineOptions): EngineBundle {
  const tags = atlas.meta.frameTags;
  const animations = tags
    .map(
      (tag) =>
        `  this.anims.create({\n    key: '${tag.name}',\n    frames: this.anims.generateFrameNames('${name}', { start: ${String(tag.from)}, end: ${String(tag.to)} }),\n    frameRate: ${String(Math.round(1000 / (atlas.frames[tag.from]?.duration ?? DEFAULT_FRAME_DURATION_MS)))},\n    repeat: -1,\n  });`
    )
    .join("\n");

  const snippet = [
    "// Zenith Studio → Phaser 3",
    "function preload() {",
    `  this.load.atlas('${name}', '${name}.png', '${name}.json');`,
    "}",
    "",
    "function create() {",
    animations.length > 0 ? animations : "  // No tagged animations in this atlas.",
    "}",
    "",
    "// Pixel art needs this in your game config, or Phaser smooths the texture:",
    "//   { pixelArt: true }",
  ].join("\n");

  return {
    engine: "phaser",
    files: [
      { path: `${name}.json`, contents: `${JSON.stringify(atlas, null, 2)}\n` },
      { path: `${name}.phaser.js`, contents: `${snippet}\n` },
    ],
    instructions: `Load with this.load.atlas. Set pixelArt: true in your game config, or Phaser smooths the texture.`,
  };
}

/** LÖVE has no asset pipeline, so the export is the Lua that defines the quads. */
function love({ name, atlas }: EngineOptions): EngineBundle {
  const quads = atlas.frames
    .map(
      (frame) =>
        `  ${frame.filename.replace(/[^a-zA-Z0-9_]/g, "_")} = love.graphics.newQuad(${String(frame.frame.x)}, ${String(frame.frame.y)}, ${String(frame.frame.w)}, ${String(frame.frame.h)}, sheet:getDimensions()),`
    )
    .join("\n");

  const lua = [
    `-- Zenith Studio → LÖVE`,
    `local sheet = love.graphics.newImage('${name}.png')`,
    `-- Nearest filtering, or LÖVE blurs every sprite it draws.`,
    `sheet:setFilter('nearest', 'nearest')`,
    "",
    "local quads = {",
    quads,
    "}",
    "",
    "return { sheet = sheet, quads = quads }",
  ].join("\n");

  return {
    engine: "love",
    files: [{ path: `${name}.lua`, contents: `${lua}\n` }],
    instructions: `require the returned table. setFilter('nearest','nearest') is already applied — without it LÖVE blurs every sprite.`,
  };
}

const BUILDERS: Record<Engine, (options: EngineOptions) => EngineBundle> = {
  godot,
  unity,
  phaser,
  love,
};

export function exportForEngine(engine: Engine, options: EngineOptions): EngineBundle {
  const build = BUILDERS[engine];
  if (build === undefined) {
    throw new Error(
      `No exporter for '${String(engine)}'. Available: ${Object.keys(BUILDERS).join(", ")}.`
    );
  }
  if (options.name.trim().length === 0) {
    throw new Error("An export needs a non-empty name.");
  }
  return build(options);
}
