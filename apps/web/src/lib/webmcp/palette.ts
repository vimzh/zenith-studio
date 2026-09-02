/**
 * What the command palette does when a tool is chosen.
 *
 * Selecting a tool does not run it. Most tools take arguments, and a palette
 * that fired `fill_region` with example values the moment you pressed Enter
 * would be a way to damage the canvas by autocomplete. It is a jump-to: the
 * Agent Console gets the tool preselected, with its example arguments, and the
 * human presses Run.
 *
 * Pure so the routing decision is testable without a DOM.
 */

import { assetRouteId } from "./navigation";

export interface ToolJump {
  /** Where to navigate first, or null to stay on the current route. */
  readonly route: string | null;
  /** False when there is no editor to jump into, so the tool cannot be reached. */
  readonly reachable: boolean;
}

/**
 * Resolves where the human has to be for a tool to be usable.
 *
 * The Agent Console only exists inside the editor, so choosing a tool from the
 * library has to open one first — the asset that is already active, falling back
 * to the first in the library.
 */
export function jumpForTool(
  pathname: string,
  activeAssetId: string | null,
  firstAssetId: string | null,
): ToolJump {
  if (assetRouteId(pathname) !== null) {
    return { route: null, reachable: true };
  }
  const target = activeAssetId ?? firstAssetId;
  if (target === null) {
    return { route: null, reachable: false };
  }
  return { route: `/asset/${target}`, reachable: true };
}
