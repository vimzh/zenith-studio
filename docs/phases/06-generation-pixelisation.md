# Phase 08 — Generation & pixelisation pipeline

**Goal.** Model output and uploaded images become *real pixel art* — correct grid, project palette, hard edges, binary alpha.

**Why here.** Every generative feature downstream ([08](./08-animation-authoring.md), [09](./09-rotation-directions.md), [10](./10-concept-to-character.md), [11](./11-worlds-tilesets.md)) depends on this pipeline. It is the highest-leverage phase after the foundation, and the answer to the defect table in [`../idea.md` §2](../idea.md).

## Prior art

**[PixelRefiner](https://github.com/HappyOnigiri/PixelRefiner)** (MIT, © 2026 Happy Onigiri) solves the same conversion in-browser and its `src/core/` is dependency-free pure TypeScript over `{width, height, Uint8ClampedArray}`. We reviewed the source; the techniques below are drawn from it. **If any substantial code is ported, retain the MIT notice** ([`../requirements.md` §2](../requirements.md)).

---

## The pipeline

```
0. classify input        → native-pixel | scaled-pixel | soft-pixel | continuous | uncertain
1. native-scale check    → gcd(transition positions, side length)
2. grid detection        → cell size + phase, with confidence
3. cell resolution       → one palette index per cell
4. alpha binarisation    → 0 or 255, never between
5. cleanup               → isolated pixels, alpha-bleed cells
   → indexed grid (never a PNG)
```

### 0. Classify before committing

Measure `uniqueColorRatio`, `flatNeighborRatio`, `smoothGradientRatio`, `visiblePixelRatio` on a strided sample, combine with grid confidence, and route to **preserve** (already native — do nothing), **refine** (has a grid — detect and resample), or **convert** (continuous tone — choose a size and resample).

**Below a confidence threshold, fall back to preserve.** Never wreck an image the detector isn't sure about.

### 1. Native-scale shortcut — run this first

```
scale = gcd(all edge-transition positions, side length)
```
Transition positions in integer-upscaled art are all multiples of the scale, and so is the side length — so the largest such divisor *is* the scale. O(n), exact, no search. Returns 1 for already-native art, which is the answer for a large share of real inputs.

### 2. Grid detection — the core insight

> **Reconstruction error alone cannot find the true cell size.** It decreases monotonically as cells get finer, so it always prefers 1/2 or 1/3 of the truth.

The fix is a **second, opposing metric**:

```
boundaryContrast = mean edge strength at predicted boundaries
                 / mean edge strength at all positions
```

1.0 means no grid evidence. At a 1/3 grid, two-thirds of predicted boundaries land on flat cell interiors, diluting the numerator — **so over-splitting becomes a penalty.** Combine the two axes by **geometric mean** so one good axis can't carry a bad one. Sample boundaries with a ±1px triangular window so non-integer cell widths work.

Supporting pieces:
- **Signals** — per axis, average adjacent-pixel differences: colour boundary, luminance gradient (sRGB→linear first), alpha gradient. Combine ~`colour + 0.7·luma + 0.3·alpha`.
- **Candidates** — union of `length/output`, integer cells, and spacings *inferred from observed edge positions*. Not brute force.
- **Alignment score** — precision/recall F-style, not correlation: recall = edge energy near a predicted boundary ÷ total; precision = evidence at boundaries ÷ maximum possible.
- **Periodicity floor** — decay any cell repeating fewer than ~3 times. Kills "one huge cell trivially fits all boundaries."
- **Harmonic penalty** — explicitly demote candidates that are clean 2–3× multiples of a comparable-scoring candidate. Size mistakes are almost always harmonic.
- **Phase, searched separately** — sweep offset maximising boundary contrast, but **only accept a shift that also lowers reconstruction error.** An in-cell highlight line will otherwise pull the phase several pixels off, and a misphased grid makes every cell eat its neighbour — which reads as "blurry output" and sends you debugging the wrong stage.
- **Confidence** — weighted subscores, plus `stability` = the *relative* increase in reconstruction error under a 1px phase nudge. A correct grid should get measurably worse when you nudge it.

**Bound the cost.** Cap analysis dimension (~256px) and stride the sampling; skip phase-aware search above ~1.2M pixels.

### 3. Cell resolution — resolve straight to a palette index

This is where we **deliberately diverge from the prior art**, which resolves cells to RGB and quantises afterward. Resolving to RGB first lets the downsampler invent colours the palette can't express, then repairs them. Instead:

> **Resolve each cell directly to a palette index** — a medoid restricted to palette members, in Oklab. The ≤16-colour budget becomes a hard constraint the sampler respects, not a post-filter.

The method, in order of importance:

**a) Weighted medoid, not mean or median.** Minimise `Σ d²_oklab(candidate, other) · areaWeight · alpha` over candidates. A medoid returns a colour that *actually exists*; means and medians invent in-between colours that then have to be quantised away.

