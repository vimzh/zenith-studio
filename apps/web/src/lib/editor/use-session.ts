"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { session, type EditorSession } from "./session";

/**
 * React bindings for the editor session.
 *
 * Mirrors the shape of `useStoreRevision` / `useStoreSelector` in
 * `lib/pixel/use-document-store.ts`, and for the same reason: the session is
 * mutated from outside the render tree by the WebMCP tool layer, so React
 * subscribes to it rather than owning it.
 */

export function useSessionRevision(): number {
  const subscribe = useCallback((onChange: () => void) => session.subscribe(onChange), []);
  const getRevision = useCallback(() => session.revision, []);
  return useSyncExternalStore(subscribe, getRevision, getRevision);
}

interface SelectorCache<T> {
  revision: number;
  select: (session: EditorSession) => T;
  value: T;
}

/**
 * Reads a derived value out of the session, recomputing only when it changes.
 *
 * The cache is load-bearing: `list()` builds a fresh array every call, so an
 * uncached `getSnapshot` would hand `useSyncExternalStore` a new reference each
 * time and render forever.
 */
export function useSessionSelector<T>(select: (session: EditorSession) => T): T {
  const cache = useRef<SelectorCache<T> | null>(null);
  const subscribe = useCallback((onChange: () => void) => session.subscribe(onChange), []);

  const getSnapshot = useCallback(() => {
    const cached = cache.current;
    if (cached === null || cached.revision !== session.revision || cached.select !== select) {
      cache.current = { revision: session.revision, select, value: select(session) };
    }
    return (cache.current as SelectorCache<T>).value;
  }, [select]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
