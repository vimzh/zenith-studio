# Phase 13 — Worlds, tilesets & textures

**Goal.** Levels, not just sprites. Seamless textures, autotile sets, isometric tiles, and assembled maps.

**Why here.** Broad but shallow — it composes the phase-08 pipeline and phase-07 style enforcement without inventing much. Characters carry the demo, so world building follows them.

## In scope

**Textures**
- `generate_texture` with mandatory seam validation. `check_seamless_tiling` returns the mismatching coordinates, so the agent fixes edges and re-checks rather than regenerating.
- **Tiled Mode** — the canvas rendered as a 3×3 repeat you **draw directly into**, editing across the seam rather than previewing beside it. Strictly better than the phase-02 preview: you fix the seam while making it, not after. (Taken from Aseprite; deferred to here because the preview already surfaces the problem and this only speeds the fix.)

**Tilesets**
- `generate_tileset` from one base tile, producing:
  - `simple16` — 16-tile blob set, the common indie case
  - `wang` — edge-matched Wang tiles
  - `blob47` — full 47-tile autotile set, the complete solution
- Derivation is largely deterministic: corner and edge variants are compositions of the base tile plus masks, not 47 independent generations. Generation fills only what composition can't.

**Isometric**
- `generate_isometric_tile` honouring the asset's `projection` setting
- Isometric grid overlay and snapping on canvas

**Maps**
- `assemble_map` — compose a tileset into a layout, previewed on canvas
- `extend_map` — grow an existing map in a direction, style-matched
- `world` asset type holding a tileset reference plus a layout
- **Tilemap layers** (from Aseprite 1.3): a layer whose cells are *references* to tiles in a tileset, not raw pixels. Edit the tile once and every instance updates — the single biggest time-saver in tile work, and it makes an agent's "make all the grass darker" a one-tile edit instead of a hundred.

## Out of scope

Full level-editor semantics — collision, entities, layers of gameplay data. This produces *art* for a level, not the level.

## Tools introduced

`generate_texture` · `generate_tileset` · `generate_isometric_tile` · `assemble_map` · `extend_map`

## UI introduced

Tileset grid view · 3×3 tile preview as a canvas object · isometric grid overlay · map assembly canvas

## Exit criteria

- [ ] `generate_texture` output passes `check_seamless_tiling` with zero mismatches
- [ ] Tiled Mode accepts strokes crossing the seam and wraps them correctly
- [ ] `blob47` produces a complete set where every adjacency combination has a tile
- [ ] Composition-derived tiles are pixel-exact against the base, not regenerated approximations
- [ ] An assembled 20×20 map renders with no visible seams
- [ ] Isometric tiles align on the isometric grid with no gaps
- [ ] A tileset exports in a form Tiled or Godot's TileMap imports directly
- [ ] Editing one tile updates every instance placed on a tilemap layer
- [ ] Every tile in a set passes `check_palette_compliance`

## Risks

| Risk | Mitigation |
| --- | --- |
| 47-tile generation is expensive and inconsistent | Derive by composition and masking wherever possible; generate only what composition cannot produce. Cheaper *and* more consistent. |
| Seam validation passes but tiles look wrong when repeated | Validate edges *and* show the 3×3 preview. Some artifacts are only visible at scale. |
| Isometric projection interacts badly with the square grid model | Isometric is a *rendering and generation* concern; the underlying grid stays square. Do not fork the data model. |
