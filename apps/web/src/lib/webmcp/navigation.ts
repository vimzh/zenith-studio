/**
 * Moving the human's view when the agent opens a different asset.
 *
 * The route is the source of truth for what is open, and `AssetEditor` pushes it
 * into the session on mount. That covers the human moving. It does not cover the
 * agent moving: `open_asset` and `create_asset` change `session.activeId`
 * directly, and without this the route stays where it was — so the agent edits
 * one asset while the human watches another, silently. Silent divergence is the
 * worst failure this product can have, so both directions have to close.
 *
 * Navigation follows an explicit request rather than a detected mismatch. The
 * two are not equivalent: on mount the session and the route legitimately
 * disagree for one commit, because effects run child-first and this component is
 * deeper in the tree than the one that reconciles them. A mismatch detector
 * fires inside that window and navigates away from the asset the human just
 * clicked. Only a tool asking to move can mean it.
 */

const ASSET_ROUTE = /^\/asset\/([^/]+)\/?$/;

/** The asset id an editor route addresses, or null when the path is not one. */
export function assetRouteId(pathname: string): string | null {
  return ASSET_ROUTE.exec(pathname)?.[1] ?? null;
}

/**
 * The route to navigate to for a requested asset, or null to stay put.
 *
 * Null when nothing was requested, when the route already shows it, and when the
 * human is not in the editor at all — which leaves someone browsing the library
 * where they are instead of yanking them into a canvas.
 */
export function routeForRequestedAsset(pathname: string, requestedId: string | null): string | null {
  if (requestedId === null) return null;
  const routeId = assetRouteId(pathname);
  if (routeId === null || routeId === requestedId) return null;
  return `/asset/${requestedId}`;
}

/**
 * A pending request to show an asset, raised by a tool and consumed by the router.
 *
 * A module singleton for the same reason the session is: tool handlers run
 * outside the React tree and cannot call a router hook.
 */
class AssetNavigation {
  #requested: string | null = null;
  readonly #listeners = new Set<() => void>();

  /** Asks that the human's view move to this asset. */
  request(assetId: string): void {
    if (this.#requested === assetId) return;
    this.#requested = assetId;
    this.#notify();
  }

  peek(): string | null {
    return this.#requested;
  }

  clear(): void {
    if (this.#requested === null) return;
    this.#requested = null;
    this.#notify();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

export const assetNavigation = new AssetNavigation();
