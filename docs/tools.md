# Tools — human surface and agent surface

> **Companion docs:** [`idea.md`](./idea.md) (product brief) · [`requirements.md`](./requirements.md) (hackathon rules). All three must stay in sync — **adding or renaming a tool here means updating both**.

Governing principle: **every capability is exposed twice — once as a UI control, once as a WebMCP tool — and both call the same store mutation.** One store, two front doors. There is no separate "agent path."

Phase tags reference [`phases/`](./phases/README.md) — the 14-phase build plan. A tool tagged **06** ships in [phase 06](./phases/06-generation-pixelisation.md).

---

## Part 1 — The indexed grid format

The core protocol. Everything depends on it. Rationale in [`idea.md` §3](./idea.md).

A frame is an **indexed raster**: a 2D array of palette indices, not RGB. With a palette capped at 16, each pixel serialises to exactly one character.

### Encoding

| Character        | Meaning                            |
| ---------------- | ---------------------------------- |
| `0`–`9`, `A`–`F` | Palette index 0–15 (uppercase hex) |
| `.`              | Transparent                        |

Rows newline-separated, top to bottom, no intra-row delimiters. Row count equals `height`; every row length equals `width`.

### `read_canvas` response

```
asset: cobble_01 (tile)
frame: 1/1   direction: —
size: 16x16
palette: moss-hollow-primary
  0=#2b2b2b  1=#4a4a4a  2=#6e6e6e  3=#8f8f8f
  4=#b5b5b5  5=#3a5a3a  6=#5c8a4a  .=transparent
grid:
1111222111122211
1222333112223331
1223333122233331
1122331111223311
2222222222222222
2111222111122211
...
```

The header is deliberately verbose: it re-establishes page context on every read, so an agent that has drifted knows exactly what it is holding.

### Size budget

| Canvas | Cells | ≈ tokens | 4-frame animation |
| ------ | ----- | -------- | ----------------- |
| 16×16  | 256   | ~90      | ~360              |
| 32×32  | 1,024 | ~330     | ~1,300            |
| 64×64  | 4,096 | ~1,300   | ~5,200            |

Multi-frame reads get expensive fast — hence `read_frames_diff` (§F), which returns only changed pixels, typically 5–15% of a full frame.

**16 colours is the default cap** because it keeps one character per pixel. A 32-colour mode (two chars per cell, [phase 13](./phases/13-export-polish.md)) is an explicit trade: double the tokens for more colour freedom.

### Two coordinate spaces

| Space                 | Used by                          | Origin                                                            |
| --------------------- | -------------------------------- | ----------------------------------------------------------------- |
| **Viewport**          | `focus_viewport`, `get_viewport` | The canvas view; pan and zoom over one asset                      |
| **Asset-local pixel** | every raster and perception tool | Top-left of the asset, `(0,0)` = first pixel, `x` right, `y` down |

**Every tool description names its space explicitly.** This is the most likely source of subtle agent errors.

### Invariants enforced on every mutation, from either front door

1. Every pixel is a valid palette index or transparent. **No unbounded colour.**
2. Every pixel is fully opaque or fully transparent. **No alpha bleed.**
3. Dimensions immutable except via explicit resize. **No grid drift.**
4. Rasterisation is integer nearest-neighbour only. **No anti-aliasing.**
5. All frames of an asset share dimensions and palette. **No temporal drift.**

An agent cannot produce the failure modes in [`idea.md` §2](./idea.md), because the representation cannot express them.

---

## Part 2 — WebMCP tool catalog

### A. Asset library — **05**

**An asset is any single pixel-art thing** — a grass block, a cobblestone texture, a character sprite, a sword icon, a health bar. One flat library; type unlocks capability rather than implying a folder.

| Tool              | Phase | Input                                                                    | Returns                                                                                 |
| ----------------- | ----- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `list_assets`     | 05    | `type?`, `query?`                                                        | Assets: id, name, type, size, frame count, direction count, which is open               |
| `create_asset`    | 05    | `name`, `type` (`character`\|`tile`\|`texture`\|`item`\|`ui`), `preset?` | New asset id; becomes active, and lands in the folder the explorer has selected          |
| `open_asset`      | 05    | `asset_id`                                                               | Opens it in the editor, visible to the human                                            |
| `rename_asset`    | 05    | `asset_id`, `name`                                                       | —                                                                                       |
| `duplicate_asset` | 05    | `asset_id?`, `name`                                                      | New asset id                                                                            |
| `delete_asset`    | 05    | `asset_id`                                                               | Undoable, and removes the asset's placement with it — restoring puts it back in its folder |
| `describe_asset`  | 05    | `asset_id?`                                                              | Metadata plus a natural-language summary — colour usage, coverage, symmetry, silhouette |

`readOnlyHint: true` on all `list_*`, `get_*` and `describe_*`.

### A.1. Projects and style — **14**

