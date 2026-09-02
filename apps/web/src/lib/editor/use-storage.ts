"use client";

import { useCallback, useSyncExternalStore } from "react";
import { assetStorage, type StorageState } from "./storage";

/**
 * Persistence state, for the save indicator and the unavailable warning.
 *
 * Server snapshot is `"unknown"` so SSR never claims storage works before the
 * browser has been asked.
 */
export function useStorageState(): StorageState {
  const subscribe = useCallback((onChange: () => void) => assetStorage.subscribe(onChange), []);
  return useSyncExternalStore(
    subscribe,
    () => assetStorage.state,
    () => "unknown" as StorageState
  );
}
