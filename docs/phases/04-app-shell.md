# Phase 04 — App shell: library and editor

**Goal.** The product's two screens: a **library** of assets, and an **editor** for one asset with the agent alongside it.

**Why here.** Structural. Every later phase renders into one of these two screens.

## The shape

**No projects, no workspaces, no file explorer.** An asset is any single pixel-art thing — a grass block, a cobblestone texture, a character sprite, a sword icon, a health bar. They live in one flat library. Type is metadata that unlocks capabilities (a character gets directions and animations; a tile gets seam checking), not a folder.

The reason is scope discipline: the thing being demonstrated is **an agent and a human editing the same canvas.** Hierarchy is scaffolding around that, and scaffolding that has to be built, styled, navigated and explained.

### Screen 1 — Library (`/home`)

```
┌──────────────────────────────────────────────────────────────┐
│  Zenith Studio                              [ + New asset ]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐          │
│   │▚▚▚▚▚▚▚▚│   │  ◓     │   │▞▞▞▞▞▞▞▞│   │   ⬛   │          │
│   │▚▚▚▚▚▚▚▚│   │ ╱│╲    │   │▞▞▞▞▞▞▞▞│   │        │          │
│   └────────┘   └────────┘   └────────┘   └────────┘          │
│   cobblestone   hero        grass        crate               │
│   tile · 32²    character   tile · 32²   item · 16²          │
│                 32² · 4 dir                                  │
└──────────────────────────────────────────────────────────────┘
```

A grid of asset cards. Each renders the asset itself at an integer zoom over the transparency checker, with name, type and size beneath. Click opens the editor.

### Screen 2 — Editor (`/asset/[id]`)

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

**Left rail** — the six tools from [02](./02-canvas-editor.md). **Centre** — the canvas, pan and zoom, with the palette and 3×3 tile preview docked below. **Right** — prompt input and the live tool-call transcript.

The canvas pans and zooms so you can work into a 64×64 at 16×, but it holds **one asset**. There is no unbounded space with assets placed in it, here or later.

## In scope

- Library route with the asset grid; card renders the real asset, not a placeholder
- Editor route `/asset/[id]`; deep-linkable, back to library
- Two-pane editor layout, resizable, agent pane collapsible
- **Status readout** — cursor coordinates, dimensions, zoom, frame. In Geist Mono. **Load-bearing for collaboration:** when the agent says "fixed pixels at (12, 20)", the human has to find (12, 20).
- Empty state on an empty library that creates a first asset
- Command palette (`Ctrl/Cmd+K`) over assets and tools
- Responsive floor: below ~1100px the agent pane becomes a drawer

### Design tokens

| Token | Value | Why |
| --- | --- | --- |
| `--radius` | `2px` | Panels, canvas, containers |
| `--radius-sm/md/lg` | `3px / 4px / 5px` | Buttons, inputs, swatches |
| `--radius-xl`+ | `6px` | The ceiling — the scale stops here |
| `--spacing` | `0.22rem` | Global density knob; every `p-*`, `gap-*`, `size-*` derives from it |
| Borders | `1px` hairline, low contrast | Separation without shadows |
| Icons | lucide @ 16px, 1.5px stroke | 2px reads heavy at this density |

- **Fonts:** `geist` package (`geist/font/sans`, `geist/font/mono`), self-hosted, OFL-1.1
- **Theme:** dark default, light available, switcher in `/settings`
- **Canvas backdrop adjustable** independently of the UI theme, so neither light nor dark sprites are judged against a biased ground

## Out of scope

Projects and the file-explorer tree — **deferred to [14](./14-projects.md)**, which layers grouping over the flat library once the collaboration loop is proven. Persistence is [05](./05-asset-library.md).

## Tools introduced

`list_assets` · `open_asset` · `focus_viewport` (pan/zoom the human's view to a region — the agent can direct attention) · `get_viewport`

## Exit criteria

- [ ] Library renders real asset previews at integer zoom over the checker
- [ ] Clicking an asset opens its editor; the URL is deep-linkable
- [ ] Panes resize; widths survive reload
- [ ] Status readout tracks the cursor in art coordinates and matches what tools report
- [ ] Empty state creates a first asset in one click
- [ ] Layout holds 1280×720 → 2560×1440; agent pane drawers below 1100px
- [ ] No layout shift on load; no element exceeds 6px radius

## Risks

| Risk | Mitigation |
| --- | --- |
| Library becomes a project manager by accretion | Flat list. No folders, no nesting, no hierarchy. Grouping is a filter over `type`, nothing more — real grouping is [14](./14-projects.md) and stays there. |
| Two panes crush the canvas on a laptop | Agent pane collapses to a rail; canvas has flex priority. |
