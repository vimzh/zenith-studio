/**
 * The plain-JSON document format.
 *
 * Grids serialise as the Part 1 text encoding rather than as arrays of numbers:
 * a saved document is legible in a diff, an agent can paste one straight into
 * `write_region`, and the codec is exercised by every save instead of only by
 * the tool layer.
 *
 * `deserializeDocument` takes `unknown` and validates everything. Nothing enters
 * the model without passing the invariants.
 */

import { fail } from "./errors";
import { createDocument, createFrame, createLayer, validateDocument } from "./document";
import { decodeGrid, encodeGrid } from "./grid";
import { createPalette } from "./palette";
import type { Frame, Layer, PixelDocument } from "./types";

export const DOCUMENT_FORMAT = "zenith.document";
export const DOCUMENT_VERSION = 2;

export interface SerializedLayer {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  /** Compact `0`-`F` rows, or `@hex` followed by space-separated hex token rows. */
  readonly grid: string;
}

export interface SerializedFrame {
  readonly id: string;
  readonly durationMs: number;
  readonly layers: readonly SerializedLayer[];
}

export interface SerializedPalette {
  readonly id: string;
  readonly name: string;
  readonly colors: readonly string[];
}

export interface SerializedDocument {
  readonly format: typeof DOCUMENT_FORMAT;
  readonly version: 1 | typeof DOCUMENT_VERSION;
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly palette: SerializedPalette;
  readonly frames: readonly SerializedFrame[];
  readonly metadata: {
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly tags: readonly string[];
  };
}

export function serializeDocument(document: PixelDocument): SerializedDocument {
  return {
    format: DOCUMENT_FORMAT,
    version: document.palette.colors.length <= 16 ? 1 : DOCUMENT_VERSION,
    id: document.id,
    name: document.name,
    width: document.width,
    height: document.height,
    palette: {
      id: document.palette.id,
      name: document.palette.name,
      colors: document.palette.colors.map((color) => color.hex),
    },
    frames: document.frames.map((frame: Frame) => ({
      id: frame.id,
      durationMs: frame.durationMs,
      layers: frame.layers.map((layer: Layer) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        grid: encodeGrid(layer.grid),
      })),
    })),
    metadata: {
      createdAt: document.metadata.createdAt,
      updatedAt: document.metadata.updatedAt,
      tags: [...document.metadata.tags],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== "string") {
    fail("invalid_document", `${path}.${key} must be a string, received ${describe(value)}.`);
  }
  return value;
}

function readNumber(source: Record<string, unknown>, key: string, path: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("invalid_document", `${path}.${key} must be a finite number, received ${describe(value)}.`);
  }
  return value;
}

function readArray(source: Record<string, unknown>, key: string, path: string): readonly unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    fail("invalid_document", `${path}.${key} must be an array, received ${describe(value)}.`);
  }
  return value;
}

function readRecord(source: Record<string, unknown>, key: string, path: string): Record<string, unknown> {
  const value = source[key];
  if (!isRecord(value)) {
    fail("invalid_document", `${path}.${key} must be an object, received ${describe(value)}.`);
  }
  return value;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

export function deserializeDocument(raw: unknown): PixelDocument {
  if (!isRecord(raw)) {
    fail("invalid_document", `Expected a document object, received ${describe(raw)}.`);
  }
  if (raw["format"] !== DOCUMENT_FORMAT) {
    fail(
      "invalid_document",
      `Unknown format ${describe(raw["format"])}. Expected '${DOCUMENT_FORMAT}'.`,
    );
  }
  if (raw["version"] !== 1 && raw["version"] !== DOCUMENT_VERSION) {
    fail(
      "invalid_document",
      `Unsupported document version ${String(raw["version"])}. This build reads versions 1 and ${String(DOCUMENT_VERSION)}.`,
    );
  }

  const width = readNumber(raw, "width", "document");
  const height = readNumber(raw, "height", "document");

  const rawPalette = readRecord(raw, "palette", "document");
  const paletteColors = readArray(rawPalette, "colors", "document.palette").map((color, index) => {
    if (typeof color !== "string") {
      fail(
        "invalid_document",
        `document.palette.colors[${String(index)}] must be a hex string, received ${describe(color)}.`,
      );
    }
    return color;
  });
  if (raw["version"] === 1 && paletteColors.length > 16) {
    fail("invalid_document", "Document version 1 supports at most 16 palette colours. Use version 2 for expanded palettes.");
  }
  const palette = createPalette({
    id: readString(rawPalette, "id", "document.palette"),
    name: readString(rawPalette, "name", "document.palette"),
    colors: paletteColors,
  });

  const rawFrames = readArray(raw, "frames", "document");
  if (rawFrames.length === 0) {
    fail("invalid_document", "document.frames is empty. Every document has at least one frame.");
  }
  const frames: Frame[] = rawFrames.map((entry, frameIndex) => {
    const framePath = `document.frames[${String(frameIndex)}]`;
    if (!isRecord(entry)) {
      fail("invalid_document", `${framePath} must be an object, received ${describe(entry)}.`);
    }
    const rawLayers = readArray(entry, "layers", framePath);
    if (rawLayers.length === 0) {
      fail("invalid_document", `${framePath}.layers is empty. Every frame has at least one layer.`);
    }
    const layers: Layer[] = rawLayers.map((rawLayer, layerIndex) => {
      const layerPath = `${framePath}.layers[${String(layerIndex)}]`;
      if (!isRecord(rawLayer)) {
        fail("invalid_document", `${layerPath} must be an object, received ${describe(rawLayer)}.`);
      }
      const grid = decodeGrid(readString(rawLayer, "grid", layerPath));
      if (grid.width !== width || grid.height !== height) {
        fail(
          "frame_mismatch",
          `${layerPath}.grid decodes to ${String(grid.width)}x${String(grid.height)} but the document is ${String(width)}x${String(height)}. All frames of an asset share dimensions and palette.`,
        );
      }
      return createLayer(width, height, {
        id: readString(rawLayer, "id", layerPath),
        name: readString(rawLayer, "name", layerPath),
        visible: rawLayer["visible"] !== false,
        grid,
      });
    });
    return createFrame(width, height, {
      id: readString(entry, "id", framePath),
      durationMs: readNumber(entry, "durationMs", framePath),
      layers,
    });
  });

  const rawMetadata = isRecord(raw["metadata"]) ? raw["metadata"] : {};
  const tags = Array.isArray(rawMetadata["tags"])
    ? rawMetadata["tags"].filter((tag): tag is string => typeof tag === "string")
    : [];

  const document = createDocument({
    id: readString(raw, "id", "document"),
    name: readString(raw, "name", "document"),
    width,
    height,
    palette,
    frames,
    metadata: {
      createdAt: typeof rawMetadata["createdAt"] === "string" ? rawMetadata["createdAt"] : new Date(0).toISOString(),
      updatedAt: typeof rawMetadata["updatedAt"] === "string" ? rawMetadata["updatedAt"] : new Date(0).toISOString(),
      tags,
    },
  });
  validateDocument(document);
  return document;
}

export function documentToJSON(document: PixelDocument): string {
  return JSON.stringify(serializeDocument(document));
}

export function documentFromJSON(json: string): PixelDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    fail(
      "invalid_document",
      `Document JSON is not parseable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return deserializeDocument(parsed);
}
