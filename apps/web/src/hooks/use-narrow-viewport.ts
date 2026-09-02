import * as React from "react"

/** Below this the three-column editor stops fitting and the agent pane becomes a drawer. */
const NARROW_BREAKPOINT = 1100
const NARROW_QUERY = `(max-width: ${NARROW_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mediaQuery = window.matchMedia(NARROW_QUERY)
  mediaQuery.addEventListener("change", onChange)
  return () => mediaQuery.removeEventListener("change", onChange)
}

function getSnapshot() {
  return window.matchMedia(NARROW_QUERY).matches
}

/**
 * True when the viewport is too narrow for the editor's side panels.
 *
 * Server snapshot is `false` so SSR renders the full layout; a narrow client
 * corrects on hydration. Matches the pattern in `use-mobile.ts`.
 */
export function useNarrowViewport() {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}
