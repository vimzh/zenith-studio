# Phase 10 — Animation authoring

**Goal.** Motion without hand-drawing every frame — ordered cheapest and most deterministic first.

**Why here.** Phase 09 made frames exist and legible. This makes them cheap to produce, and it is where the indexed-grid thesis pays off most surprisingly: **temporal coherence becomes arithmetic instead of a hope about four independent renders.**

## The four authoring paths, cheapest first

**1. Procedural — deterministic, instant, free, perfectly looping.** The underrated one.

| Preset | Implementation |
| --- | --- |
| `bob` | Copy frame, shift 1px down. Two frames, infinite idle. |
| `blink` | Swap two palette indices on the eye pixels for one frame |
| `flicker` | Alternate two palette indices on a region (torches, magic) |
| `pulse` | Cycle a colour ramp through indices |
| `scroll` | Shift with `wrap: true` — water, lava, conveyor belts |
| `sway` | Shift alternating rows by ±1, weighted by height |

An agent authors these with total confidence because they are arithmetic on pixel positions. No model, no latency, no drift.

**2. Interpolation.** `interpolate_frames(from, to, steps)` — generates in-betweens by pixel-position reasoning, not image blending. Blending two pixel grids produces mush; moving pixels produces animation.

**3. Text-driven.** `animate_with_text("4-frame walk cycle")` — generative, conditioned on the base frame and the asset's palette, exiting through the phase-06 pixelisation pipeline.

**4. Skeleton-based.** Deferred to [phase 12](./12-skeletons.md).

## In scope

- All six procedural presets
- `interpolate_frames`
- `animate_with_text` with style conditioning
- **`check_animation_coherence`** — flags off-palette frames, implausible silhouette-area jumps, and broken loops (last frame doesn't lead into the first), each with frame indices
- Animated **GIF and APNG export**; spritesheet export with JSON atlas
- Animation presets in the UI (a "make it bob" button that does the same thing the tool does)

## Out of scope

Skeletons and animation transfer ([12](./12-skeletons.md)) · per-direction animation ([09](./09-rotation-directions.md))

## Tools introduced

`animate_procedural` · `interpolate_frames` · `animate_with_text` · `check_animation_coherence` · `export_animation`

## UI introduced

Animation preset buttons · coherence warnings on the timeline · GIF/APNG export

## Exit criteria

- [ ] `animate_procedural('bob')` produces a perfect two-frame loop with zero model calls, in under 50ms
- [ ] Every procedural preset loops seamlessly — last frame leads into first with no visible pop
- [ ] `interpolate_frames` on a 2-frame walk produces a plausible in-between, no blended half-colours
- [ ] `animate_with_text` output passes `check_palette_compliance` on every frame
- [ ] `check_animation_coherence` catches a deliberately broken loop and names the frame
- [ ] Exported GIF plays correctly at the specified fps in a browser and in Discord
- [ ] Spritesheet atlas JSON loads in Phaser without modification

## Risks

| Risk | Mitigation |
| --- | --- |
| Text-driven animation lacks temporal coherence | Condition every frame on the previous frame *and* the base. Run `check_animation_coherence` automatically and surface failures. Steer agents to procedural first. |
| Interpolation produces mush | Operate on pixel positions and silhouettes, never colour blending. Test against a hand-authored in-between. |
| Procedural presets read as gimmicky | They are genuinely how a lot of real 2D game animation works — idle bobs, torch flicker, water scroll. Say so in the demo. |
