import * as React from "react"

function subscribe() {
  return () => {
    // Mount state never changes after hydration, so there is nothing to unsubscribe.
  }
}

/**
 * False during SSR and the first client render, true afterwards. Use it to gate
 * UI whose correct state is only knowable in the browser — e.g. the resolved
 * theme, which next-themes reads from localStorage.
 */
export function useMounted() {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )
}
