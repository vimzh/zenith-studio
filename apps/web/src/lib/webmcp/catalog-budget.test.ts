/** Bound discovery payloads, not tool counts: schemas and page metadata also consume the browser budget. */
import { expect, test } from "bun:test";
import { EMPTY_SCOPE, type ScopeContext } from "./scope";
import { toolsForContext } from "./tools";

// A regression budget below the observed rejected payload, not a claimed browser API limit.
const MAX_CATALOG_BYTES = 62 * 1024;
const ORIGINS = ["http://localhost:3000", "https://zenith-web-mif2krwk2q-el.a.run.app"];
const views: ScopeContext[] = [EMPTY_SCOPE];
for (const assetType of ["character", "tile", "texture", "tileset", "item", "ui"]) {
  for (const frameCount of [1, 4]) views.push({ assetId: "asset_032", assetType, frameCount });
}

for (const origin of ORIGINS) for (const view of views) {
  test(`WebMCP discovery fits its byte budget on ${origin} for ${view.assetType ?? "library"} with ${String(view.frameCount)} frames`, () => {
    const pageUrl = `${origin}${view.assetId === null ? "/home" : `/asset/${view.assetId}`}`;
    // Exactly the serializable fields RegisteredTool sends, plus discovery's
    // per-tool origin/pageUrl. Functions, example, network and scope are not sent.
    const tools = toolsForContext(view).map((definition) => ({
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: { readOnlyHint: definition.readOnly === true },
      origin,
      pageUrl,
    }));
    const bytes = new TextEncoder().encode(JSON.stringify({ tools })).byteLength;
    expect(bytes).toBeLessThanOrEqual(MAX_CATALOG_BYTES);
  });
}