**b) Restrict candidates to the cell core.** Take the centre ~25% (margin ratio 0.375, capped ~6px, floor 2px). Boundary pixels are blends of adjacent cells, so including them pulls the medoid toward the blend. **This is what actually removes anti-aliasing** — there is no separate anti-aliasing pass. Still measure alpha coverage over the *whole* cell.

**c) Premultiplied Oklab**, so transparent pixels can't inject phantom colour.

**d) Thin-feature continuity rule** — the difference between keeping and destroying 1px outlines. Before letting a minority colour lose the vote, check whether it covers <45% of the cell, spans ≥65% of the cell in x or y, **and continues into the adjacent cell**. If so, multiply its cost by ~0.2 so it survives majority voting.

**e) Stratified sampling** (~32 samples/cell) weighted by true pixel-overlap area, so partial edge cells resolve correctly.

**f) Deterministic ties** — strict `<` in a fixed scan order. No RNG anywhere in the pipeline.

### 4. Alpha binarisation — the halo killer

```
alpha = coverage >= 128 ? 255 : 0
```

Done **at downsample time**, not in a background remover. Plus **bleed-only cell rejection**: a cell whose alpha is merely bleed from neighbours gets **both RGB and alpha zeroed** — the RGB part matters, because otherwise invisible colours leak into the palette histogram.

### 5. Palette — deterministic k-means++ in Oklab

- Operate on **unique colours with pixel counts**, not pixels; sort by packed key for reproducible float summation.
- **Deterministic seeding:** seed 0 = most frequent colour; seeds 1..k−1 = `argmax(minDist² × count)`. **No RNG.**
- Frequency-weighted centroid updates; converge at ~1e-3 movement or 20 iterations; re-seed empty clusters farthest-point.

**Determinism is a hard requirement here, not a nicety.** An agent and a human edit the same grid; if the same input produces different palette indices on a re-run, every re-run generates a spurious diff and `read_frames_diff` becomes noise.

### 6. Background removal — border-band clustering

Not corner sampling, not a histogram. Cluster the **border band** (~8% of the shorter side, all four sides) into ≤4 Oklab clusters. Gate on confidence; below threshold, remove nothing.

**Alpha border guard:** if ≥35% of the border band is already non-opaque, skip entirely — the image expresses background via alpha and needs no help.

**Never auto-remove pixels that are already semi-transparent.** Only fully opaque pixels get colour-tested. Roll back if >92% of the image would be removed.

### 7. Cleanup

- **Isolated-pixel removal** with thresholds in *output* pixels (default ~2), 4-connected. Protect small components that are near the main body, mirror-symmetric with it, repeat as a shape+colour key, or extend a 1px line — these are intentional details, not noise.
- **De-fringing by ray probing.** For edge pixels, compute the mixing direction `(pixel − background)/|pixel − background|` and adopt the outermost samples along that ray from the original full-resolution cell. Gate with a betweenness test — if the channel doesn't lie between background and interior, it's the subject's own colour, so leave it.

---

## Also in scope

