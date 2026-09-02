"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import type { DocumentStore } from "@zenith/core";

/**
 * React bindings for the pixel document store.
 *
 * The store is deliberately not React state: the WebMCP tool layer mutates it
 * from outside the render tree, and both front doors have to land in the same
 * place. `useSyncExternalStore` subscribes to it without either side owning it.
 */

/** Subscribes to the store and returns its revision — a new number on every applied change. */
export function useStoreRevision(store: DocumentStore): number {
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  const getRevision = useCallback(() => store.revision, [store]);
  return useSyncExternalStore(subscribe, getRevision, getRevision);
}

interface SelectorCache<T> {
  revision: number;
  select: (store: DocumentStore) => T;
  value: T;
}

/**
 * Reads a derived value out of the store, recomputing only when the store changes.
 *
 * The cache matters: store reads return fresh copies, so an uncached
 * `getSnapshot` would hand `useSyncExternalStore` a new reference every call and
 * render forever.
 */
export function useStoreSelector<T>(store: DocumentStore, select: (store: DocumentStore) => T): T {
  const cache = useRef<SelectorCache<T> | null>(null);
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);

  const getSnapshot = useCallback(() => {
    const cached = cache.current;
    if (cached === null || cached.revision !== store.revision || cached.select !== select) {
      cache.current = { revision: store.revision, select, value: select(store) };
    }
    return (cache.current as SelectorCache<T>).value;
  }, [store, select]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
