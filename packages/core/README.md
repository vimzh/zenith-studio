# `@zenith/core`

The pixel document model — [phase 01](../../docs/phases/01-core-data-model.md) of the build plan.

Runtime-agnostic TypeScript with no dependencies. `apps/web` and `apps/api` both import it, so the browser store and the server speak the same model through the same code.

## The format

A frame is an **indexed raster**: a 2D array of palette indices, not RGB. Palettes support 255 colours; generation still defaults to 16. Grids using indices 0–15 retain the compact text format — `0`–`F` for palette indices, `.` for transparent.

```
1111222111122211
1222333112223331
1223333122233331
1122331111223311
```

When any index exceeds 15, grids use an `@hex` header and space-separated two-digit hex tokens. `.` still means transparent. The header distinguishes one-column extended grids from compact rows.

```
@hex
00 0f 10
80 fe .
```

Grids use `Int16Array` in memory to preserve both `-1` and indices through 254. JSON documents with at most 16 colours continue to serialize as version 1; larger palettes use version 2. Both versions remain readable.

## Invariants

Enforced once, at the store boundary, so the human path and the agent path cannot drift apart:

1. Every pixel is a valid palette index or transparent — no unbounded colour.
2. Every pixel is fully opaque or fully transparent — no alpha bleed.
3. Dimensions are immutable except via explicit resize — no grid drift.
4. Rasterisation is integer nearest-neighbour only — no anti-aliasing.
5. All frames of an asset share dimensions and palette — no temporal drift.

Violations are rejected with a message that names what was wrong and what to do instead. Nothing is silently corrected.

## Using it

```ts
import { builtinPalette, createDocument, createStore } from "@zenith/core";

const store = createStore(
  createDocument({ name: "cobble_01", width: 8, height: 8, palette: builtinPalette("gb-dmg") }),
);

// A drag stroke is one undo entry, not one per pixel.
store.transaction("Pencil stroke", () => {
  store.fillRegion({ x: 0, y: 0, width: 8, height: 8 }, 1);
  store.writeRegion(2, 2, "22\n23");
});

store.encode(); // the indexed text grid
store.undo();   // takes the whole stroke back
```

Mutations: `setPixels`, `writeRegion`, `fillRegion`, `bucketFill`, `replaceColor`, `clearRegion`, `shift`, `mirror`. Each returns the number of pixels changed and routes through one `#apply` chokepoint.

Also here: Oklab conversion, a k-means quantiser (needed by palette matching now, by the pixelisation pipeline later), and JSON serialisation whose grids are the same text format.

## Scripts

```sh
bun test        # 98 tests, including the phase exit criteria
bun run typecheck
```

## Not here

Rendering, persistence, animation semantics, and the WebMCP tool surface. The frame array exists, but nothing in this package interprets it as motion.