- **Pixelisation runs client-side in a Web Worker.** The whole pipeline above is pure TS over `Uint8ClampedArray` — no WASM, no WebGL, no dependencies. Running it locally gives zero latency, zero cost, and keeps uploaded images on the device. Grid search is the heavy step, so it goes in a worker to keep the canvas at 60fps.
- **Model calls go to `apps/api` on GCP Cloud Run** — `POST /generate`, with the key in Secret Manager and rate limiting server-side. See [`../idea.md` §12](../idea.md).
- OpenAI SDK + `gpt-image-2`, with high-quality generation and high-fidelity source edits
- **The app stays fully usable with the backend down.** Every step of the pipeline, and every deterministic tool, works offline. Only generation degrades, and it degrades with a readable error.
- `generate_asset`, `draw_from_prompt`, `derive_variant`, `reduce_colors`, `remove_background`, `extract_palette`, `pixelize`, `check_grid_alignment`
- **Candidate sizes surfaced, not guessed.** When confidence is low, offer the top ~7 alternatives as thumbnails — the selected grid **plus its 2–6× harmonics**, log-bucketed by output height. For an agent+human tool this is exactly right: the agent proposes, the human picks, and a wrong guess is never silently destructive.
- Warnings surfaced to both human and agent: low grid confidence, background uncertain, one-axis detection failed, extreme output size, fell back to preserve
- Derived assets land **in the same folder as their source** — variations, rotations, mirrored directions and tileset sheets all inherit the source's project *and* folder (`ProjectLibrary.inherit`). Creators with no source — `create_asset`, `generate_asset`, `import_image`, `build_character_from_reference` — go to the open project's root. Before this several placed nothing at all, and the by-product left the project for the loose pool with nothing reporting it.
- Loading and cancellation — generation takes seconds and must never block the editor

## Out of scope

Image upload UI ([10](./10-concept-to-character.md)) · inpainting ([10](./10-concept-to-character.md)) · animation and rotation generation (their own phases)

## Deliberately not doing

Anti-patterns observed in the prior art, worth avoiding by name:

| Don't | Why |
| --- | --- |
| Ship two background engines | Duplicated scope, hole, and rollback logic across three files. Pick one. |
| Ordered-dither bias as `(t − 0.5)·strength·255` added equally to R, G, B | At 16 colours that's ±119 levels of achromatic shift — it shreds hue relationships. Scale bias by the actual local palette step, in the working colour space. |
| Raster-order-only Floyd–Steinberg | Directional streaking is very visible at pixel-art resolutions. Use serpentine, and memoise the palette lookup. |
| Treat any `alpha ≥ 1` as fully opaque in the palette histogram | Feeds non-unpremultiplied RGB at full weight into k-means. Un-premultiply, weight by alpha, or exclude below a threshold. |
| Expose ~20 behaviour booleans | Expose *outcomes* — target size, colour count, background on/off. Keep thresholds internal. |
| Duplicate palette entries | With a 16-colour, one-hex-char budget, every index must be distinct and reachable. |
| Let outline generation resize the canvas | Silently changing dimensions invalidates every shared coordinate between agent and human. |
| Snap to a hardware colour depth only in config comments | If we claim SNES 15-bit, snap on **output** and clamp before packing. |

## Tools introduced

`generate_asset` · `draw_from_prompt` · `derive_variant` · `pixelize` · `reduce_colors` · `remove_background` · `extract_palette` · `check_grid_alignment`

**The project palette stopped being a generation-time law on 2026-09-02.** A
palette handed to an image model as "use only these 16 colours" makes every
asset in a project look like the same asset — the model reaches for the nearest
listed shade instead of the right one. It stays in the style contract, where
`check_style_consistency` reports it and `conform_to_style` applies it exactly,
and `styleBrief(profile, type, { lockPalette: false })` is what generation now
sends. A canvas preset still locks colour, because that is a palette the caller
picked for that one call. What preserves a project's look instead is what
already did the heavy lifting: the form half of the brief (view, projection,
outline, shading, proportions, feature bound) and, when the project has a style
reference, the model being *shown* that asset rather than told about it.

**Sixteen colours is a cap on live colours, not on slots.** Asked to add red
cherries to a bush, `inpaint_region` told the model to use only the existing
palette and then remapped anything red anyway, so `#c0392b` (0.084 away in
Oklab) became `#96513c`, a brown — while nine of the sixteen slots held colours
nothing on the canvas referred to. `mergePalette` now keeps every entry the art
actually uses at its current index and spends the unused ones on colours the
edit genuinely needs; only a truly full palette falls back to nearest-matching,
and the tool says so instead of hiding it. Widening a palette rebuilds the
document, so it costs that asset's undo history — which is why it only happens
when the palette really changed, and why the tool reports it.

