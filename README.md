# Zenith Studio

A pixel-art editor where a human and an AI agent draw on the same canvas, at the
same time, through [WebMCP](https://developer.chrome.com/docs/ai/webmcp).

**The idea in one line:** constrain pixel art hard enough and it becomes text a
language model can read and write losslessly — so the agent edits the canonical
grid rather than generating pictures of one.

A 32×32 sprite on a 16-colour palette is 1024 cells, each a single character:
`0`–`9` and `A`–`F` for palette indices, `.` for transparent.

```
................
......2222......
....22333322....
...2333333332...
...2331331332...
...2333333332...
...2333113332...
....23311332....
.....222222.....
......1111......
```

A model can read that, reason about it spatially, and write it back exactly.
There is no rasterisation step to blur it, no downscale to knock it off-grid,
no palette to explode. The defects that make AI "pixel art" unusable —
anti-aliasing, off-grid pixels, four hundred colours, semi-transparent edges —
are not repaired after the fact. They are unrepresentable.

## Status

Deployed to Google Cloud Run:

- Web: https://zenith-web-mif2krwk2q-el.a.run.app
- API: https://zenith-api-mif2krwk2q-el.a.run.app

Pushes to `main` deploy both services through the Cloud Build trigger defined in
`cloudbuild.yaml`.

Run it locally with the instructions below.

## Running it

Requires [Bun](https://bun.com) 1.3.14 or later.

```bash
bun run setup
bun run dev
```

The editor is at http://localhost:3000. Three example assets are seeded on first
visit, so there is something to draw on immediately. No account, no login.

Everything except image generation runs in the browser and works with the API
service down: the whole editor, every deterministic tool, and the entire
pixelisation pipeline.

### Optional: image generation

Generation needs an OpenAI key. Without one the app is fully usable and the
generation tools return a clear "not configured" error rather than failing
obscurely.

```bash
cp apps/api/.env.example apps/api/.env   # then set OPENAI_API_KEY
```

Generation takes **minutes, not seconds** — the model call alone has been
measured between 20 and 157 seconds depending on quality, and pixelising the
result takes about as long again. Concurrent requests are refused rather than
queued, because each one is a paid image.

## Turning on WebMCP

WebMCP is behind a flag. Either of these works:

**Chrome 149 or later**

1. Open `chrome://flags/#enable-webmcp-testing`
2. Set it to **Enabled** and relaunch
3. Open http://localhost:3000 and click any asset

The agent panel's badge tells you what happened: **WebMCP connected** with the
tool count, or **WebMCP unavailable** with what to check. It also names which
binding was found — Chrome 150 moved the API from `navigator.modelContext` to
`document.modelContext`, and both are supported.

**The ChatGPT in-app browser** — open the URL there; tools register on load.

**Neither?** The app is still fully usable. The agent panel has a built-in chat
and a tool runner that call the *same handlers* a WebMCP client would, so the
collaboration works with no WebMCP client present at all.

## How it fits together

```
apps/web    Next.js on Vercel. UI, canvas, document store, WebMCP tools,
            IndexedDB persistence, and the pixelisation pipeline in a worker.
apps/api    Hono on Cloud Run. Model calls only — the one thing that needs a
            key. Rate limited per client and globally.
packages/core   The document model. Pure TypeScript, no DOM, no framework:
            indexed grids, invariants, mutations, undo/redo, Oklab, serialisation.
```

**One store, two front doors.** Human actions and agent tool calls land on the
same mutation, share one undo stack, and appear in one transcript. There is no
separate "agent path" to drift out of sync — which is why `Ctrl+Z` undoes the
agent's work as readily as your own.

Five invariants are enforced at the store boundary rather than per caller:

1. Every pixel is a valid palette index or transparent
2. Every pixel is fully opaque or fully transparent
3. Dimensions are immutable except by explicit resize
4. Rasterisation is integer nearest-neighbour only
5. All frames of an asset share dimensions and palette

Violations are rejected with a message naming what was wrong and what to do
instead — never silently corrected.

## The tool surface

Tools are registered **scoped to the current view** rather than all at once: the
library offers project and file operations, a tile is never offered skeleton tools, and frame
diffing appears only once an asset has a second frame.

External agents can drive the main flow without the built-in chat: image input,
indexed editing, animation, project organization, save checks and complete file
output. Long model calls have pollable jobs with request-ID deduplication;
exports have readable byte chunks instead of requiring download clicks. This is
live-tab WebMCP, not a standalone remote MCP server.

| Group | Tools |
| --- | --- |
| Projects | `list_projects` `create_project` `open_project` `list_project_contents` `create_folder` `move_asset` `rename_project` `import_project` `get_style_profile` `set_style_profile` `add_style_reference` `check_style_consistency` `conform_to_style` |
| Jobs and storage | `start_tool_job` `get_tool_job` `get_storage_status` `flush_storage` |
| Context | `list_assets` `create_asset` `open_asset` `rename_asset` `duplicate_asset` `delete_asset` `describe_asset` |
| Viewport | `get_viewport` `focus_viewport` |
| Perception | `read_canvas` `read_region` `get_palette` `get_color_at` `find_color_regions` `check_readability` |
| Editing | `write_region` `set_pixels` `fill_region` `bucket_fill` `replace_color` `clear_region` `shift` `mirror` `draw_line` `draw_rect` `dither_region` `rotate_grid` `resize_canvas` `crop_to_content` |
| Frames | `list_frames` `add_frame` `select_frame` `delete_frame` `reorder_frames` `set_frame_duration` `read_frame` `get_silhouette` |
| Animation | `read_frames_diff` `read_animation_summary` `check_animation_coherence` `animate_procedural` `animate_with_skeleton` `animate_with_text` `interpolate_frames` |
| Directions | `get_directions` `select_direction` `derive_direction_by_mirror` `rotate_character` `generate_direction_set` |
| History | `undo` `redo` |
| Generation | `generate_asset` `derive_variant` `generate_variation_set` `pixelize` `import_image` `build_character_from_reference` `generate_tileset` `reduce_colors` `remove_background` `extract_palette` `check_grid_alignment` |
| Authoring | `set_palette` `estimate_skeleton` `list_pose_templates` |
| Worlds | `generate_texture` `generate_isometric_tile` `assemble_map` `extend_map` |
| Validation | `check_seamless_tiling` |
| Export | `export_png` `export_animation` `export_for_engine` `export_palette` `export_project` `list_exports` `read_export` `release_export` |

Three of these are worth singling out.

**`read_canvas`** is the read path. Most agent integrations only let a model
*write*; this one lets it see what it is editing, as text, and iterate.

**`read_frames_diff`** returns only the pixels that changed between two frames.
A typical animation frame pair differs by 5–15%, so an agent can reason about
motion for a fraction of the cost of reading either frame — which is only
possible because the format is indexed. You cannot diff two PNGs and get
something a model can act on.

**`check_seamless_tiling`** returns coordinates, not a verdict, so the agent can
fail, fix exactly those pixels, and re-check. The test is not whether opposite
edges match — almost no hand-drawn tile passes that. A seam pairing is
acceptable when the same pairing already occurs inside the tile, so mortar
beside stone at the seam is invisible when mortar sits beside stone throughout.

## Development

```bash
bun run test        # tests across three workspaces
bun run typecheck
bun run lint
bun run build
```

Conventions, performance rules and the invariants live in
[`AGENTS.md`](./AGENTS.md).

## License

Zenith Studio is available under the [MIT License](./LICENSE).
