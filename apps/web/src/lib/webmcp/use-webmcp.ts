"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { ensureModelContext, modelContextSurface, type ModelContextSurface } from "./adapter";
import { session } from "@/lib/editor";
import { conversation, type ConversationState } from "./conversation";
import { assetNavigation, assetRouteId } from "./navigation";
import { EMPTY_SCOPE, scopeKey, scopeStatus, type ScopeContext, type ScopeStatus } from "./scope";
import { registrationStatus, type RegistrationSummary } from "./status";
import { toolRunnerState, type ToolRunnerSnapshot } from "./runner-state";
import { transcript, type ToolCallRecord } from "./transcript";

/**
 * React bindings for the tool layer.
 *
 * Same shape as the store and session bindings, and for the same reason: both
 * the transcript and the registration status are written from outside the render
 * tree — by agent tool calls that arrive whenever the agent decides to make them.
 */

/** The server render has no transcript; one frozen array keeps hydration stable. */
const NO_RECORDS: readonly ToolCallRecord[] = Object.freeze([]);

const SERVER_SUMMARY: RegistrationSummary = Object.freeze({
  supported: false,
  registered: 0,
  total: 0,
  error: null,
});

export function useRegistrationSummary(): RegistrationSummary {
  const subscribe = useCallback((onChange: () => void) => registrationStatus.subscribe(onChange), []);
  const getSummary = useCallback(() => registrationStatus.summary, []);
  const getServerSummary = useCallback(() => SERVER_SUMMARY, []);
  return useSyncExternalStore(subscribe, getSummary, getServerSummary);
}

export function useTranscript(): readonly ToolCallRecord[] {
  const subscribe = useCallback((onChange: () => void) => transcript.subscribe(onChange), []);
  const getRecords = useCallback(() => transcript.list(), []);
  const getServerRecords = useCallback(() => NO_RECORDS, []);
  return useSyncExternalStore(subscribe, getRecords, getServerRecords);
}

/**
 * Which WebMCP surface is available, re-checked while it might still appear.
 *
 * `document.modelContext` is usually injected by an extension whose content
 * script can land after mount, so a single read on mount reports "unavailable"
 * for a page that is about to work. The poll lives in `subscribe` rather than an
 * effect: the surface is external state that changes on its own, and modelling
 * it as such is what keeps this out of a setState-in-effect cascade.
 *
 * Calling `ensureModelContext` on each tick also installs the alias for a
 * browser that only exposes the older `navigator` binding.
 */
const SURFACE_POLL_MS = 500;
const SURFACE_POLL_ATTEMPTS = 20;

export function useModelContextSurface(): ModelContextSurface {
  const subscribe = useCallback((onChange: () => void) => {
    if (ensureModelContext() !== "none") {
      return () => undefined;
    }
    let attempts = 0;
    const timer = setInterval(() => {
      if (ensureModelContext() !== "none") {
        clearInterval(timer);
        onChange();
      } else if ((attempts += 1) >= SURFACE_POLL_ATTEMPTS) {
        clearInterval(timer);
      }
    }, SURFACE_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  // A string primitive, so the snapshot is stable by value.
  const getSurface = useCallback(() => modelContextSurface(), []);
  const getServerSurface = useCallback((): ModelContextSurface => "none", []);
  return useSyncExternalStore(subscribe, getSurface, getServerSurface);
}

/** The asset a tool has asked the human's view to move to, or null. */
export function useRequestedAsset(): string | null {
  const subscribe = useCallback((onChange: () => void) => assetNavigation.subscribe(onChange), []);
  const getRequested = useCallback(() => assetNavigation.peek(), []);
  const getServerRequested = useCallback((): string | null => null, []);
  return useSyncExternalStore(subscribe, getRequested, getServerRequested);
}

/** The project explicitly requested by an agent; shares the asset navigation queue. */
export function useRequestedProject(): string | null {
  const subscribe = useCallback((onChange: () => void) => assetNavigation.subscribe(onChange), []);
  const getRequested = useCallback(() => assetNavigation.peekProject(), []);
  const getServerRequested = useCallback((): string | null => null, []);
  return useSyncExternalStore(subscribe, getRequested, getServerRequested);
}

/** The Agent Console runner's current tool and arguments. */
export function useToolRunnerState(): ToolRunnerSnapshot {
  const subscribe = useCallback((onChange: () => void) => toolRunnerState.subscribe(onChange), []);
  const getSnapshot = useCallback(() => toolRunnerState.snapshot, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * What the agent's tool list should be scoped to right now.
 *
 * Subscribes to the session and the visible route's store. Navigation can change
 * activeId before the route catches up; that must not unregister and re-register
 * the entire editor surface. runTool separately refuses execution during that
 * mismatch, so stable registration cannot target unseen artwork.
 *
 * The snapshot is a string key rather than an object so `useSyncExternalStore`
 * sees a stable value; the object is rebuilt only when the key changes, which is
 * exactly when scoping could differ.
 */
export function useScopeContext(): ScopeContext {
  const routeAssetId = assetRouteId(usePathname());
  const subscribe = useCallback((onChange: () => void) => {
    let fromStore: (() => void) | null = null;

    const listenToRouteStore = (): void => {
      fromStore?.();
      fromStore = routeAssetId === null ? null : session.get(routeAssetId)?.subscribe(onChange) ?? null;
    };

    listenToRouteStore();
    const fromSession = session.subscribe(() => {
      listenToRouteStore();
      onChange();
    });

    return () => {
      fromStore?.();
      fromSession();
    };
  }, [routeAssetId]);

  const readKey = useCallback(() => scopeKey(readScopeContext(routeAssetId)), [routeAssetId]);
  const readServerKey = useCallback(() => scopeKey(EMPTY_SCOPE), []);
  const key = useSyncExternalStore(subscribe, readKey, readServerKey);

  return useMemo(
    () => (key === scopeKey(EMPTY_SCOPE) ? EMPTY_SCOPE : readScopeContext(routeAssetId)),
    [key, routeAssetId]
  );
}

export function readScopeContext(routeAssetId: string | null): ScopeContext {
  if (routeAssetId === null) return EMPTY_SCOPE;
  const store = session.get(routeAssetId);
  if (store === undefined) return EMPTY_SCOPE;
  return {
    assetId: routeAssetId,
    assetType: session.list().find((asset) => asset.id === routeAssetId)?.type ?? null,
    frameCount: store.frameCount,
  };
}

export function useConversation(): ConversationState {
  const subscribe = useCallback((onChange: () => void) => conversation.subscribe(onChange), []);
  const getState = useCallback(() => conversation.state, []);
  return useSyncExternalStore(subscribe, getState, getState);
}

/** Why the tool surface is empty, when it is — so the UI can say which. */
export function useScopeStatus(): ScopeStatus {
  const pathname = usePathname();
  const routeAssetId = assetRouteId(pathname);

  const subscribe = useCallback((onChange: () => void) => session.subscribe(onChange), []);
  const read = useCallback(
    () => scopeStatus(routeAssetId, session.activeId, session.active !== null),
    [routeAssetId],
  );
  const readServer = useCallback((): ScopeStatus => "library", []);
  return useSyncExternalStore(subscribe, read, readServer);
}
