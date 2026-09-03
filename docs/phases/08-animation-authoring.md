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

**3. Text-driven.** `animate_with_text("a quick jab", effects: "a white air-cut streak")` — generative. A cheap vision call reads the source sprite and plans the poses like an animator (anticipation, extreme, follow-through, recovery, with a hold per frame, ground contact, and where each requested effect sits), then **every frame is drawn as one sprite sheet beside the source cell**, so all frames share its scale, camera and ground line. The sheet is cut into cells, grounded frames are snapped back onto the source's ground line, and each cell exits through the phase-06 pixelisation pipeline into the asset's palette — effect colours the palette lacks take its free slots, and a full palette folds its closest near-duplicate pair to make room. A vision judge then checks identity, scale, facing, stage, clipping and effects per frame, and one repair sheet redraws what it rejects. One paid image per sheet rather than one per frame, with a cycle's sheets bought concurrently; the two chat calls run at low reasoning, measured to keep their quality at a third of the time. New frames use 250ms holds (4fps). The last verified independent-pose repair retained the full generated canvas instead of fitting each silhouette, and validated composed instructions before buying images. It removed edge contact but did not eliminate ground-position drift. A concurrent sprite-sheet replacement is under integration; see [gaps](../gaps.md) for the distinction between that working tree and the tested build.

**4. Skeleton-based.** Deferred to [phase 12](./12-skeletons.md).

## In scope

- All six procedural presets
- `interpolate_frames`
- `animate_with_text` with style conditioning
- **`check_animation_coherence`** — flags off-palette frames, implausible silhouette-area jumps, duplicate first/last loop poses, and character canvas-edge contacts, each with frame indices. Edge contact is a warning, not proof of clipping. These mechanical checks cannot certify anatomy, foot contact, registration or smooth motion; playback review is required.
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
| Text-driven animation lacks temporal coherence | Draw the whole cycle as **one sheet** beside the source, never as N independent renders — N renders cannot share a camera, and measured on a five-frame swing they did not (body size, ground line and framing all drifted while every check passed). Snap grounded frames to the source's ground line. Run `check_animation_coherence` automatically and surface failures. Steer agents to procedural and skeleton paths first. |
| Interpolation produces mush | Operate on pixel positions and silhouettes, never colour blending. Test against a hand-authored in-between. |
| Procedural presets read as gimmicky | They are genuinely how a lot of real 2D game animation works — idle bobs, torch flicker, water scroll. Say so in the demo. |
