import { deserializeDocument, serializeDocument, type SerializedDocument } from "@zenith/core";
import { session, type AssetType } from "./session";
import { projects } from "./projects";

/**
 * Import and export as JSON.
 *
 * Round-tripping must be lossless: an exported library re-imports to an
 * identical state, which is the phase 05 exit criterion and also the escape
 * hatch if IndexedDB is unavailable.
 */

export const LIBRARY_FORMAT = "zenith.library";
export const LIBRARY_VERSION = 1;

export interface ExportedAsset {
  readonly name: string;
  readonly type: AssetType;
  readonly document: SerializedDocument;
}

export interface ExportedLibrary {
  readonly format: typeof LIBRARY_FORMAT;
  readonly version: typeof LIBRARY_VERSION;
  readonly exportedAt: string;
  readonly assets: readonly ExportedAsset[];
}

export function exportLibrary(): ExportedLibrary {
  return {
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    exportedAt: new Date().toISOString(),
    assets: session.list().flatMap((summary) => {
      const store = session.get(summary.id);
      if (store === undefined) {
        return [];
      }
      return [{ name: summary.name, type: summary.type, document: serializeDocument(store.snapshot()) }];
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Adds every asset in a bundle to the library.
 *
 * Import is additive and always mints fresh ids, so importing a bundle that
 * came from this same library duplicates rather than overwriting — the
 * destructive alternative would be a silent data loss on a mistaken drop.
 */
export function importLibrary(raw: unknown): { imported: number; skipped: number } {
  if (!isRecord(raw) || raw["format"] !== LIBRARY_FORMAT) {
    throw new Error(
      `Not a Zenith library file. Expected format '${LIBRARY_FORMAT}'.`
    );
  }
  if (raw["version"] !== LIBRARY_VERSION) {
    throw new Error(
      `Unsupported library version ${String(raw["version"])}. This build reads version ${String(LIBRARY_VERSION)}.`
    );
  }

  const assets = Array.isArray(raw["assets"]) ? raw["assets"] : [];
  let imported = 0;
  let skipped = 0;

  for (const entry of assets) {
    if (!isRecord(entry)) {
      skipped += 1;
      continue;
    }
    try {
      const document = deserializeDocument(entry["document"]);
      session.adopt(document, {
        name: typeof entry["name"] === "string" ? entry["name"] : document.name,
        type: (entry["type"] as AssetType | undefined) ?? "tile",
      });
      imported += 1;
    } catch {
      // One malformed asset must not abort the whole import.
      skipped += 1;
    }
  }

  return { imported, skipped };
}

export function downloadLibrary(filename = "zenith-library.json"): void {
  const blob = new Blob([JSON.stringify(exportLibrary(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** A project-scoped backup including its style, hierarchy and assets. */
export function exportProjectBundle(projectId: string) {
  const project = projects.getProject(projectId);
  if (project === undefined) throw new Error(`No project '${projectId}'.`);
  const assetIds = new Set(projects.assetsInProject(projectId));
  const tree = projects.snapshot();
  return {
    format: "zenith.project" as const,
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    project,
    folders: tree.folders.filter((folder) => folder.projectId === projectId),
    placements: tree.placements.filter((placement) => assetIds.has(placement.assetId)),
    assets: session.list().flatMap((summary) => {
      if (!assetIds.has(summary.id)) return [];
      const store = session.get(summary.id);
      return store === undefined
        ? []
        : [{ id: summary.id, name: summary.name, type: summary.type, document: serializeDocument(store.snapshot()) }];
    }),
  };
}

export function downloadProject(projectId: string): void {
  const project = projects.getProject(projectId);
  if (project === undefined) throw new Error(`No project '${projectId}'.`);
  const blob = new Blob([JSON.stringify(exportProjectBundle(projectId), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"}.zenith.json`;
  link.click();
  URL.revokeObjectURL(url);
}