| Tool                      | Input                                             | Returns                                                     |
| ------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `list_projects`           | —                                                 | Projects, asset counts, style summary, and which is open    |
| `create_project`          | `name`, `notes?`                                  | New project id; becomes active                              |
| `open_project`            | `project_id`                                      | Opens the project                                           |
| `get_style_profile`       | —                                                 | Exact palette, sizes, art direction, and reference assets   |
| `set_style_profile`       | style fields, `colors?`                           | Updated profile plus the exact ids of newly violating assets |
| `add_style_reference`     | `asset_id?`                                       | Adds a project asset as a generation reference              |
| `check_style_consistency` | —                                                 | Size and colour violations with asset-local coordinates     |
| `conform_to_style`        | `all?`                                            | Deterministic palette remap and crop/pad resize              |

### B. Viewport — **04**

| Tool             | Phase | Input              | Returns                                                                                                           |
| ---------------- | ----- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `focus_viewport` | 04    | region or `{x, y}` | **Pans and zooms the human's view.** When the agent says "I fixed the pixels at (12, 20)," the canvas goes there. |
| `get_viewport`   | 04    | —                  | What the human is currently looking at                                                                            |

### C. Palette shaping — **03 / 06**

| Tool           | Phase | Input                                                        | Returns                                                                                                                                                              |
| -------------- | ----- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outline`      | 06    | `index`, `region?`                                           | 1px border around non-transparent pixels — very common sprite operation                                                                                              |
| `shade_region` | 06    | region, `direction` (`lighter`\|`darker`), `steps?`, `ramp?` | **Walks each pixel along a palette ramp** rather than setting a flat colour — `index ± 1`. The best shading affordance in pixel art, and near-free in indexed space. |
| `define_ramp`  | 06    | `indices: number[]`, `name`                                  | Names an ordered ramp for `shade_region` to walk                                                                                                                     |

### D. Document lifecycle — **03**

| Tool                 | Phase | Input                                                                                               | Returns                                                                            |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `list_documents`     | 03    | —                                                                                                   | Open documents: id, name, size, palette, active flag                               |
| `create_document`    | 03    | `name`, `preset` (`gb-4`\|`nes-sprite`\|`snes-sprite`\|`tile-32`\|`modern-64`), `width?`, `height?` | New document id                                                                    |
| `open_document`      | 03    | `document_id`                                                                                       | Makes it active and visible                                                        |
| `describe_document`  | 06    | `document_id?`                                                                                      | Metadata + natural-language summary — colour usage, coverage, symmetry, silhouette |
| `duplicate_document` | 06    | `document_id?`, `name`                                                                              | New document id                                                                    |

### E. Perception — how the agent sees — **03**

The category that makes the project work. Without it the agent draws blindfolded.

| Tool                 | Phase | Input                                     | Returns                                                                          |
| -------------------- | ----- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| `read_canvas`        | 03    | `document_id?`                            | Full indexed grid + header                                                       |
| `read_region`        | 05    | `x`, `y`, `width`, `height` (asset-local) | Indexed sub-grid                                                                 |
| `get_palette`        | 03    | `document_id?`                            | Index → hex, plus per-index usage count                                          |
| `get_color_at`       | 05    | `x`, `y`                                  | Palette index + hex                                                              |
| `get_silhouette`     | 09    | `document_id?`                            | Opacity mask as a 1-bit grid — cheap pose/readability check without colour noise |
| `find_color_regions` | 15    | `index`                                   | Bounding boxes of contiguous runs                                                |

All read-only.

### F. Raster editing — **03**

| Tool              | Phase | Input                                                                   | Returns                                                                                                                                                              |
| ----------------- | ----- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `write_region`    | 03    | `x`, `y`, `grid`                                                        | Pixels changed; dimension mismatches rejected with a precise message                                                                                                 |
| `set_pixels`      | 03    | `pixels: [{x, y, index}]`                                               | Count written — surgical few-pixel edits                                                                                                                             |
| `fill_region`     | 03    | region, `index`                                                         | Rectangular flood                                                                                                                                                    |
| `bucket_fill`     | 03    | `x`, `y`, `index`, `contiguous?`                                        | Flood-fill the connected same-index region                                                                                                                           |
| `replace_color`   | 03    | `from_index`, `to_index`                                                | Count replaced                                                                                                                                                       |
| `clear_region`    | 05    | region                                                                  | Set transparent                                                                                                                                                      |
| `undo` / `redo`   | 03    | —                                                                       | **Shares the human's undo stack** — the human can undo the agent's work                                                                                              |
| `shift`           | 10    | `dx`, `dy`, `wrap?`                                                     | `wrap: true` tests tile seams and drives procedural bob/scroll                                                                                                       |
| `mirror`          | 11    | `axis`, `region?`                                                       | Also the engine behind `derive_direction_by_mirror`                                                                                                                  |
| `draw_line`       | 15    | `x1`,`y1`,`x2`,`y2`, `index`                                            | Bresenham, pixel-perfect                                                                                                                                             |
| `draw_rect`       | 15    | region, `index`, `filled?`                                              | —                                                                                                                                                                    |
| `draw_ellipse`    | 15    | region, `index`, `filled?`                                              | —                                                                                                                                                                    |
| `shade_region`    | 07    | region, `direction` (`lighter`\|`darker`), `steps?`, `ramp?`            | **Walks each pixel along a palette ramp** rather than setting a flat colour — `index ± 1`. The best shading affordance in pixel art, and near-free in indexed space. |
| `dither_region`   | 15    | region, `index_a`, `index_b`, `pattern` (`checker`\|`bayer2`\|`bayer4`) | Two-tone dither — the standard pixel-art gradient                                                                                                                    |
| `rotate_sprite`   | 15    | `degrees` (arbitrary), `region?`                                        | **RotSprite** — minimises distortion at non-90° angles, where naive rotation destroys small sprites                                                                  |
| `rotate_grid`     | 15    | `degrees` (90/180/270), `region?`                                       | Grid rotation — distinct from character rotation (§H)                                                                                                                |
| `resize_canvas`   | 15    | `width`, `height`, `anchor`                                             | —                                                                                                                                                                    |
| `crop_to_content` | 15    | —                                                                       | Trim transparent margins                                                                                                                                             |

`write_region` is the workhorse. An agent that reads a grid and writes a grid can do anything; the rest save tokens.

### G. Animation — **09 / 10**

Model: asset → animations → ordered frames. All frames share dimensions and palette.

**Structure — 09**

| Tool                 | Input                                                                | Returns                                                                     |
| -------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `list_animations`    | `asset_id?`                                                          | Name, frame count, fps, loop flag                                           |
| `create_animation`   | `name`, `fps?`, `playback?` (`loop`\|`once`\|`reverse`\|`ping-pong`) | New animation id. Ping-pong halves the frames needed for a symmetric cycle. |
| `select_animation`   | `animation_id`                                                       | Active editing target                                                       |
| `list_frames`        | `animation_id?`                                                      | Frame ids, durations, order                                                 |
| `add_frame`          | `copy_from?`, `at_index?`                                            | New frame id                                                                |
| `select_frame`       | `frame_index`                                                        | All §F tools then apply to it                                               |
| `delete_frame`       | `frame_index`                                                        | —                                                                           |
| `reorder_frames`     | `order: number[]`                                                    | —                                                                           |
| `set_frame_duration` | `frame_index`, `ms`                                                  | —                                                                           |

**Perception — 09**

| Tool                     | Input                    | Returns                                                                        |
| ------------------------ | ------------------------ | ------------------------------------------------------------------------------ |
| `read_frame`             | `frame_index`            | Indexed grid for one frame                                                     |
| `read_frames_diff`       | `from_index`, `to_index` | **Only changed pixels**: `[{x, y, from, to}]`. Typically 5–15% of a full read. |
| `read_animation_summary` | `animation_id?`          | Per-frame pixel count, centroid shift, changed-pixel count                     |

`read_frames_diff` is the animation equivalent of `read_canvas` — the tool that makes multi-frame work affordable. It exists only because the format is indexed; you cannot diff two PNGs this way and get something an LLM can reason about.

**Authoring — 10, cheapest first**

| Tool                    | Phase | Input                                                                                    | Returns                                                                                |
| ----------------------- | ----- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `animate_procedural`    | 10    | `preset` (`bob`\|`blink`\|`flicker`\|`pulse`\|`scroll`\|`sway`), `frames?`, `amplitude?` | **Deterministic, instant, free, perfectly looping.** Bob = copy frame, shift 1px down. |
| `interpolate_frames`    | 10    | `from_index`, `to_index`, `steps`                                                        | In-betweens by pixel-position reasoning, not image blending                            |
| `animate_with_text`     | 10    | `description`, `frames`, `base_frame?`                                                   | Generative; conditioned on base frame + project style                                  |
| `animate_with_skeleton` | 12    | `template`, `frames?`                                                                    | **Registered.** Deterministic local flat-sprite rig; no prompt, network, model call, or new colours. Appends one undoable cycle. |
| `transfer_animation`    | 14    | `source_animation_id`, `target_asset_id`                                                 | Applies a pose sequence to another character                                           |

**Export — 10**

| Tool               | Input                                             | Returns                                |
| ------------------ | ------------------------------------------------- | -------------------------------------- |
| `export_animation` | `format` (`gif`\|`apng`\|`spritesheet`), `scale?` | File +, for spritesheets, a JSON atlas |

### H. Rotation and directions — **11**

| Tool                         | Input                                                                                        | Returns                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `get_directions`             | `asset_id?`                                                                                  | Which exist, which are missing, which were mirror-derived                                            |
| `select_direction`           | `direction`                                                                                  | Active editing target                                                                                |
| `rotate_character`           | `from_view`, `from_direction`, `to_view`, `to_direction`, `strategy?` (`hub`\|`incremental`) | Generates the target direction                                                                       |
| `derive_direction_by_mirror` | `from_direction`, `to_direction`                                                             | **Deterministic, free, pixel-exact.** E↔W, NE↔NW, SE↔SW.                                             |
| `generate_direction_set`     | `set` (`side2`\|`cardinal4`\|`ordinal8`), `strategy?`                                        | Orchestrates the ring, **preferring mirroring wherever symmetric — 8 directions from 5 generations** |

**Views:** `side`, `low top-down`, `high top-down`. **Directions:** `north`, `east`, `south`, `west`, `north-east`, `north-west`, `south-east`, `south-west`.

Rotation is honestly imperfect — accessories and asymmetric details break first. Tool descriptions say so and steer the agent to `derive_direction_by_mirror` first, `inpaint_region` to repair second, full regeneration last.

### I. Generation and import — **08 / 12**

The only tools that call a model. All exit through the pixelisation pipeline and **return indexed grids, never PNGs**.

A project's palette is **not** applied at generation time — see [phase 06](./phases/06-generation-pixelisation.md). The contract still holds it, `check_style_consistency` still reports it and `conform_to_style` still applies it exactly; it simply stops narrowing the model's hand while it draws, because a palette stated as a law makes every asset in a project look like the last one. A generative edit may also widen an asset's palette into slots nothing on the canvas is using, so a red berry on a green bush is red rather than the nearest brown.

The image call is the whole wait — measured between 20 and 157 seconds depending on quality. Pixelising its output locally takes about 35ms on a 1024x1024 raster, so a tool description that warns about the pixelisation cost is warning about the wrong thing. Every request carries the cell count of the grid it will land on, so the prompt can bound feature *count* rather than merely asking for chunky art: art composed finer than the grid dissolves into per-pixel noise when resampled, and no amount of style vocabulary prevents it.

| Tool                             | Phase | Input                                                                 | Returns                                                                                                                                                                                                                                                                    |
| -------------------------------- | ----- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generate_asset`                 | 08    | `prompt`, `name?`, `type?`, `preset?`, `size?`, `background?`         | New asset id + grid; `background` defaults by type and supports isolated transparent tiles                                                                                                                                                                                 |
| `draw_from_prompt`               | 08    | `prompt`, `background?`                                               | **Registered. Slow and paid.** The same pipeline pointed at the asset already open: it replaces the current frame's pixels as one undo entry, conformed to that asset's own palette. This is what chat calls when the human asks for a subject on the canvas in front of them, and it is why the model no longer hand-draws sprites a pixel at a time. |
| `derive_variant`                 | 08    | `asset_id?`, `instruction` (_"mossier"_, _"cracked"_)                 | New asset id                                                                                                                                                                                                                                                               |
| `generate_variation_set`         | 08    | `count` (2–6), `brief?`, `creativity?`, `concepts?`                   | 2–6 separate editable assets, each derived from the unchanged source; agents can supply original concept directions                                                                                                                                                        |
| `reduce_colors`                  | 08    | `target_count`                                                        | Oklab k-means, optional Floyd–Steinberg dithering                                                                                                                                                                                                                          |
| `remove_background`              | 08    | `asset_id?`                                                           | Alpha-threshold background isolation                                                                                                                                                                                                                                       |
| `extract_palette`                | 08    | `reference_id`, `count`                                               | Palette pulled from an uploaded image                                                                                                                                                                                                                                      |
| `pixelize`                       | 08    | `reference_id`, `target_size`, `palette?`                             | **The core conversion**                                                                                                                                                                                                                                                    |
| `import_image`                   | 08    | `image` (base64 PNG), `name`, `target_width?`, `max_colors?`, `type?` | **Registered.** Runs the pixelisation pipeline and opens the result as an editable indexed asset. Named `import_image`, not the planned `import_reference`: it does not stage anything, it produces art you can immediately draw on.                                       |
| `build_character_from_reference` | 10    | `image` (base64 PNG), `name`, `direction_set?`, `base_direction?`, `target_width?` | **Registered. Slow and paid.** Extracts the primary subject as clean full-body raster art on transparency, frames it, and produces one inspectable indexed base sprite. Call `generate_direction_set` after inspecting or repairing the base. |
| `inpaint_region`                 | 12    | `x`, `y`, `width`, `height`, `prompt`                                 | **Registered. Slow and paid.** Sends the full indexed source plus a same-size transparent edit mask, pixelises and palette-conforms the result, then transactionally merges only the selected cells; outside pixels remain exact and one undo restores the edit.              |