**`draw_from_prompt` was added on 2026-09-02**, after the chat shipped without it. The chat allowlist offered no way to generate into the *open* asset — `generate_asset` makes a second one — so asked to "make a bush" on an empty canvas the model hand-drew the sprite with `set_pixels`, spent all eight turns, and produced a shapeless mass. It is `generate_asset`'s pipeline with a different destination: the current frame, replaced as one undo entry and conformed to that asset's own palette.

Two prompt changes landed with it. Every generation now sends the **cell count of the grid it will land on**, so the prompt bounds feature *count* (`at most cells/4 shapes across the width`) instead of asking for "chunky" and hoping; and the sprite prompt states how 2D game art depicts a subject rather than how a camera sees it. Both are phrased as ceilings — "at most a few flat tones", "no camera perspective" — because a project's style brief travels in the same prompt and may ask for flat colour or an isometric projection, and a floor would contradict it in a way nothing downstream measures.

## UI introduced

**Prompt budget (2026-09-03):** `/v1/generate` prompts and `/v1/derive` instructions accept 16,000 characters, including client-appended project style text. Both client and server validate this boundary without truncation. This replaces the 1,000-character cap that rejected the Moss Knight prompt after style composition (1,149 characters). Server drawing rules are added after this input budget. Animation motion descriptions retain their separate 10,000-character limit and now travel intact to the sheet renderer.

Generation prompt in the agent pane · progress and cancel · before/after pixelisation preview · **grid candidate picker** when confidence is low

## Exit criteria

- [ ] A generated 32×32 sprite passes `check_palette_compliance` with zero violations
- [ ] Grid detection recovers the true cell size on ≥8 of 10 test images from different generators
- [ ] **Harmonic errors specifically tested** — a 1/2 and 1/3 grid must both be rejected in favour of the true cell
- [ ] Native-scale GCD check correctly returns 1 for already-native art and the exact factor for integer-upscaled art
- [ ] 1px outlines survive downsampling (thin-feature rule verified against a hand-made fixture)
- [ ] Output contains **zero** semi-transparent pixels
- [ ] Output uses **only** project palette indices — no post-hoc quantisation needed
- [ ] **Determinism:** the same input produces byte-identical output across 10 runs
- [ ] Low-confidence input falls back to preserve and surfaces a warning rather than mangling the image
- [ ] Grid candidate picker offers harmonics of the selected size
- [ ] Generation failure surfaces a readable error to both human and agent; the editor stays responsive
- [ ] No API key reachable from the client bundle; CORS locked to the Vercel origin, not `*`
- [ ] Uploaded images never leave the browser — verified in the network tab
- [ ] With the backend unreachable, `pixelize` and every deterministic tool still work; `generate_asset` fails readably

## Risks

| Risk | Mitigation |
| --- | --- |
| Harmonic grid errors (the dominant failure mode) | Boundary contrast as a counter-metric, explicit harmonic penalties, and harmonics offered in the candidate picker. Tested explicitly. |
| Grid detection fails on genuinely gridless output | Classification routes it to `convert`; below the confidence floor, preserve. Report low confidence in the tool return so the agent knows to inspect. |
| Non-determinism creating spurious diffs | No RNG. Deterministic k-means++ seeding, fixed-order tie-breaking, sorted accumulation. Asserted in tests. |
| Latency breaks demo pacing | Deterministic tools dominate the core loop. Pre-seed examples. Never block on generation. |
| Cost per generation | Cache by prompt+style hash. Small default sizes. |
| Pipeline complexity sprawl | Expose outcomes, not thresholds. Every internal constant gets a comment recording the *measured* case that set it. |

### Verified repair — 3 September 2026

`pixelize` now creates a separate single-frame copy from the selected composite,
using the extracted palette and retaining the source's project/folder. The
original frames and history remain intact. This replaces the broken in-place
size-change contract. Browser-worker checks cover 64→32 and exact 64→128;
pure-pipeline tests also check 64→96 nearest-neighbour cadence, stale work,
empty images and deleted destinations. `remove_background` now leaves a
dominantly transparent border alone and removes only border-connected opaque
background regions in the active layer, preserving enclosed same-colour pixels.
See the [dated verification matrix](../verification/character-regression-2026-09-03.md).
