/**
 * The one place that touches the WebMCP browser API.
 *
 * Chrome 150 moved this off `navigator.modelContext` onto `document.modelContext`
 * and the standard is still origin-trial, so every access is funnelled here: if
 * the API shifts again, one module changes.
 *
 * The registration layer reads `document.modelContext`; this module aliases a
 * navigator-only surface onto it so both browser versions use one path.
 */

/** The subset of the WebMCP surface this app calls. */
interface ModelContext {
  registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<unknown>;
}

export type ModelContextSurface = "document" | "navigator" | "none";

interface DocumentWithModelContext extends Document {
  modelContext?: ModelContext;
}

interface NavigatorWithModelContext extends Navigator {
  modelContext?: ModelContext;
}

function documentSurface(): ModelContext | undefined {
  if (typeof document === "undefined") return undefined;
  return (document as DocumentWithModelContext).modelContext;
}

function navigatorSurface(): ModelContext | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as NavigatorWithModelContext).modelContext;
}

let shimmed = false;

/**
 * Resolves which surface is available, aliasing `navigator` onto `document` when
 * that is the only one present.
 *
 * Idempotent and safe to call during render — it is a feature shim, not state.
 * It has to run before any registration effect, and effects run child-first, so
 * a parent `useEffect` would be too late.
 */
export function ensureModelContext(): ModelContextSurface {
  if (documentSurface() !== undefined) {
    return shimmed ? "navigator" : "document";
  }

  const legacy = navigatorSurface();
  if (legacy === undefined) return "none";

  try {
    Object.defineProperty(document, "modelContext", {
      value: legacy,
      configurable: true,
      writable: true,
    });
    shimmed = true;
    return "navigator";
  } catch {
    // A browser that refuses the alias still has a working navigator surface;
    // we simply cannot route it through the hook.
    return "none";
  }
}

export function modelContextSurface(): ModelContextSurface {
  if (shimmed) return "navigator";
  if (documentSurface() !== undefined) return "document";
  if (navigatorSurface() !== undefined) return "navigator";
  return "none";
}

export function isModelContextAvailable(): boolean {
  return modelContextSurface() !== "none";
}

/** Registers against whichever browser surface {@link ensureModelContext} resolved. */
export function registerModelContextTool(
  tool: unknown,
  signal: AbortSignal,
  onError: (error: unknown) => void
): void {
  ensureModelContext();
  const context = documentSurface();
  if (context === undefined) throw new Error("WebMCP is unavailable in this browser.");
  const pending = context.registerTool(tool, { signal });
  if (pending instanceof Promise) {
    void pending.catch((error: unknown) => {
      if (!signal.aborted) onError(error);
    });
  }
}
