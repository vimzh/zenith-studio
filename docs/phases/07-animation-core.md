# Phase 09 — Animation core

**Goal.** Frames, timeline, playback, and the perception tools that make multi-frame work affordable for an agent.

**Why here.** Animation is the strongest differentiator ([`../idea.md` §8](../idea.md)) and mostly deterministic, so it lands before the generation-dependent rotation phase. Structure before authoring: this phase makes frames exist and legible; [phase 08](./08-animation-authoring.md) makes them easy to create.

## The model

Asset → animations → ordered frames. All frames of an asset share dimensions and palette (invariant 5, [phase 01](./01-core-data-model.md)). A character is ultimately `[direction × animation × frame]`.

## In scope

- Animation and frame models; frame ordering, duration, loop flag, fps
- **Timeline panel** — frame strip, add/duplicate/delete/reorder, per-frame duration
- **Onion skin** — previous and next frames ghosted, configurable count and opacity
- **Playback** — play/pause, loop, fps control, scrubbing
- Frame selection drives which grid the phase-02 tools edit
- **Frame strip** — the animation's frames laid out left-to-right beneath the canvas, each a live thumbnail
- **`read_frames_diff`** — the phase's most important tool. Returns only changed pixels between two frames as `[{x, y, from, to}]`, typically 5–15% the size of a full frame read.
- **`read_animation_summary`** — per-frame pixel count, centroid shift, changed-pixel count. Lets an agent understand motion without reading every frame.
- `get_silhouette` — opacity mask as a 1-bit grid; cheap pose and readability check without colour noise

## Out of scope

Authoring helpers ([08](./08-animation-authoring.md)) · skeletons ([12](./12-skeletons.md)) · direction-aware animation ([09](./09-rotation-directions.md))

## Tools introduced

`list_animations` · `create_animation` · `select_animation` · `list_frames` · `add_frame` · `select_frame` · `delete_frame` · `reorder_frames` · `set_frame_duration` · `read_frame` · `read_frames_diff` · `read_animation_summary` · `get_silhouette`

## UI introduced

Timeline · onion skin · playback controls · frame strip on canvas

## Exit criteria

- [ ] A human can hand-author a 4-frame walk cycle and watch it loop
- [ ] Onion skin renders previous and next frames distinguishably
- [ ] `read_frames_diff` returns under 15% of the pixels a full read would for a typical walk frame pair
- [ ] An agent can author frame 2 given frames 1 and 3, using diffs alone, without ever reading a full frame
- [ ] Playback is smooth at 12fps with no dropped frames
- [ ] All frames provably share dimensions and palette; violation is rejected at the store
- [ ] Frame strip stays in sync with the timeline

## Risks

| Risk | Mitigation |
| --- | --- |
| Multi-frame reads blow the agent's context | `read_frames_diff` and `read_animation_summary` are the *default* path; tool descriptions steer to them and warn that full reads are expensive. |
| Timeline and canvas frame strip diverge | Both are views over one store. No local frame state. |
