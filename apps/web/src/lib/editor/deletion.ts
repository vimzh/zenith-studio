import { projects, type AssetPlacement } from "./projects";
import { session } from "./session";

/**
 * Deleting an asset, and putting it back.
 *
 * `session.close` forgets the document; it knows nothing about *where* the
 * asset sat, because placement lives in the project tree. Deleting through the
 * session alone therefore left the placement record behind, and a placement
 * pointing at a document that no longer exists is not inert: the explorer
 * renders a row for every id in the folder and falls back to the raw id when
 * the name is missing, so a deleted asset came back as a ghost row reading
 * `asset_007`, and the project's asset count kept counting it.
 *
 * So both stores move together, in both directions. The undo is the reason the
 * placement is captured rather than simply dropped — an undone deletion that
 * put the art back in the loose pool instead of its folder would technically
 * restore the asset and still lose the thing the human was looking for.
 */

let lastPlacement: { readonly id: string; readonly placement: AssetPlacement } | null = null;

export function deleteAsset(id: string): boolean {
  const placement = projects.placementOf(id);
  if (!session.close(id)) return false;
  projects.unplace(id);
  lastPlacement = { id, placement };
  return true;
}

/** Restores the last deleted asset, including the folder it was in. */
export function undoDeleteAsset(): string | null {
  const restored = session.undoDelete();
  if (restored === null) return null;

  if (lastPlacement !== null && lastPlacement.id === restored) {
    const { projectId, folderId } = lastPlacement.placement;
    // A folder deleted in the meantime falls back to the project root rather
    // than leaving the restored asset loose, where it is not visibly anywhere.
    if (projectId !== null) {
      if (!projects.place(restored, projectId, folderId)) projects.place(restored, projectId);
    }
  }
  lastPlacement = null;
  return restored;
}
