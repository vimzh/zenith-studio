import { DEFAULT_FRAME_DURATION_MS, TRANSPARENT, type Cell, type Grid } from "@zenith/core";

/**
 * Spritesheet packing and the JSON atlas beside it.
 *
 * The atlas follows the shape Aseprite exports and TexturePacker popularised,
 * because that is what engines already read — Phaser loads it directly, and
 * Godot and Unity importers are written against it. Inventing a format here
 * would mean every user writing a loader.
 */

export interface SheetFrame {
  readonly name: string;
  readonly grid: Grid;
  readonly durationMs?: number;
  /** Groups frames into a named animation in the atlas. */
  readonly tag?: string;
}

export interface PackOptions {
  /** Columns in the sheet. Defaults to a roughly square layout. */
  readonly columns?: number;
  /** Transparent gutter between cells, to stop bilinear filtering bleeding neighbours. */
  readonly padding?: number;
}

export interface AtlasFrame {
  readonly filename: string;
  readonly frame: { x: number; y: number; w: number; h: number };
  readonly rotated: false;
  readonly trimmed: false;
  readonly spriteSourceSize: { x: number; y: number; w: number; h: number };
  readonly sourceSize: { w: number; h: number };
  readonly duration: number;
}

export interface Atlas {
  readonly frames: readonly AtlasFrame[];
  readonly meta: {
    readonly app: string;
    readonly version: string;
    readonly format: "I8";
    readonly size: { w: number; h: number };
    readonly scale: string;
    readonly frameTags: readonly { name: string; from: number; to: number; direction: "forward" }[];
  };
}

export interface PackedSheet {
  /** One indexed grid holding every frame. Same palette as the source frames. */
  readonly sheet: Grid;
  readonly atlas: Atlas;
}

/**
 * Packs frames into a grid layout.
 *
 * A uniform grid rather than a bin-packer: every frame in a sprite sheet shares
 * the document's dimensions, so there is nothing to pack tightly, and a
 * predictable row/column layout is what engine importers expect to slice.
 */
export function packSpritesheet(
  frames: readonly SheetFrame[],
  options: PackOptions = {}
): PackedSheet {
  if (frames.length === 0) {
    throw new Error("A spritesheet needs at least one frame.");
  }

  const first = frames[0] as SheetFrame;
  const cellWidth = first.grid.width;
  const cellHeight = first.grid.height;

  for (const frame of frames) {
    if (frame.grid.width !== cellWidth || frame.grid.height !== cellHeight) {
      throw new Error(
        `Frame '${frame.name}' is ${String(frame.grid.width)}x${String(frame.grid.height)} but the sheet cell is ${String(cellWidth)}x${String(cellHeight)}. Every frame must share the document's dimensions.`
      );
    }
  }

  const padding = Math.max(0, Math.trunc(options.padding ?? 0));
  const columns = Math.max(1, Math.trunc(options.columns ?? Math.ceil(Math.sqrt(frames.length))));
  const rows = Math.ceil(frames.length / columns);

  const strideX = cellWidth + padding;
  const strideY = cellHeight + padding;
  const width = columns * strideX - (padding > 0 ? padding : 0);
  const height = rows * strideY - (padding > 0 ? padding : 0);

  const cells = new Int16Array(width * height).fill(TRANSPARENT);
  const atlasFrames: AtlasFrame[] = [];

  frames.forEach((frame, index) => {
    const originX = (index % columns) * strideX;
    const originY = Math.floor(index / columns) * strideY;

    for (let y = 0; y < cellHeight; y += 1) {
      for (let x = 0; x < cellWidth; x += 1) {
        cells[(originY + y) * width + originX + x] = (frame.grid.cells[y * cellWidth + x] ??
          TRANSPARENT) as Cell;
      }
    }

    atlasFrames.push({
      filename: frame.name,
      frame: { x: originX, y: originY, w: cellWidth, h: cellHeight },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: cellWidth, h: cellHeight },
      sourceSize: { w: cellWidth, h: cellHeight },
      duration: frame.durationMs ?? DEFAULT_FRAME_DURATION_MS,
    });
  });

  return {
    sheet: { width, height, cells },
    atlas: {
      frames: atlasFrames,
      meta: {
        app: "Zenith Studio",
        version: "1.0",
        format: "I8",
        size: { w: width, h: height },
        scale: "1",
        frameTags: buildTags(frames),
      },
    },
  };
}

/**
 * Contiguous runs of the same tag become animation ranges.
 *
 * Contiguous specifically: a tag appearing in two separate runs would produce
 * one range spanning the frames between them, which is silently wrong for a
 * player that reads `from`/`to`.
 */
function buildTags(
  frames: readonly SheetFrame[]
): { name: string; from: number; to: number; direction: "forward" }[] {
  const tags: { name: string; from: number; to: number; direction: "forward" }[] = [];
  let current: { name: string; from: number; to: number; direction: "forward" } | null = null;

  frames.forEach((frame, index) => {
    if (frame.tag === undefined) {
      current = null;
      return;
    }
    if (current !== null && current.name === frame.tag) {
      current.to = index;
      return;
    }
    current = { name: frame.tag, from: index, to: index, direction: "forward" };
    tags.push(current);
  });

  return tags;
}
