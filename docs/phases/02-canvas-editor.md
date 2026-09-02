# Phase 02 — Canvas editor

**Goal.** A pixel-art editor a human would actually use, standing alone with no agent involved.

**Why here.** The **Execution** criterion ([`../requirements.md` §3.2](../requirements.md)) is where PoC submissions lose. The editor must be real before the agent makes it interesting. It also gives phase 03 something visible to prove tools against.

## In scope

**The irreducible set — nothing here is optional, nothing not here belongs yet.**

A pixel-art editor is usable with six tools. Anything beyond them is convenience, and convenience is what we defer.

- **Canvas rendering** — nearest-neighbour, integer zoom only (1×, 2×, 4×, 8×, 16×). Fractional zoom is what makes pixel art look wrong on screen.
- **Six tools** — pencil (pixel-perfect mode on by default, suppressing the L-shaped double-pixels freehand strokes produce), eraser, bucket, eyedropper, pan, zoom
- **Undo / redo** — one shared stack
- **Palette panel** — 16 swatches, click to select, right-click to edit hex, preset dropdown
- **Presets** — `gb-4`, `nes-sprite`, `snes-sprite`, `tile-32`, `modern-64` ([`../idea.md` §7](../idea.md))
- **Overlays** — checkerboard transparency, 1px grid toggle. Both are render flags, effectively free.
- **3×3 tile preview** — a read-only strip beside the canvas so seams are visible while drawing. Cheap. (Drawing *across* the seam is Tiled Mode, deferred to [11](./11-worlds-tilesets.md) — genuinely more work.)
- **PNG export** at 1× and integer scales

## Out of scope — deliberately

Every one of these is a real feature we want eventually. None is needed to draw a sprite.

| Deferred | To | Why it can wait |
| --- | --- | --- |
| Line, rect, ellipse | [13](./13-export-polish.md) | Pencil draws them. Slower, not blocking. |
| Selection / marquee / move | [13](./13-export-polish.md) | Nothing in the core loop needs it. |
| Dither brush | [13](./13-export-polish.md) | `dither_region` covers the agent path; hand-dithering is niche. |
| Mirror-draw symmetry | [13](./13-export-polish.md) | A time-saver, not a capability. |
| Tiled Mode (drawing across the seam) | [11](./11-worlds-tilesets.md) | The 3×3 preview surfaces the problem; this only speeds the fix. |
| Layers | [13](./13-export-polish.md) | Single flat raster is enough for a 32×32 sprite. *(Model the frame as a layer composite in [01](./01-core-data-model.md) anyway — retrofitting is far worse than carrying an unused abstraction.)* |
| 8×8 guide overlay | [13](./13-export-polish.md) | Nice; not load-bearing. |
| Infinite canvas | [04](./04-app-shell.md) | This phase is one document, one viewport. |
| Timeline | [07](./07-animation-core.md) | — |

## Tools introduced

None yet — but every action here must route through a phase-01 store mutation, so phase 03 can expose it without refactoring.

## UI introduced

Canvas · toolbar · palette panel · tile preview · document tabs

## Exit criteria

- [ ] A person can draw a recognisable 32×32 sprite start to finish without touching code
- [ ] Pixel-perfect mode produces no double-pixels on a fast diagonal drag
- [ ] Zoom never renders a fractional pixel; no blur at any level
- [ ] 3×3 tile preview updates within one frame of a pixel change
- [ ] Exported PNG at 1× is byte-exact against the indexed grid
- [ ] No dead controls; no console errors during a five-minute drawing session
- [ ] Every deferred tool above is genuinely absent, not stubbed — no disabled buttons hinting at features that don't exist

## Risks

| Risk | Mitigation |
| --- | --- |
| Canvas perf poor at 16× on 64×64 | Render to an offscreen canvas at 1×, scale with `image-rendering: pixelated`. Never draw per-pixel rects. |
| Tool actions bypass the store for speed | Code review gate: no direct grid writes outside `applyMutation`. |
