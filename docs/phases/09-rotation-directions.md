# Phase 11 — Rotation & directions

**Goal.** A character drawn facing 4 or 8 ways — the most tedious job in pixel art, and the one top-down and isometric games can't avoid.

**Why here.** Depends on generation quality ([06](./06-generation-pixelisation.md)) and is honestly the least reliable feature in this category, so it follows the deterministic wins rather than preceding them. [Phase 12](./10-concept-to-character.md) composes it.

## The vocabulary

**Views:** `side` · `low top-down` · `high top-down`
**Directions:** `north` `east` `south` `west` (cardinal) · `north-east` `north-west` `south-east` `south-west` (ordinal)
**Sets:** `side2` · `cardinal4` · `ordinal8`

Rotation takes `from_view`, `from_direction`, `to_view`, `to_direction`.

## Two generative strategies, plus one free one

- **Hub** — every direction from one reference. Fast; quality degrades at 180°.
- **Incremental** — each direction rotates 45° from the previous, re-referencing as it goes. Better per-step fidelity; errors accumulate around the ring.
- **Mirror — deterministic, free, pixel-exact.** E↔W, NE↔NW, SE↔SW are horizontal flips for bilaterally symmetric characters. **Eight directions from five generations.**

`generate_direction_set` orchestrates the ring and **prefers mirroring wherever the design allows it.** This is the pattern worth repeating across the product: give the agent a deterministic tool alongside the generative one, and describe when to prefer it.

## In scope

- Direction model on character assets; per-direction frames and animations
- `rotate_character` with both strategies
- `derive_direction_by_mirror`
- `generate_direction_set` with mirror preference
- **Direction picker** — compass rosette showing which directions exist, which are missing, which were mirror-derived
- **Direction ring on canvas** — the eight directions arranged in a circle via phase-05 `arrange_assets('ring')`. Rotational inconsistency becomes visible at a glance.
- Repair path: `inpaint_region` on a broken direction rather than full regeneration

## Out of scope

Isometric projection specifics ([11](./11-worlds-tilesets.md)) · skeleton-driven turning ([12](./12-skeletons.md))

## Tools introduced

`get_directions` · `select_direction` · `rotate_character` · `derive_direction_by_mirror` · `generate_direction_set`

## UI introduced

Direction picker rosette · direction ring layout · mirror-derived badges

## Exit criteria

- [ ] `derive_direction_by_mirror` is pixel-exact and instant
- [ ] `generate_direction_set('ordinal8')` uses mirroring for at least 3 of 8 on a symmetric character
- [ ] Direction ring on canvas makes an inconsistent direction obvious without zooming
- [ ] Every generated direction passes `check_palette_compliance`
- [ ] A broken direction can be repaired by inpainting without regenerating the set
- [ ] Direction picker correctly shows existing, missing, and mirror-derived states
- [ ] Tool descriptions steer the agent to mirror first, inpaint second, regenerate last

## Risks

### 2026-09-03 implementation verification

The current implementation uses one captured base (hub); incremental strategy,
ring layout and provenance badges above remain planned, not newly verified.
Regression tests cover all three sets, exact mirrors, project isolation,
validated source/target views, inferred named facing, navigation and partial
failure. Live south → east and south → north generations were visually checked
on a newly generated 128×128 merchant. See the
[dated test report](../verification/character-regression-2026-09-03.md) for the
full live/automated coverage distinction and output evidence.

| Risk | Mitigation |
| --- | --- |
| Rotation quality is genuinely imperfect — accessories and asymmetric details break first | Say so in the tool descriptions. Make the failure *visible* (ring layout) and *fixable* (inpaint) rather than hidden. This is an honest limitation of the category, not a defect we can engineer away. |
| Agent regenerates when it could mirror | Description ordering and an explicit note that mirroring is free and exact. |
| Incremental strategy accumulates drift | Offer both; default to hub for ≤4 directions, incremental for 8. Show provenance in the picker. |