**The pixelisation pipeline** (behind `pixelize` and every generative tool):

1. **Classify** — native / upscaled / soft / continuous. Below a confidence floor, preserve rather than risk damage.
2. **Native-scale check** — `gcd(transition positions, side length)`, O(n) and exact for integer-upscaled art.
3. **Detect cell size and phase** — reconstruction error paired with **boundary contrast**, since reconstruction alone always prefers finer grids and can never find the true cell.
4. **Resolve each cell straight to a palette index** — weighted medoid in premultiplied Oklab, restricted to the cell core, with a continuity rule that spares 1px outlines.
5. **Binarise alpha** at 50% coverage.
6. Emit an indexed grid.

Runs **client-side in a Web Worker** (pure TS, no dependencies) and is **fully deterministic** — no RNG, so re-runs never produce spurious diffs. Full algorithm detail and prior art: [phase 06](./phases/06-generation-pixelisation.md).

**The concept-art → playable character chain** is not one tool. It is the agent composing:

```
reference image → semantic character extraction → transparent full-body raster → frame → pixelize → generate_direction_set
  → animate_procedural('bob') → animate_with_text('walk', 4)
  → check_palette_compliance → export_spritesheet
```

Every step inspectable, undoable, and overridable. A bad north-facing sprite gets fixed in place; nothing re-runs from scratch.

