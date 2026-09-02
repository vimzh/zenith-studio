"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { projects, type ProjectLibrary } from "@/lib/editor";

/**
 * Binds the project tree to React, cached on `projects.revision`.
 *
 * `ProjectLibrary` is the same shape as `DocumentStore` and `EditorSession`: a
 * mutable object that is never replaced. Every read here rebuilds arrays, so an
 * uncached `getSnapshot` hands `useSyncExternalStore` a fresh reference on every
 * call and renders forever. See AGENTS.md — this is the third object in the
 * codebase with that shape, and the trap has fired on the other two.
 *
 * Pass a `useCallback`-stable selector; the cache is keyed on the revision and
 * on the selector identity, so an inline arrow would defeat it.
 */
export function useProjectSelector<T>(select: (library: ProjectLibrary) => T): T {
  const cache = useRef<{ revision: number; select: unknown; value: T } | null>(null);

  const getSnapshot = useCallback(() => {
    const current = cache.current;
    if (current !== null && current.revision === projects.revision && current.select === select) {
      return current.value;
    }
    const value = select(projects);
    cache.current = { revision: projects.revision, select, value };
    return value;
  }, [select]);

  const subscribe = useCallback((onChange: () => void) => projects.subscribe(onChange), []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
