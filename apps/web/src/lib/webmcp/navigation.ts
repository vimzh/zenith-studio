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
const PROJECT_ROUTE = /^\/project\/([^/]+)\/?$/;

/** The asset id an editor route addresses, or null when the path is not one. */
export function assetRouteId(pathname: string): string | null {
  return ASSET_ROUTE.exec(pathname)?.[1] ?? null;
}

/**
 * The route to navigate to for a requested asset, or null to stay put.
 *
 * Explicit requests also open the editor from the library. Other screens stay
 * put, and a route/session mismatch alone never requests navigation.
 */
export function routeForRequestedAsset(pathname: string, requestedId: string | null): string | null {
  if (requestedId === null) return null;
  const routeId = assetRouteId(pathname);
  if ((routeId === null && pathname !== "/home" && !PROJECT_ROUTE.test(pathname)) || routeId === requestedId) return null;
  return `/asset/${encodeURIComponent(requestedId)}`;
}

/** Explicit project requests move from library/editor/project routes, never settings. */
export function routeForRequestedProject(pathname: string, requestedId: string | null): string | null {
  if (requestedId === null) return null;
  const current = PROJECT_ROUTE.exec(pathname)?.[1] ?? null;
  if (current === requestedId || (current === null && pathname !== "/home" && assetRouteId(pathname) === null)) return null;
  return `/project/${encodeURIComponent(requestedId)}`;
}

/**
 * A pending request to show an asset, raised by a tool and consumed by the router.
 *
 * A module singleton for the same reason the session is: tool handlers run
 * outside the React tree and cannot call a router hook.
 */
class AssetNavigation {
  #requested: string | null = null;
  #project: string | null = null;
  readonly #listeners = new Set<() => void>();

  /** Asks that the human's view move to this asset. */
  request(assetId: string): void {
    if (this.#requested === assetId) return;
    this.#project = null;
    this.#requested = assetId;
    this.#notify();
  }

  peek(): string | null {
    return this.#requested;
  }

  /** Project and asset requests share one slot: the latest explicit request wins. */
  requestProject(projectId: string): void {
    if (this.#project === projectId) return;
    this.#requested = null;
    this.#project = projectId;
    this.#notify();
  }

  peekProject(): string | null {
    return this.#project;
  }

  clear(): void {
    if (this.#requested === null && this.#project === null) return;
    this.#requested = null;
    this.#project = null;
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