### J. Skeletons — **14**

| Tool                      | Input                                       | Returns                                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `estimate_skeleton`       | `character_type` (`bipedal`\|`quadrupedal`) | **Registered**, read-only. Keypoints normalised against the content bounds. Limb joints hang off the measured shoulder and hip spread, so they can sit marginally outside 0–1 (about −0.1 to 1.1) on a wide silhouette — the description tells the agent to clamp. |
| `get_skeleton`            | `frame_index?`                              | Keypoint positions                                                                                                                                                                                                                                                 |
| `set_skeleton_pose`       | `frame_index`, `keypoints: [{name, x, y}]`  | Sets the pose                                                                                                                                                                                                                                                      |
| `list_pose_templates`     | —                                           | **Registered**, read-only. Stock pose sequences with their pose counts; pass one to `animate_with_skeleton` for local frame generation.                                                                                                                            |
| `apply_skeleton_template` | `template_id`, `frames?`                    | Inserts a pose sequence                                                                                                                                                                                                                                            |
| `save_skeleton_template`  | `name`                                      | Saves for reuse across characters                                                                                                                                                                                                                                  |
| `animate_with_skeleton`   | `template`, `frames?`                       | **Registered.** Builds a local, indexed, undoable cycle without a prompt or model call.                                                                                                                                    |
| `re_pose`                 | `frame_index`, `keypoints`                  | Regenerates one frame from a new pose                                                                                                                                                                                                                              |

