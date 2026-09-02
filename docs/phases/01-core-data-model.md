# Phase 01 — Core data model & indexed grid

**Goal.** A correct, invariant-enforcing pixel document model with undo/redo. No product yet — the substrate everything else stands on.

**Why here.** Every later phase mutates this store. The WebMCP tool layer is a thin wrapper over these same mutations ([`../tools.md` Part 4](../tools.md)), so designing the store twice is the most expensive mistake available.

## In scope

- **Indexed grid** — 2D array of palette indices; `.` sentinel for transparent. Encode/decode to the text format in [`../tools.md` Part 1](../tools.md).
- **Palette** — up to 16 entries, hex + Oklab cached for nearest-colour matching.
- **Document** — dimensions, palette ref, one or more frames, metadata.
- **Invariant enforcement at the store boundary**, not per-caller:
  1. Every pixel is a valid index or transparent
  2. Every pixel fully opaque or fully transparent
  3. Dimensions immutable except via explicit resize
  4. Integer nearest-neighbour rasterisation only
  5. All frames of an asset share dimensions and palette
- **Mutations** — `setPixels`, `writeRegion`, `fillRegion`, `bucketFill`, `replaceColor`, `clearRegion`, `shift`, `mirror`
- **Undo/redo** — single shared stack, one entry per logical operation, coalescing for drag strokes
- **Oklab conversion + k-means quantiser** — needed by palette matching now, by the pixelisation pipeline in [phase 06](./06-generation-pixelisation.md)
- **Serialisation** to/from a plain JSON document format

## Out of scope

Rendering ([02](./02-canvas-editor.md)) · persistence ([05](./05-asset-library.md)) · animation semantics ([07](./07-animation-core.md); the frame *array* exists here, but nothing interprets it as motion)

## Tools introduced

None — this phase has no agent surface. It provides the mutations [phase 03](./03-webmcp-foundation.md) wraps.

## UI introduced

None.

## Exit criteria

- [ ] Round-trip test: grid → text → grid is byte-identical across 1000 random documents
- [ ] Every invariant has a test proving the store *rejects* the violation rather than silently correcting it
- [ ] Undo/redo survives a 500-operation fuzz sequence with no state divergence
- [ ] Oklab quantiser reduces a 4096-colour test image to 16 colours with visibly sensible results
- [ ] `bun run typecheck` passes with no `any` in the store's public surface

## Risks

| Risk | Mitigation |
| --- | --- |
| Invariants enforced per-caller instead of at the boundary, so the agent path drifts from the human path | One `applyMutation` chokepoint. Tests assert direct field access is impossible from outside. |
| Undo granularity wrong (per-pixel during a drag = unusable) | Explicit transaction begin/commit; drag strokes are one entry. |
