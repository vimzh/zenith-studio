# Zenith Studio — product brief

> **Companion docs:** [`requirements.md`](./requirements.md) (hackathon rules) · [`tools.md`](./tools.md) (tool catalog, human + agent). All three must stay in sync — a change to the tool surface changes all three.

**Zenith Studio** — final product name.

---

## 1. One-line pitch

A browser-native pixel-art studio where a human and an AI agent edit the **same live canvas at the same time** — every operation is simultaneously a UI control and a [WebMCP](https://developer.chrome.com/docs/ai/webmcp) tool, so an agent can push pixels with the same precision a human can.

## 2. The problem

AI writes a game faster than anyone can draw the art for it. Code generation is solved enough that **art is the bottleneck** for solo devs, jammers, and hobbyists.

Two failure modes, in opposite directions:

**Image models don't make pixel art. They make pictures of pixel art.**

| Defect | What it means |
| --- | --- |
| **Mixels** | Different "pixels" occupy different physical sizes — no consistent grid |
| **Grid drift** | The lattice isn't axis-aligned or integer-spaced, so downscaling smears |
| **Anti-aliased edges** | Soft gradient borders where pixel art needs hard 1px transitions |
| **Alpha bleed** | Semi-transparent fringe; sprites halo against any background |
| **Unbounded palette** | Thousands of near-identical colours where the target allows 4 or 16 |
| **No tileability** | A "stone texture" whose edges don't seam |
| **No structure** | A flat PNG — no frames, no directions, no palette, no tileset |

A cottage industry of "AI pixel art fixers" exists purely to clean up after this. That's a strong signal the generate-then-repair loop is broken.

**Real editors are human-only.** Aseprite, Piskel, LibreSprite give exact control but expose no surface an agent can reach. "AI assistance" means alt-tabbing to a chat window and pasting images back and forth.

**And a third problem that appears once you're actually shipping a game: drift.** Your hero is 32×32 with a dark outline and 16 colours. Three sessions later the enemy you generated is 48×48, soft-edged, and 40 colours. [Phase 14](./phases/14-projects.md) solves that with a project-level style contract, deterministic conformance, and every asset in the project shown side by side with its violations.

## 3. The insight

> **Constrain the medium hard enough and pixel art becomes a text format an LLM reads and writes losslessly.**

A 32×32 sprite on a 16-colour palette is 1024 cells, each one hex character `0`–`F` plus `.` for transparent — ~1.1 KB. An LLM can read it, reason about it spatially, and write it back exactly. No rasterisation, no downscaling, no anti-aliasing, no grid drift. **Every defect in §2 becomes structurally impossible**, because the agent never renders pixels; it edits a canonical indexed grid the app rasterises.

```
read_canvas →
  size: 16x16   palette: gb-4
  0=#0f380f  1=#306230  2=#8bac0f  3=#9bbc0f  .=transparent
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

The palette cap isn't stylistic — it's what makes the encoding one character per pixel and therefore round-trippable. **The constraint is the product.**

This pays off hardest in **animation**, where it's most counter-intuitive. Ask an image model for a 4-frame walk cycle and you get four unrelated drawings. With indexed grids, an agent can read frame 1, read frame 3, and author frame 2 by reasoning about *which specific pixels move* — or produce a 2-frame idle bob deterministically by copying frame 1 shifted down one pixel. Temporal coherence stops being a hope and becomes arithmetic.

## 4. Competitive landscape

**[PixelLab](https://www.pixellab.ai/) is the closest thing that exists** and is worth studying carefully — mature, well-scoped, and the right feature vocabulary. Their surface: PixFlux/BitForge generation, true inpainting, rotation to 4/8 directions, skeleton animation, animate-with-text, animation-to-animation transfer, tilesets and Wang tiles, isometric tiles, maps, textures, UI elements, outfit transfer, re-pose, colour reduction. Access via web app, Pixelorama, an Aseprite extension, a REST API, and a **remote MCP server**.

We take **feature concepts** from them — rotation, skeleton animation, style references, tileset generation are category conventions, not proprietary inventions. We take no code, no API shapes, no assets, no models.

**[Aseprite](https://www.aseprite.org/) is the incumbent** — the tool this audience actually owns. Timeline with frame tags and ping-pong playback, onion skin, layers and blend modes, tilemap layers, pixel-perfect stroke, RotSprite rotation, custom dither brushes, slices with pivots, symmetry, Tiled Mode, and a Lua scripting API. It is excellent, and we are not trying to replace it — several of our exports exist specifically to round-trip *into* it.

The line between us is extensibility. **Aseprite's extension story is a Lua scripting API: a human writes a script, then runs it.** Ours is a tool surface an agent discovers and drives conversationally, against a canvas the human is simultaneously editing. Those are complementary, not competing — which is why Aseprite JSON is our highest-value interchange export.

Three of their ideas are worth taking outright, and one of them lands better in our model than theirs:

- **Shading Ink.** Instead of painting a flat colour, the brush walks each pixel one step up or down a selected palette ramp. It is the single best shading affordance in pixel art. In RGB you must first find the nearest ramp entry; **in an indexed grid it is literally `index ± 1`** — so it's cheaper for us, and it exposes cleanly as `shade_region(region, 'lighter' | 'darker', steps)`, a tool an agent can apply with total precision. This is the clearest case of the constraint paying off somewhere unexpected.
- **Tiled Mode.** Not a preview beside the canvas — you *draw across the seam* in a 3×3 repeating view. Strictly better than previewing, because you fix the seam while making it rather than after.
- **RotSprite.** A rotation algorithm built to minimise distortion on small sprites, where naive rotation destroys them. Published by Xenowhirl and independently documented, so we implement from the algorithm.

**Licensing caution:** Aseprite is *source-available under a restrictive EULA*, not open source — the GPL fork is LibreSprite. **Do not copy Aseprite source.** Feature concepts are free; their implementation is not. Recorded in [`requirements.md` §2](./requirements.md).

**[Lospec](https://lospec.com/) is the other landmark** — not a competitor but the community's infrastructure: 4,400+ palettes with a public API, 500+ tutorials, a 115k-member Discord, plus utilities (palette quantizer, palette identifier, dither generator, pixel scaler). It is where this audience already lives. We integrate with it rather than around it — fetch palettes by user request with attribution, and match their six palette export formats so our output drops into the tools they already use.

**Where we differ from PixelLab, and why it matters:**

| | PixelLab | Zenith Studio |
| --- | --- | --- |
| Agent access | Remote MCP — agent calls an API, gets **images** back | WebMCP — agent edits the **live document the human is looking at** |
| Agent's view of art | Opaque PNG | **Indexed grid it can read and write pixel-exactly** |
| Editing granularity | Regenerate or inpaint a region | Regenerate, inpaint, **or set a single pixel** |
| Validation | None — regenerate and hope | **Self-verifying:** seam, palette and animation checks that return coordinates, so the agent fixes and re-checks |
| Human's role | Prompt, then accept or retry | Co-editor on the same canvas, sharing the undo stack |
| Dominant operation | Model inference | **Deterministic raster ops**; generation is the minority |

Put plainly: **their MCP server is a vending machine; ours is a shared desk.** An agent driving PixelLab asks for a sprite and receives one. An agent driving Zenith Studio sees what the human just drew, fixes six pixels, checks the tile seam, fails, fixes the seam, re-checks, passes — all against live state, with the human watching and free to take over mid-stroke.

That difference is the entire submission. It's also why our tool catalog looks nothing like theirs despite covering similar features.

## 5. Why WebMCP — and why nothing else works

**a) The artifact is visual, stateful, and iterative.** A remote MCP server shuttles base64 PNGs into a chat transcript. Useless for art: you can't iterate on something you re-upload every turn, and the human loses the canvas. WebMCP puts the agent's hands on the live document. The agent fills a region; pixels change in the human's viewport the same frame.

**b) Page state is implicit context.** Tools are scoped to a page with an asset open, a layer selected, a palette loaded, a frame selected, a marquee active. `fill_region` means *this* region of *this* frame of *this* asset. A remote server would need the agent to carry and re-transmit all of it on every call.

**c) Bidirectional collaboration.** The human hand-draws a lumpy cobblestone and says *"make the mossiest version of this."* The agent calls `read_canvas`, sees the actual pixels, derives a variant. The human then hand-fixes three pixels the agent got wrong. Neither party is subordinate — and it only works because both use the same tools against the same store.

**d) Verifiable output.** Because documents are constrained, we ship *assertion* tools: `check_palette_compliance`, `check_seamless_tiling`, `check_animation_coherence`. The agent verifies and corrects its own work before handing back. An image model cannot do this about its own output.

## 6. Assets and the interface

**An asset is any single pixel-art thing** — a grass block, a cobblestone texture, a character sprite, a sword icon, a health bar. They live in one flat library. Type (`character` · `tile` · `texture` · `item` · `ui`) unlocks capability rather than implying a folder: a tile gets seam checking, a character gets directions and animations. A grass block and a hero are the same kind of object with different capabilities switched on.

```
Asset
├── id, name, type
├── width, height
├── palette          ≤16 colours
├── frames[]         one unless animated
└── directions{}     characters only
```

Projects are additive. A loose asset still works exactly as this flat-library model describes; placing it in a project adds a style contract and a file-explorer location without changing the asset document.

### Two screens

**Library.** A grid of asset cards, each rendering the real asset at integer zoom over the transparency checker, with name, type and size beneath. Click to open.

**Editor.** One asset, with the agent alongside it.

```
┌───────────────────────────────────────┬──────────────────────┐
│  ← cobblestone      32×32  8×  12,20  │  AGENT               │
├───────────────────────────────────────┤                      │
│  ┌─┐                                  │  ┌────────────────┐  │
│  │▚│  ┌──────────────────────┐        │  │ prompt         │  │
│  │▚│  │                      │        │  └────────────────┘  │
│  │▚│  │       canvas         │        │                      │
│  │▚│  │    (pan / zoom)      │        │  read_canvas         │
│  │▚│  │                      │        │  write_region        │
│  │▚│  └──────────────────────┘        │  ✓ seam check        │
│  └─┘                                  │                      │
│  tools          ┌───┐ tile preview    │                      │
│                 └───┘                 │                      │
└───────────────────────────────────────┴──────────────────────┘
```

Left rail holds the six tools; the centre canvas pans and zooms so you can work into a 64×64 at 16×, with palette and 3×3 tile preview docked below; the right pane is the prompt and the live tool-call transcript.

**The status readout is collaboration infrastructure, not chrome.** Cursor coordinates, dimensions, zoom and frame, in Geist Mono. When the agent reports *"fixed pixels at (12, 20)"*, the human has to find (12, 20) — a live coordinate readout plus ruler ticks is what makes an agent's messages actionable rather than abstract.

### Design language

Minimal, dense, sharp-edged, and deliberately quiet. Four principles, each with a functional reason rather than a taste one.

**1. Sharp corners, because the medium is sharp.** Pixel art is hard-edged, grid-aligned, integer-positioned. Soft, blobby chrome contradicts the thing being made. Panels, canvas and containers get **2px radius**; interactive controls stay in the **3–6px** range. Borders — 1px hairlines — do the separating work, not drop shadows. No gradients, no glass, no blur.

**2. The UI must not compete with the artwork.** Functional, not aesthetic: surrounding colour measurably affects colour perception, so saturated or high-contrast chrome makes accurate palette judgement harder. Near-neutral, low-chroma, one restrained accent. Dark by default, since that is how this audience works.

**3. Two greys, and the artwork is the only colour.** The canvas surround is a dark neutral ground; transparent pixels show a two-tone grey checker sized in art-pixel units, so it scales with zoom and doubles as a size reference. The backdrop is adjustable independently of the UI theme, so neither light nor dark sprites are judged against a biased ground.

**4. Density over comfort.** A professional tool used for hours, not a landing page. Compact rows, small controls, a 4px base scale — integer, which is thematically apt and lands everything on whole pixels.

**Type: [Geist](https://vercel.com/font) and Geist Mono** (Vercel, OFL-1.1). Geist Mono is **load-bearing rather than decorative** — the indexed grid from `read_canvas` *is* monospace text, and only reads correctly in a face with consistent advance width, where columns align into the visual shape of the sprite. Same for coordinates, hex values, dimensions, frame counts and the tool transcript.

## 7. Asset types and the constraint system

### Asset types
- **Characters** — multi-direction, multi-animation. The richest type.
- **Tiles / textures** — seamlessness validated, not hoped for. Tilesets and Wang/autotile sets.
- **Items / props** — single-frame, often smaller canvas.
- **UI elements** — buttons, bars, frames, icons.
- **Palettes** — first-class objects, reusable across assets.

### Size and depth

"8-bit vs 64-bit" conflates two independent axes; there's no such thing as 64-bit art. The real axes:

- **Canvas size** (spatial): 8, 16, 32, 48, 64, 128 px.
- **Colour depth** (chromatic): 1-bit = 2 colours, 2-bit = 4, 4-bit = 16, 8-bit = 256.

Presets bind both, modelled on real hardware:

| Preset | Canvas | Palette | Basis |
| --- | --- | --- | --- |
| `gb-4` | 16×16 | 4 shades | Game Boy DMG |
| `nes-sprite` | 16×16 | 3 + transparent, from a 54-colour master | NES PPU sprite limit; SMB Mario is 16×16 |
| `snes-sprite` | 32×32 | 16 | SNES sprite palette; SMW Mario is 32×32 |
| `tile-32` | 32×32 | 16, seam-checked | Modern indie tile standard |
| `modern-64` | 64×64 | 16 | Detailed sprite work |
| `hd-128` | 128×128 | 32 (2-char encoding) | Phase 5+; breaks the 1-char invariant |

**16 colours is the default cap** because it keeps one character per pixel. A 32-colour mode using two characters per cell is a later phase and explicitly a trade: double the tokens, more colour freedom.

### Palettes are sourced, not just invented

Hardware palettes (NES, Game Boy, C64, PICO-8, MSX) are factual data and ship as built-in presets. Beyond those, **[Lospec](https://lospec.com/palette-list) is the community's palette database** — 4,400+ palettes with a public JSON API returning `{name, author, colors[]}`.

We integrate it by **fetching on the user's request with attribution shown**, never by bundling a copy. Lospec states no blanket licence and every artist palette carries a named author, so redistribution isn't ours to assume. Fetch-and-attribute respects that and is also better product: the user picks the palette they actually want out of thousands, rather than the six we chose.

Two of their tools are worth taking as *feature* inspiration: a **palette identifier** (match an image against known palettes) is exactly what the concept-art flow wants — when someone uploads a reference, tell them what it's already close to. And a **dither pattern generator** is a natural companion to `dither_region`.

### What ships out

Pixel art is raster art, so everything meaningful exports as raster. Full matrix in [`tools.md` Part 3](./tools.md); the short version:

- **Universal** — PNG at 1× and integer scales, **indexed PNG-8 with a `PLTE` chunk** (the format that actually matches our data), spritesheet + JSON atlas, GIF/APNG for previews.
- **Engine bundles** — Godot 4, Unity, Phaser 3, LÖVE, GameMaker. The value isn't the PNG; it's **shipping the import settings alongside it** so nobody has to remember them. Forgetting nearest-neighbour filtering is *the* classic way pixel art arrives blurry in an engine, and it's entirely avoidable when we write the `.import` or `.meta` file ourselves.
- **Interchange** — **Aseprite JSON** is the highest-value non-PNG export; nearly every engine already has a loader. Tiled `.tsx`/`.tmj` for tilemaps.
- **Palettes** — `.gpl`, `.pal`, `.ase`, `.hex`, `.txt`, PNG strip. The same six formats Lospec offers, because that's what the ecosystem reads.

And one nobody else can offer:

> **Indexed exports enable runtime palette swapping.** Ship the index map and palette separately, then swap palettes in-engine for enemy variants, team colours, day/night, damage flash. It's how NES and SNES got dozens of enemy variants from one sprite, and it's still the cheapest reskin in 2D games. Most tools *can't* offer it, because by export time they've baked RGB into a PNG and thrown the indices away. Our canonical format **is** the index map — so we ship it, plus GLSL and Godot shader snippets that do the lookup on the GPU.

**SVG is available but is not an engine format.** A sprite in SVG is one `<rect>` per pixel — run-merging cuts a 32×32 from ~700 elements to ~200, still wasteful for a game asset, and engines want raster textures on the GPU anyway. It exists for display and print: web at arbitrary scale, store artwork, stickers, laser cutting, cross-stitch charts.

## 8. Animation

Animation is where the indexed-grid thesis is most differentiated, and it's a first-class citizen rather than a bolt-on.

**Model.** An asset has *animations*; an animation has ordered *frames*; a frame is an indexed grid. All frames of an asset share its palette. A character asset is therefore a grid of `[direction × animation × frame]`.

**Five ways to make an animation**, cheapest and most deterministic first:

1. **Procedural** — the underrated one. Idle bob = copy frame, shift 1px down. Blink = swap two palette indices on 6 pixels for one frame. Flicker, pulse, scroll, wave: all exact, instant, free, and perfectly loopable. An agent can author these with total confidence because they're arithmetic.
2. **Frame-by-frame** — human or agent authors each frame's grid directly. Onion skin in the UI; `read_frames_diff` for the agent, which returns only the pixels that changed between two frames — a perception tool that exists only because the format is indexed.
3. **Text-driven** — *"4-frame walk cycle"*. Generative, conditioned on the base frame and the asset's palette.
4. **Skeleton-based** — pose keypoints per frame and generate the sprite from the pose. Highest control, highest build cost. Skeletons are saveable and reusable across characters.
5. **Animation transfer** — take an existing animation's pose sequence and apply it to a different character. The payoff of skeletons: author a walk cycle once, apply it to every character in the library.

**Coherence is checkable.** `check_animation_coherence` flags frames that drift off-palette, change silhouette area implausibly, or break the loop (last frame doesn't lead back into the first). Again: the agent can self-correct.

## 9. Rotation and directional sprites

Top-down and isometric games need a character drawn facing 4 or 8 ways. Doing that by hand is the single most tedious job in pixel art.

**Parameters** (the vocabulary this category has settled on): `from_view` / `to_view` ∈ `side`, `low top-down`, `high top-down`; `from_direction` / `to_direction` ∈ `north`, `east`, `south`, `west` (cardinal) plus `NE`, `NW`, `SE`, `SW` (ordinal).

**Two strategies, both worth having:**
- **Hub** — generate every direction from one reference. Fast, but quality degrades at 180°.
- **Incremental** — each new direction rotates 45° from the previous, re-referencing as you go. Better fidelity per step, but errors accumulate around the ring.

**And one deterministic shortcut that's free: mirroring.** East and west are a horizontal flip for most characters, as are NE/NW and SE/SW. `derive_direction_by_mirror` costs nothing, is pixel-exact, and yields **8 directions from 5 generations**. Prefer it wherever the design is bilaterally symmetric. This is the kind of win you only get when the agent has deterministic tools alongside generative ones.

Rotation is honestly imperfect — accessories and asymmetric details are where it breaks. The workflow accounts for that: generate, inspect, inpaint the broken region, or flip a good mirror-direction instead.

## 10. Concept art → playable character

The flagship flow. Input is a prompt *or* an uploaded image — a photo, a doodle, real concept art, an existing sprite.

**Deliberately not one black-box tool.** It's a chain of primitives the agent orchestrates, which is exactly what showcases WebMCP leverage:

```
import_reference(image | prompt)
  → pixelize(target_size)            // grid detect → medoid resolve → Oklab quantise → alpha threshold
  → generate_directions(ordinal8)    // with mirror shortcuts where symmetric
  → generate_animation('idle', 2)    // procedural bob
  → generate_animation('walk', 4)    // text-driven or skeleton
  → check_palette_compliance()       // verify, fix, re-verify
  → export_spritesheet()             // + JSON atlas
```

Every step is individually inspectable, individually undoable, and individually overridable by the human. If step 4 produces a bad north-facing sprite, the human fixes it by hand or the agent inpaints it — nothing re-runs from scratch. Compare with a monolithic "make me a character" endpoint, where a bad result means starting over.

The **pixelisation pipeline** deserves its own note, since it's what makes generative input safe:

1. **Classify** the input — already-native, upscaled, soft-edged, or continuous tone — and route accordingly. Below a confidence floor, *preserve* rather than risk wrecking it.
2. **Native-scale check:** `gcd(edge-transition positions, side length)`. O(n) and exact for integer-upscaled art, which is a large share of real input.
3. **Detect cell size and phase.** The crux: reconstruction error alone *always* prefers finer grids, so it can never find the true cell. Pair it with **boundary contrast** — edge strength at predicted boundaries ÷ edge strength everywhere — which punishes over-splitting, because a 1/3 grid puts two-thirds of its boundaries inside flat cell interiors.
4. **Resolve each cell straight to a palette index** — a weighted **medoid** in premultiplied Oklab, restricted to the cell's centre 25%. A medoid returns a colour that *actually exists*, where a mean invents one. Restricting to the core is what removes anti-aliasing, since boundary pixels are blends of neighbours. A continuity rule spares 1px outlines from losing the vote.
5. **Binarise alpha** at 50% coverage — every pixel ends fully opaque or fully transparent.
6. Emit an **indexed grid**, never a PNG.

Two properties matter beyond correctness. **It is deterministic** — no RNG anywhere, so the same input always yields the same indices; otherwise every re-run produces a spurious diff and `read_frames_diff` becomes noise. And **it runs client-side in a Web Worker**, because it is pure TypeScript over a byte array: zero latency, zero cost, and uploaded images never leave the device.

This pipeline is why our generative output is a *game asset* and everyone else's is a *picture*. Full algorithm detail, and the prior art it draws on, in [phase 06](./phases/06-generation-pixelisation.md).

## 11. The collaboration loop (the demo)

The scenario to build toward and film:

1. **Human** creates a new asset from the *Tile* preset — 32×32, 16 colours — and hand-draws a rough cobblestone. Fine, not great.
2. *"Look at my tile and tighten the shading — the highlights are inconsistent."* The agent calls `read_canvas`, sees top-left-lit and top-right-lit stones mixed, and calls `write_region` to fix the offenders. Pixels change live in the human's viewport.
3. *"Make it seamless."* `check_seamless_tiling` → fails on the left/right seam **with exact coordinates** → `write_region` on the edge columns → re-checks → passes. The 3×3 preview confirms it visually.
4. *"Give me a mossy variant and a cracked one, same palette."* Two new assets appear in the library. The human opens one and tweaks five pixels by hand.
5. **Human** uploads a doodle of a frog knight to a new asset. *"Make this a playable character."* The agent pixelises it, generates 4 directions (two mirrored, free and pixel-exact), adds an idle bob procedurally and a 4-frame walk.
6. `check_palette_compliance` catches 2 out-of-palette pixels in walk frame 3 → agent fixes them → passes.
7. **Human** exports: seamless tile PNG, and a character spritesheet plus JSON atlas, dropped straight into a Godot tilemap.

Both halves of the thesis in one story: **precise pixel-level collaboration**, and an agent that **verifies its own work** instead of asking you to eyeball it.

## 12. Architecture

Built on the existing monorepo: **`apps/web`** (Next.js 16 / React 19) → Vercel, **`apps/api`** (Hono) → Google Cloud Run.

```
┌──────────────────────────────────────────────────────────────────────┐
│  apps/web — Vercel                                                   │
│                                                                      │
│  ┌──────────┬────────────────────────────────┬──────────────────┐    │
│  │ Explorer │      Infinite canvas           │  Agent pane      │    │
│  │ tree     │      viewport, placement       │  prompt +        │    │
│  │ palette  │      edit mode                 │  tool transcript │    │
│  └────┬─────┴───────────────┬────────────────┴─────────┬────────┘    │
│       └─────────────────────┼──────────────────────────┘             │
│                             ▼                                        │
│   Asset library ── Palettes ── Frames ── Directions ── Animations    │
│                             │                                        │
│                    Document store                                    │
│              (indexed grids, palettes, frames, undo)                 │
│                    ▲                    ▲                            │
│         ┌──────────┴───────┐   ┌────────┴─────────────┐              │
│         │ WebMCP adapter   │   │ Pixelisation worker  │              │
│         │ document.        │   │ grid detect, medoid, │              │
│         │ modelContext.    │   │ Oklab k-means        │              │
│         │ registerTool()   │   │ (pure TS, no deps)   │              │
│         └──────────┬───────┘   └──────────────────────┘              │
│                    │                                                 │
│   IndexedDB        │                                                 │
└────────────────────┼─────────────────────────────────────────────────┘
                     │                    │
   ChatGPT in-app browser /               │ HTTPS + CORS
   Chrome w/ WebMCP flag /                ▼
   Tool Inspector          ┌──────────────────────────────────────┐
                           │  apps/api — Hono on GCP Cloud Run    │
                           │                                      │
                           │   POST /generate   → OpenAI SDK →    │
                           │                      gpt-image-2     │
                           │   POST /rotate     → direction gen   │
                           │   POST /animate    → frame gen       │
                           │   POST /inpaint    → region regen    │
                           │                                      │
                           │   Secret Manager · rate limiting     │
                           │   min-instances 1 (no cold start)    │
                           └──────────────────────────────────────┘
```

**One store, two front doors.** The human UI and the WebMCP handlers mutate the same state. There is no separate "agent path" — that commitment is what makes the collaboration real rather than staged, and it's why the data model is [phase 01](./phases/01-core-data-model.md) and the tool layer a thin wrapper over it.

**One coordinate space, named explicitly everywhere.** Every raster and perception tool takes asset-local pixel coordinates: origin at the asset's top-left, `x` right, `y` down. Every tool description says so. Workspaces once added a second, signed space for placing assets on an infinite canvas; cutting them ([phase 14](./phases/14-projects.md)) removed what that table called the most likely source of subtle bugs.

**Generative tools are the minority.** Most of the catalog is deterministic raster work. Only generation, rotation, text/skeleton animation, and inpainting cross the network.

### Where each piece runs, and why

| Concern | Where | Reasoning |
| --- | --- | --- |
| UI, canvas, document store, WebMCP tools | **Browser** | WebMCP is page-scoped by definition. The store must be local or every edit costs a round trip. |
| **Pixelisation pipeline** | **Browser (Web Worker)** | It is pure TypeScript over `Uint8ClampedArray` — no WASM, no WebGL, no dependencies ([phase 06](./phases/06-generation-pixelisation.md)). Running it locally means **zero latency, zero cost, and uploaded images never leave the device.** Grid search is the one heavy step, so it goes in a worker to keep the canvas at 60fps. |
| Model calls (generate, rotate, animate, inpaint) | **GCP Cloud Run** | Needs the API key, and these are the only genuinely slow operations. **OpenAI SDK directly** with `gpt-image-2` — its `images.edit` endpoint (image + mask) is what `inpaint_region`, `derive_variant` and `rotate_character` all need. The Vercel AI SDK's strengths are streaming text and React hooks, neither of which applies here. |
| Asset persistence | **IndexedDB** now, Cloud Run + Firestore if sharing lands ([phase 13](./phases/13-export-polish.md)) | No login means no friction for a cold visitor — see below. |

**Why Cloud Run rather than Vercel functions for the backend.** Image generation plus any server-side post-processing runs long enough to sit uncomfortably against serverless execution limits, and Cloud Run gives configurable timeouts, real CPU allocation, and a container that runs Bun natively — so `apps/api` deploys as-is rather than being rewritten as route handlers. It also keeps the AI budget and rate limiting in one place we control.

**The costs of splitting, stated plainly:**

- **Two deployments is two things that can break**, and the hackathon deliverable is one live URL. Mitigation: the app must stay fully usable with the backend down — every deterministic tool, the entire editor, and the whole pixelisation pipeline work offline. Only generation degrades, and it degrades with a readable error.
- **CORS and origin config** between `*.vercel.app` and `*.run.app`. Lock the allowed origin; don't ship `*`.
- **Cold starts.** Set `min-instances: 1` for the judging period. A 4-second cold start in a 3-minute demo video is expensive.
- **GCP is not a hackathon sponsor** (Google Chrome is, separately). Sponsor credits from Vercel, Cloudflare, Render and Netlify don't apply to Cloud Run. A cost consideration, not a rules problem — deployment platform is explicitly free choice.

### Stack decisions

- **Persistence: IndexedDB, client-side.** `AGENTS.md` prefers `bun:sqlite`, but Cloud Run's filesystem is ephemeral too, so a server SQLite file would need a mounted volume or Cloud SQL — infrastructure the prototype doesn't need. Client-side persistence also means **no login**, removing the biggest friction for a judge opening a cold link. Documented deviation; revisit at [phase 13](./phases/13-export-polish.md) if sharing lands, where Firestore is the natural fit.
- **WebMCP binding:** `document.modelContext.registerTool()` — Chrome 150 moved this off `navigator`. A small local hook owns per-tool registration, `AbortSignal` cleanup, legacy-surface detection, and result normalisation.
- **Rendering:** Canvas2D with culling and LOD thumbnails. Budget 200 assets at 60fps; escalate to WebGL only if measurement demands it.
- **Scale discipline:** the current 31-tool catalog registers only what the current view can act on. A flat list measurably degrades agent tool selection. See [`tools.md` Part 5](./tools.md).

## 13. Build plan

**Fourteen ordered phases, detailed in [`phases/`](./phases/README.md).** Each is independently shippable; each unlocks the next. Ordering is by risk and dependency.

| # | Phase | Unlocks |
| --- | --- | --- |
| [01](./phases/01-core-data-model.md) | Core data model & indexed grid | Everything |
| [02](./phases/02-canvas-editor.md) | Canvas editor | A usable tool for humans |
| [03](./phases/03-webmcp-foundation.md) | WebMCP foundation | A usable tool for agents |
| [04](./phases/04-app-shell.md) | App shell — library & editor | The product's shape |
| [05](./phases/05-asset-library.md) | Asset library & persistence | Durable assets |
| [06](./phases/06-generation-pixelisation.md) | Generation & pixelisation | Model input that is real pixel art |
| [07](./phases/07-animation-core.md) | Animation core | Frames, timeline, perception |
| [08](./phases/08-animation-authoring.md) | Animation authoring | Motion without hand-drawing every frame |
| [09](./phases/09-rotation-directions.md) | Rotation & directions | Top-down and isometric games |
| [10](./phases/10-concept-to-character.md) | Concept art → playable character | The flagship flow |
| [11](./phases/11-worlds-tilesets.md) | Worlds, tilesets & textures | Levels, not just sprites |
| [12](./phases/12-skeletons.md) | Skeletons & animation transfer | Reusable motion |
| [13](./phases/13-export-polish.md) | Export, polish & engine integration | Shipping into a real game |
| [14](./phases/14-projects.md) | Projects | Grouping and enforceable style |

**Key ordering decisions.** Data model before UI before agent surface, so the tool layer is never designed twice. Pixelisation before the character pipeline, which merely composes it. Animation before rotation, because animation is the stronger differentiator and mostly deterministic while rotation is the least reliable feature in the category. Skeletons late — highest cost, and phases 07–08 already cover most real animation needs.

**Phase 14 remains additive.** Projects, folders and cross-asset style enforcement sit above the asset model; an asset without project placement remains valid and uses the original library/editor flow.

**Minimum coherent product:** phases 01–05.

## 14. Risks

| Risk | Mitigation |
| --- | --- |
| WebMCP is flagged / origin-trial; a judge may not see it work | The in-app **Agent Console** calls the same handlers directly. The tool layer is provably real without a WebMCP client; the video shows the genuine path. |
| Judges may not run the project at all (per official rules) | Over-invest in the video and written description. Show tool call and pixel change in one frame. |
| Tool-count sprawl degrades agent selection | Context-scoped registration (Part 5 of `tools.md`). Register what the active view can act on, not everything. |
| Generative latency breaks demo pacing | Deterministic tools dominate. Pre-seed example assets. Generation is never on the critical path of the core loop. |
| Rotation quality is imperfect (an honest limitation of the category) | Mirror-derive where symmetric; inpaint to repair; make the failure mode visible and fixable rather than hidden. |
| Feature parity chase with a mature product | We are not trying to match PixelLab's catalog. §4 is the positioning: live shared canvas, pixel-exact agent edits, self-verifying tools. |
| Deviating from `AGENTS.md` SQLite guidance | Documented in §12 with reasoning. |

## 15. Why this can win

Against the four equally weighted criteria:

- **WebMCP Leverage** — 32 tools across context, perception, raster editing, animation, generation, validation and export, all operating on live visual state. A read path lets the agent genuinely *see* the artwork. Self-verification tools let it close its own loop. Registration is context-scoped.
- **Execution** — a real pixel-art editor with the agent switched off, that becomes collaborative when one connects. Animation, directions and engine-ready export make it a tool you could actually ship a game with.
- **Potential Impact** — art is the measurable bottleneck for solo and jam devs, an audience already trying and failing to use AI for exactly this. The specific pain is that image models return pictures of pixel art, not pixel art.
- **Creativity & Ambition** — the thesis generalises well past pixel art: **constrain a medium until it becomes lossless text, and an agent can edit it precisely instead of regenerating it.** Everyone else hands agents a picture and hopes. We hand them a grid.