Skeletons are the _reusable_ animation asset: author a walk cycle once, apply it to every character. That reuse is the payoff justifying the build cost, which is why they sit in phase 14 rather than 09.

### K. World building — **13**

| Tool                      | Input                              | Returns                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generate_texture`        | `prompt`, `size`, `seamless?`      | Seam-validated texture                                                                                                                                                                                                                 |
| `generate_tileset`        | `edge_index?`                      | **Registered** for `blob47` only, on the open tile. Pure composition — no model, so every tile shares the source texture and edges meet by construction. `simple16` and `wang` are not built; the tool does not pretend to offer them. |
| `generate_isometric_tile` | `prompt`, `name?`                  | Isolated transparent isometric-projected tile                                                                                                                                                                                         |
| `assemble_map`            | `tileset_id`, `layout: number[][]` | Composed map preview                                                                                                                                                                                                                   |
| `extend_map`              | `map_id`, `direction`, `tiles`     | Grows an existing map, style-matched                                                                                                                                                                                                   |

### L. Palette — **03**

| Tool                | Phase | Input                                              | Returns                                                                                                                                                                                                                |
| ------------------- | ----- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set_palette`       | 13    | `palette` (named) or `colors: [hex]` (2–16)        | **Registered.** Remaps existing pixels to their nearest entry in Oklab, so it is safe on finished art and works when the target palette is smaller. Named palettes are the core hardware sets plus the editor presets. |
| `set_palette_color` | 03    | `index`, `hex`                                     | Recolours every pixel using that index at once — instant global restyle                                                                                                                                                |
| `shift_palette_hue` | 06    | `degrees`, `saturation_delta?`, `lightness_delta?` | Whole-palette shift — the fast way to a "night" or "lava" variant                                                                                                                                                      |
| `generate_ramp`     | 06    | `base_hex`, `steps`, `into_indices`                | Perceptually even shading ramp in Oklab                                                                                                                                                                                |
| `sort_palette`      | 15    | `by` (`luminance`\|`hue`)                          | Reindexes and rewrites grids to match                                                                                                                                                                                  |
| `import_palette`    | 06    | `source` (`lospec:<slug>`\|`hex[]`\|file),         | Fetches from the [Lospec API](https://lospec.com/palettes/api) on request, **displaying `name` and `author` attribution**. Never bundled — see [`requirements.md` §2](./requirements.md).                              |
| `identify_palette`  | 08    | `asset_id?` or `reference_id`                      | Matches the artwork against known palettes and reports the closest — tells a user what their uploaded reference is already near                                                                                        |
| `define_ramp`       | 07    | `indices: number[]`, `name`                        | Names an ordered ramp for `shade_region` to walk                                                                                                                                                                       |

### M. Validation — how the agent checks its own work — **03 / 06 / 08**

Distinctive, cheap to build, and the clearest expression of "WebMCP Leverage."

| Tool                        | Phase | Input                      | Returns                                                                      |
| --------------------------- | ----- | -------------------------- | ---------------------------------------------------------------------------- |
| `check_seamless_tiling`     | 03    | `asset_id?`                | Pass/fail per edge pair **with the mismatching coordinates**                 |
| `check_palette_compliance`  | 06    | `asset_id?`, `max_colors?` | Colours used vs allowed; every out-of-palette pixel located                  |
| `check_animation_coherence` | 08    | `animation_id?`            | Off-palette frames, silhouette-area jumps, broken loops — with frame indices |
| `check_grid_alignment`      | 06    | `asset_id?`                | Detects imported art not on a clean lattice                                  |
| `check_readability`         | 13    | `asset_id?`                | Contrast + silhouette legibility at 1×                                       |

**Every check returns coordinates, not booleans.** That's what closes the loop: fail → fix exactly those pixels → re-check → pass. Demo this in the video.

### N. Export — **03 / 12 / 15**

| Tool                  | Phase | Input                                                                                | Returns                                                                     |
| --------------------- | ----- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `export_png`          | 03    | `asset_id?`, `scale?` (integer)                                                      | Data URL + triggers the human's download UI                                 |
| `export_indexed_png`  | 15    | `asset_id?`                                                                          | True PNG-8 with a `PLTE` chunk — the format that matches our data           |
| `export_animation`    | 10    | `format` (`gif`\|`apng`\|`spritesheet`), `scale?`                                    | Preview formats + spritesheet                                               |
| `export_spritesheet`  | 12    | `asset_ids[]` or whole asset, `columns?`, `layout?` (`by-direction`\|`by-animation`) | Packed sheet + JSON atlas                                                   |
| `export_project`      | 14    | —                                                                                    | Open project's style, hierarchy, placements, and assets as one bundle       |
| `export_for_engine`   | 15    | `engine` (`godot`\|`unity`\|`phaser`\|`love`\|`gamemaker`\|`tiled`)                  | Engine bundle with import settings pre-configured                           |
| `export_palette`      | 15    | `format` (`gpl`\|`pal`\|`ase`\|`hex`\|`txt`\|`png-strip`)                            | The same six formats Lospec offers, because that's what the ecosystem reads |
| `export_indexed_data` | 15    | `asset_id?`                                                                          | Index map + palette as separate JSON — enables runtime palette swapping     |
| `export_svg`          | 15    | `asset_id?`, `merge_runs?`                                                           | Vector, for display and print — **not** for game engines                    |

---

## Part 3 — What ships out

Five tiers. **Everything below phase 15 is raster** — pixel art is raster art, and the whole pipeline exists to keep it exactly on-grid.

### Tier 1 — Universal raster · **03**

| Output                                  | Notes                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **PNG @ 1×**                            | The canonical export. Byte-exact against the indexed grid.                                           |
| **PNG @ 2× / 4× / 8× / 16×**            | Nearest-neighbour, integer only. For store pages, itch.io thumbnails, social.                        |
| **Indexed PNG (PNG-8 + `PLTE`)** _(15)_ | True indexed colour — the format that actually matches our data model. Smaller, and shader-readable. |
| **Spritesheet PNG + JSON atlas**        | Laid out by direction or by animation.                                                               |
| **Animated GIF / APNG**                 | Previews for Discord, itch.io, a README. **Not an engine format** — never ship these as game assets. |

### Tier 2 — Engine bundles · **15**

The value here isn't the PNG — it's **shipping the import settings alongside it**, so nobody has to remember them. Forgetting to set nearest-neighbour filtering is _the_ classic way pixel art arrives blurry in an engine, and it's entirely avoidable.

| Engine        | Bundle                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Godot 4**   | PNG + `.import` with `filter=off`, `mipmaps=off`, `compress/mode=lossless`, `repeat=disabled`. Plus `SpriteFrames` `.tres` for `AnimatedSprite2D`, and a `TileSet` `.tres` for `TileMapLayer`.                          |
| **Unity**     | PNG + `.meta` with `filterMode: 0` (Point), `textureCompression: 0` (None), mipmaps off, `spritePixelsToUnits` = canvas size, and `spriteSheet.sprites[]` slice rects with names and pivots — so it arrives pre-sliced. |
| **Phaser 3**  | PNG + atlas JSON (Hash or Array). For tilemaps, **embed the tileset in the map JSON** — Phaser 3 does not resolve external `.tsx` references.                                                                           |
| **LÖVE**      | PNG + a Lua quad table, with `setFilter("nearest", "nearest")` in the snippet.                                                                                                                                          |
| **GameMaker** | Horizontal PNG strip at the frame size its importer expects.                                                                                                                                                            |

Each bundle ships a two-line README with the import step, because a bundle that needs explanation isn't finished.

### Tier 3 — Interchange · **15**

| Format                                         | Why                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Aseprite JSON** (`json-array` / `json-hash`) | The de-facto pixel-art interchange standard: `frames[]` with `frame`/`duration`, `meta.frameTags` for animations, `meta.layers`, `meta.slices`. Nearly every engine and framework already has a loader. **The single highest-value non-PNG export.** |
| **Tiled `.tsx` / `.tsj` + `.tmx` / `.tmj`**    | The tilemap interchange standard. Tilesets and maps from [phase 11](./phases/11-worlds-tilesets.md) land straight in Tiled or any engine that reads it.                                                                                              |
| **`.aseprite` binary**                         | Round-trip into the desktop tool. Binary format, so it's the most expensive to write — last.                                                                                                                                                         |

### Tier 4 — Palettes · **15**

`.gpl` (GIMP / Aseprite / Krita) · `.pal` (JASC) · `.ase` (Adobe swatch) · `.hex` (plain list) · `.txt` (Paint.NET) · **PNG strip** at 1×/8×/32× — universally importable, and the fallback that always works.

These are exactly the six [Lospec](https://lospec.com/palette-list) offers. Matching them is the point: a palette leaving our tool should drop into whatever the artist already uses.

### Tier 5 — Indexed exports · **15** — _the ones nobody else offers_

Our canonical format is an index map plus a palette. Almost every other tool bakes RGB into a PNG and throws the indices away. Keeping them separate unlocks something real:

**`export_indexed_data`** emits the index map and palette as separate JSON, which enables **runtime palette swapping** — ship the sprite once, swap palettes in-engine for enemy variants, team colours, day/night, damage flash, elemental reskins. It's how NES and SNES games got dozens of enemy variants out of one sprite, and it's still the cheapest reskin technique in 2D games. Most tools _can't_ offer it, because by export time the indices are gone.

Shipped alongside: **palette-swap shader snippets** (GLSL and Godot `.gdshader`) that do the index→colour lookup on the GPU, so it's a working technique out of the box rather than an exercise.

Also here: **`.zenith.json`**, the full project bundle for round-trip and sharing.

### Tier 6 — Display and print · **15**

**This is where SVG belongs — and only here.**

An SVG of a sprite is one `<rect>` per pixel: a 32×32 sprite with ~700 opaque pixels becomes ~700 elements. Merging horizontal runs of the same index into single rects cuts that to roughly 150–250, which is fine for an icon and still wasteful for a game asset. Game engines want raster textures on the GPU; handing them vectors means the runtime rasterises what we already had perfectly rasterised.

So `export_svg` exists, with run-merging on by default, for the cases where it genuinely wins: **infinite-resolution display** on web and print, favicons, store artwork, stickers, laser cutting, embroidery and cross-stitch charts. The tool description says plainly that engine users want Tier 1 or Tier 2.

**PDF** for print sheets and pattern charts sits alongside it.

### What we deliberately don't export

| Not shipping                                              | Why                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Traced/smoothed vectors (Potrace, hqx, xBR, Depixelizing) | That converts pixel art into something else. Legitimate technique, different product. |
| JPEG, WebP lossy                                          | Lossy compression on hard-edged indexed art is destructive by construction.           |
| Video (MP4, WebM)                                         | GIF/APNG already cover preview.                                                       |
| Mipmaps                                                   | Pixel art is drawn at one scale and displayed at integer multiples of it.             |

---

## Part 4 — Human editor surface

The editor must be genuinely usable with the agent switched off — the **Execution** criterion in [`requirements.md` §3.2](./requirements.md). Conventions follow Aseprite/Piskel so the audience already knows the controls.

### Layout — **04**

Two screens. **Library** — a grid of asset cards. **Editor** — tool rail, canvas (pan/zoom), palette and tile preview below, agent pane right. Resizable, persisted, collapsible; drawers below ~1100px. See [`idea.md` §6](./idea.md).

### Toolbar

| Tool                  | Key         | Phase | Behaviour                                                                                                                  |
| --------------------- | ----------- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| Pencil                | `B`         | 02    | Single-pixel paint. **Pixel-perfect mode on by default** — suppresses the L-shaped double-pixels freehand strokes produce. |
| Eraser                | `E`         | 02    | Paint transparent                                                                                                          |
| Bucket                | `G`         | 02    | Flood-fill contiguous same-index region                                                                                    |
| Eyedropper            | `I`         | 02    | Pick index under cursor; `Alt` from any tool                                                                               |
| Pan                   | `Space`     | 02    | Drag canvas                                                                                                                |
| Zoom                  | `+`/`-`     | 02    | **Integer steps only** — 1×, 2×, 4×, 8×, 16×. Fractional zoom is what makes pixel art look wrong on screen.                |
| Select / Move         | `M`/`V`     | 13    | Rectangular marquee within the asset                                                                                       |
| Line / Rect / Ellipse | `L`/`U`/`O` | 13    | —                                                                                                                          |
| Dither brush          | `D`         | 13    | Two indices + Bayer pattern                                                                                                |
| Mirror-draw           | `Y`         | 13    | Symmetry axis — large time-saver for characters                                                                            |

### Panels

| Panel            | Phase | Purpose                                                                                                                                                                        |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canvas           | 02    | Checkerboard transparency, 1px grid toggle, 8×8 guide toggle                                                                                                                   |
| Palette          | 02    | 16 swatches, click to select, right-click to edit hex, preset dropdown, usage counts                                                                                           |
| Tile preview     | 02    | Canvas repeated 3×3, live — seams visible while drawing                                                                                                                        |
| Agent Console    | 03    | Live tool-call transcript. Makes collaboration legible **and** is the demo fallback if WebMCP is unavailable in a judge's browser ([`requirements.md` §4](./requirements.md)). |
| Library grid     | 04    | Asset cards rendering the real asset at integer zoom                                                                                                                           |
| Command palette  | 04    | `Ctrl/Cmd+K` over assets and tools                                                                                                                                             |
| Save indicator   | 05    | Autosave state, plus asset import/export                                                                                                                                       |
| Timeline         | 07    | Frame strip, onion skin, playback, per-frame duration                                                                                                                          |
| Direction picker | 09    | Compass rosette: existing, missing, mirror-derived                                                                                                                             |
| Reference tray   | 10    | Uploaded concept art staged before pixelisation, live before/after                                                                                                             |
| Skeleton editor  | 12    | Draggable keypoints overlaid on the canvas                                                                                                                                     |
| Layers           | 13    | —                                                                                                                                                                              |

### Shortcuts

`Ctrl/Cmd+Z` undo · `Ctrl/Cmd+Shift+Z` redo · `Ctrl/Cmd+S` export · `Ctrl/Cmd+K` command palette · `[`/`]` cycle palette index · `,`/`.` previous/next frame · `Tab` toggle Agent pane · `Esc` exit edit mode · `Space+E` edit skeleton

**The agent shares the human's undo stack.** If the agent makes a mess, `Ctrl+Z` fixes it. A small detail that does a lot of work for trust — worth one sentence of demo narration.

---

## Part 5 — Implementation notes

### Registration

Chrome 150 moved this API from `navigator.modelContext` to `document.modelContext`. Feature-detect both, prefer `document`:

```ts
const mc =
  (typeof document !== "undefined" && "modelContext" in document
    ? (document as any).modelContext
    : undefined) ??
  (typeof navigator !== "undefined" && "modelContext" in navigator
    ? (navigator as any).modelContext
    : undefined);
```

Register per tool with an `AbortSignal` tied to component lifetime, so unmounting unregisters and no ghost tools linger:

```ts
useEffect(() => {
  const controller = new AbortController();
  mc?.registerTool(
    {
      name: "bucket_fill",
      description:
        "Flood-fill the contiguous region of same-coloured pixels starting at (x, y) with a palette index, in the currently selected frame of the open asset. Coordinates are 0-indexed from the top-left. Call read_canvas first to see current pixels.",
      inputSchema: {
        type: "object",
        properties: {
          x: {
            type: "number",
            description: "Column, 0-indexed from the left.",
          },
          y: { type: "number", description: "Row, 0-indexed from the top." },
          index: {
            type: "number",
            minimum: 0,
            maximum: 15,
            description: "Palette index to fill with.",
          },
        },
        required: ["x", "y", "index"],
      },
      execute: async ({ x, y, index }) => {
        const changed = store.bucketFill(x, y, index);
        return `Filled ${changed} pixels with index ${index} starting at (${x}, ${y}).`;
      },
    },
    { signal: controller.signal },
  );
  return () => controller.abort();
}, []);
```

The local registration hook wraps this surface, owns `AbortSignal` cleanup, and normalises returns: a string becomes `{ content: [{ type: 'text', text }] }`; a thrown error becomes `{ content: [...], isError: true }`.

### Rules for tool handlers

1. **Return text an agent can act on.** `"Filled 34 pixels with index 3."` beats `"OK"`. On failure, say what was wrong _and what to do_: `"Rejected: grid has 8 rows but frame height is 16. Provide 16 rows, or use write_region with an explicit y offset."`
2. **Never throw raw exceptions.** Catch and return a structured, readable failure.
3. **Mark read-only tools** with `annotations: { readOnlyHint: true }`.
4. **Validate against the Part 1 invariants in the store**, not per-tool — one enforcement point for both front doors.
5. **Descriptions carry page state.** _"in the currently selected frame of the open asset"_ is what makes implicit context work.
6. **Every agent mutation is one undo entry** on the shared stack.
7. **Every agent mutation renders immediately.** The whole point is that the human watches it happen.
8. **Be specific.** Name units, coordinate origin, and valid ranges. Agents reward clarity over brevity.
9. **Say what's slow.** Generative tool descriptions should note they take seconds, so an agent prefers deterministic tools when they suffice — `derive_direction_by_mirror` over `rotate_character`, `animate_procedural` over `animate_with_text`.

### Coordinate convention

Origin top-left; `(0, 0)` is the first pixel. `x` increases right, `y` increases down. **State this in every positional tool's description** — do not assume the agent infers it.

---

## Part 6 — Managing tool count

At full build this is ~70 tools. A flat list that large measurably degrades agent tool selection. Three mitigations, in order of importance:

**1. Context-scoped registration.** Register only what the current view can act on. Skeleton tools register only when the skeleton editor is open. Animation tools register only for an asset that has animations. Direction tools register only for character assets. This falls out naturally from the per-component `AbortSignal` pattern — tools live and die with the UI that owns them.

**2. Stable core, dynamic periphery.** A ~20-tool core (perception, raster editing, palette, project context, export) is always registered so an agent always has a floor of capability. Everything else appears with its surface. Fire `toolchange` so clients re-read the list.

**3. Naming that groups.** Consistent prefixes — `read_*`, `check_*`, `generate_*`, `export_*`, `animate_*` — let an agent pattern-match a family rather than scan 70 unrelated names.

**Anti-pattern to avoid:** one mega-tool with a `mode` enum. It hides the schema from the agent, defeats input validation, and makes failures unattributable. Keep tools granular; manage the count with scoping.

---

## Part 7 — Testing

- **Chrome 149+** with `chrome://flags/#enable-webmcp-testing` enabled
- **Model Context Tool Inspector** extension — lists registered tools and invokes them manually; fastest loop for verifying schemas
- **ChatGPT in-app browser**, against the deployed URL — verify _before_ submitting
- **Agent Console** — exercises handler logic with no WebMCP client at all
- **Scoping check:** open each view and confirm the registered tool list shrinks and grows as expected, with no ghosts after navigation
