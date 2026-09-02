# Phase 15 — Export, polish & engine integration

**Goal.** Assets leave the tool and land in a real game engine without manual fixing.

**Why here.** Last by definition — it depends on everything having a final shape. It is also what converts a demo into something people keep using.

## In scope

**Engine integration**
- `export_for_engine` — Godot (`.tres` / TileSet resource), Unity (sprite meta + slicing), Phaser (atlas JSON), LÖVE (quad table)
- `export_project` — every asset, atlas, and palette in one engine-ready bundle
- `export_palette` — `.gpl` (GIMP/Aseprite), `.pal`, hex list
- Aseprite-compatible JSON for round-tripping into a desktop workflow

**Deferred-feature register** — everything pushed out of earlier phases lands here. Nothing on this list was rejected; each was cut for sequencing, and this is where the debt is paid.

| Feature | Deferred from | Note |
| --- | --- | --- |
| **Layers** — panel, ordering, blend modes, opacity, lock/visibility | [02](./02-canvas-editor.md) | The model already treats a frame as a layer composite ([01](./01-core-data-model.md)), so this is UI plus compositing, not a data migration |
| Line, rectangle, ellipse | [02](./02-canvas-editor.md) | `L` / `U` / `O` |
| Selection: marquee, lasso, magic wand; move, transform | [02](./02-canvas-editor.md) | `M` / `V` |
| Dither brush (two indices + Bayer pattern) | [02](./02-canvas-editor.md) | `D` — the hand-authoring counterpart to `dither_region` |
| Mirror-draw symmetry axis | [02](./02-canvas-editor.md) | `Y` |
| 8×8 guide overlay | [02](./02-canvas-editor.md) | Alignment aid for tile work |
| `read_region`, `get_color_at`, `clear_region` | [03](./03-webmcp-foundation.md) | Token-savers; `read_canvas` and `fill_region` covered them at 32×32 |
| `set_palette` (bulk, with Oklab remap) | [03](./03-webmcp-foundation.md) | `set_palette_color` covered restyling |
| `export_indexed_png` (PNG-8 + `PLTE`) | [03](./03-webmcp-foundation.md) | Grouped with the other export work below |
| `rotate_grid`, `crop_to_content`, `resize_canvas` | [02](./02-canvas-editor.md) | Transform set |

**Editor depth**
- **RotSprite** for arbitrary-angle rotation — naive rotation destroys small sprites. Implement from the published algorithm (Xenowhirl); **do not copy Aseprite's source**, which is under a restrictive EULA ([`../requirements.md` §2](../requirements.md)).
- **Slices with pivots** — named regions carrying a pivot point, for 9-slice UI and weapon/effect attachment points on characters
- **Tool options panel** — per-tool settings (brush size, density, fill-inside, spacing) that swap with the active tool
- `find_color_regions`, `sort_palette`

**Format extension**
- 32-colour mode with 2-character encoding — an explicit trade (double the tokens for more colour freedom), gated per-project

**Quality**
- `check_readability` — contrast and silhouette legibility at 1×
- `find_color_regions`, `sort_palette`
- Performance pass: 200+ assets at 60fps on the infinite canvas
- Accessibility: keyboard navigation throughout, focus management, screen-reader labels on controls
- Error boundaries and graceful degradation everywhere

**Optional: sharing**
- Server persistence and shareable project links. Reopens the `AGENTS.md` SQLite question ([`../idea.md` §12](../idea.md)) — if this lands, server-side storage becomes justified and the deviation ends.

## Out of scope

Nothing — this phase absorbs the remainder.

## Tools introduced

`export_for_engine` · `export_palette` · `check_readability` · `find_color_regions` · `sort_palette` · `rotate_grid` · `crop_to_content` · `resize_canvas` · `draw_line` · `draw_rect` · `draw_ellipse` · `dither_region`

## UI introduced

Layers panel · selection tools · shape tools · dither brush · mirror-draw · export dialog with engine presets

## Exit criteria

- [ ] Exported Godot resource imports with zero manual fixes
- [ ] Phaser atlas loads and animates unmodified
- [ ] `.gpl` palette opens correctly in Aseprite
- [ ] Layers compose correctly and export flattened
- [ ] **Every row of the deferred-feature register above is shipped or explicitly re-deferred with a reason** — the register is the definition of done for this phase
- [ ] 200 assets on the infinite canvas hold 60fps pan/zoom
- [ ] Full keyboard navigation with no mouse
- [ ] 32-colour mode round-trips losslessly through the 2-char encoding
- [ ] `bun run lint`, `typecheck`, `build` clean
- [ ] Every checklist item in [`../requirements.md` §6](../requirements.md) passes

## Risks

| Risk | Mitigation |
| --- | --- |
| Engine formats drift between versions | Pin to a stated version per engine; document which was tested. |
| Layers are a deep change to the phase-01 model | Design the frame as a composite of layers *from the start* in phase 01, even if only one layer exists until here. Retrofitting is far worse. |
| Polish is unbounded | Exit criteria above are the definition of done. Anything else is a new phase. |
