# Gaps

Live tracking of what is **actually** done versus what a phase claims. Updated as work lands.

> **Historical engineering log:** later sections preserve earlier audit snapshots and may describe gaps that have since closed. For current hackathon release status, use [`submission-readiness.md`](./submission-readiness.md); for the implemented tool surface, use [`tools.md`](./tools.md).

> Companion docs: [`phases/`](./phases/README.md) (the plan and its exit criteria) · [`idea.md`](./idea.md) · [`requirements.md`](./requirements.md) · [`tools.md`](./tools.md)

**Rule for this file:** a criterion is only ticked when it has been *verified*, not when the code that should satisfy it exists. Anything verified by proxy (a stub, a reasoned argument) says so.

Last updated: 2026-09-02.

---

## Status at a glance

Swept phase by phase against the exit criteria in each phase doc, not against memory.

| Phase | Engine | Reachable | Notes |
| --- | --- | --- | --- |
| 01 Core data model | done | yes | Complete |
| 02 Canvas editor | done | yes | Complete; the untested PNG path is now round-trip covered |
| 03 WebMCP foundation | done | yes | 3 criteria need a real browser or a real agent |
| 04 App shell | done | partial | Pane persistence needs a cookie; layout shift unmeasured |
| 05 Asset library | done | yes | Delete-across-reload unverified in-browser |
| 06 Generation & pixelisation | done | yes | **Live end to end** — `generate_asset` produces real art |
| 07 Animation core | done | yes | 15 tools plus the timeline |
| 08 Animation authoring | done | partial | Presets and GIF wired; `animate_with_text` needs a model |
| 09 Rotation & directions | done | yes | Directions panel; mirror path live, generation needs a model |
| 10 Concept to character | done | yes | Reference upload runs the full chain |
| 11 Worlds & tilesets | done | yes | Autotile panel derives 47 tiles into a sheet |
| 12 Skeletons | done | partial | Draggable local rig, frame baking and stock cycles live; reusable rig library and transfer remain |
| 13 Export & polish | done | partial | Export dialog live; the editor-polish half is not built |
| 14 Projects | done | yes | Projects, folders, enforceable style and export are live; workspaces cut |

**Reachability, measured rather than estimated** — consumers of each engine outside its own folder and its own tests. Before wiring, then after:

| Engine | Before | After |
| --- | --- | --- |
| `lib/pixelize` | 3 | 5 |
| `lib/animation` | 4 | 4 |
| `lib/directions` | 1 (dead) | **3** |
| `lib/spritesheet` | 3 | 3 |
| `lib/export` | 2 | 2 |
| `lib/skeleton` | **0** | **7** |
| `lib/character` | **0** | **1** |
| `lib/tileset` | **0** | **1** |
| `lib/transform` | **0** | **2** |

All listed engines now have live consumers. The registry is 91 tools with view scoping.

--- | --- | --- | --- |
| [01](./phases/01-core-data-model.md) Core data model | **Complete** | 5/5 | 201 tests across the repo |
| [02](./phases/02-canvas-editor.md) Canvas editor | **Complete bar one test** | 6/7 | PNG byte-exactness untested |
| [03](./phases/03-webmcp-foundation.md) WebMCP foundation | **Code complete, 3 unverifiable here** | 5/8 | All three need a real browser or a real agent |
| [04](./phases/04-app-shell.md) App shell | **Partial** | 7/9 | Pane persistence needs a cookie; layout shift unmeasured |
| [05](./phases/05-asset-library.md) Asset library & persistence | **Built, 1 unverified** | 5/6 | Delete-across-reload unverified in-browser |
| [06](./phases/06-generation-pixelisation.md) Generation & pixelisation | **Pipeline done; generation unverified** | 8/12 | Needs an `OPENAI_API_KEY` to verify |
| [07](./phases/07-animation-core.md) Animation core | **Mostly built** | 5/7 | Frame tools not exposed to WebMCP |
| [08](./phases/08-animation-authoring.md) Animation authoring | **Engines built; not wired** | 4/7 | Interpolation + GIF done; UI and text-driven pending |
| [09](./phases/09-rotation-directions.md) Rotation & directions | **Deterministic half done** | 3/7 | Mirror path complete; generative path needs a key |
| [10](./phases/10-concept-to-character.md) Concept → character | **Chain built; no upload UI** | 4/7 | Orchestration tested with an injected generator |
| [11](./phases/11-worlds-tilesets.md) Worlds & tilesets | **Autotiling done; generation not** | 4/7 | 47-tile set derived by composition, no model |
| [12](./phases/12-skeletons.md) Skeletons & transfer | **Local authoring live; reuse incomplete** | 3/7 | Saved pose libraries and cross-character transfer remain |
| [13](./phases/13-export-polish.md) Export & polish | **Exports done; UI polish not** | 5/9 | Engine bundles, palettes, indexed PNG all built |
| [14](./phases/14-projects.md) Projects | **Complete** | 6/6 | Browser, WebMCP, model and persistence paths verified |

### Known hazard, carried forward

**`session.activeId` and the `/asset/[id]` route must not diverge.** Tools resolve `session.active`; the editor renders `session.get(id)`. When they disagree the agent edits an asset the human is not looking at, and **nothing errors**. This has already occurred twice, in both directions, and was found both times only by checking a claim rather than assuming it.

The rules are in [`AGENTS.md`](../AGENTS.md) under "The route owns which asset is open". The live hazard is anything that reassigns `activeId` as a side effect — `session.close()` does, which lands in scope the moment [phase 05](./phases/05-asset-library.md) adds delete from the library. Warning comment sits on the method itself.

Do **not** resolve this by detecting a mismatch and navigating: effects run child-first, so route and session legitimately disagree for one commit on mount, and a detector navigates to the wrong asset. There is a regression test named for that failure.

**Repo health:** 738 tests pass · typecheck clean (3 bun workspaces) · lint clean.

---

## Phase 01 — Core data model ✅

All five exit criteria verified by tests.

| Criterion | Evidence |
| --- | --- |
| Round-trip 1000 random documents byte-identically | `serialize.test.ts` |
| Every invariant rejects rather than silently corrects | `invariants.test.ts` — 20+ tests, one per invariant |
| Undo/redo survives a 500-operation fuzz | `history.test.ts` |
| Oklab quantiser reduces 4096 → 16 sensibly | `color.test.ts` — plus perceptual-distance and hue-separation checks |
| No `any` in the store's public surface | grep confirms none in `packages/core/src/` |

---

## Phase 02 — Canvas editor

### Open

- [ ] **Exported PNG at 1× is byte-exact against the indexed grid.** No test exists. `gridToImageData` is untested — the export path is the one piece of the pixel lib with no coverage. *Small; write it.*

### Verified

Drawing a 32×32 sprite end to end · pixel-perfect produces no double-pixels on a fast diagonal · zoom is integer-only (enforced by the `ZoomLevel` union, plus two tests) · tile preview updates within a frame · no dead controls or console errors · every deferred tool genuinely absent rather than a disabled button.

---

## Phase 03 — WebMCP foundation

### Blocked on a real browser — cannot be closed from here

These are **submission requirements**, not nice-to-haves ([`requirements.md` §2](./requirements.md)).

- [ ] **All 14 tools appear in the Model Context Tool Inspector extension** with correct schemas. Verified by proxy only: a recording stub of `document.modelContext` confirmed all 14 register in order, with correct schemas and `readOnlyHint` on exactly the four read-only tools. A Chrome extension cannot be installed from this environment.
- [ ] **Works in Chrome 149+ with `chrome://flags/#enable-webmcp-testing`, and in the ChatGPT in-app browser.** Needs real browsers.
- [ ] **An agent completes the cobblestone refinement end to end** ([`idea.md` §11](./idea.md)). The tool loop it composes is proven; an actual agent driving it is not.

### Verified

`check_seamless_tiling` returns coordinates, not a boolean, and the fail → fix → re-check → pass loop closes (demonstrated: 32 mismatches listed with both coordinates and both characters, one `fill_region` fixed it, re-check PASS in 1.7ms) · every agent mutation repaints within a frame · `Ctrl+Z` undoes an agent's edit · navigating away leaves zero registered tools · the Agent Console drives every tool with no WebMCP client present.

---

## Phase 04 — App shell

### Open

- [ ] **Pane widths survive reload.** *Attempted and reverted — do not retry the same way.* Three approaches failed:
  1. `useDefaultLayout` with `storage: undefined` on the server takes an async path and throws *"A component was suspended by an uncached promise"* — React does not allow a client component to suspend on a promise it did not cache.
  2. The same hook with a synchronous storage shim renders different sizes on the server (no storage) than on the client (storage) — a hydration mismatch React refuses to patch up.
  3. Imperative `group.setLayout()` in a layout effect avoids both, but does not apply: the groups use `groupResizeBehavior="preserve-pixel-size"` with pixel `minSize`/`maxSize`, and the percentage layout the library reports back is not accepted in that mode.

  **The correct fix is a cookie**, not `localStorage`: a server component can read it, so SSR and the first client render agree, giving both restoration *and* no layout shift. `app-shell.tsx` is already a server component. Left unbuilt rather than shipping dead complexity — the reverted attempt is not in the tree.
- [ ] **No layout shift on load.** Not measured. Self-hosted Geist should make this true, but "should" is not verified.

### Verified

Command palette (`Ctrl/Cmd+K`) over assets and tools — assets navigate, tools preselect in the Agent Console runner and never execute, so a mutating tool cannot be fired by autocomplete · responsive floor below 1100px, where the agent pane becomes an overlay drawer (still a mount, so WebMCP registration follows it rather than being dropped) ·

library renders real asset previews at integer zoom over the checker · clicking an asset opens a deep-linkable `/asset/[id]` · status readout tracks the cursor in art coordinates and matches what tools report · empty state creates an asset in one click · no element exceeds 6px radius.

---

## Phase 05 — Asset library & persistence

Built. IndexedDB persistence, asset CRUD with undoable delete, search and type filter, JSON import/export, save indicator, and graceful degradation.

### Open

- [ ] **30 assets survive reload** — verified with 4, not 30. No reason to expect a difference, but the stated number was not tested.
- [ ] **Delete persists across reload** — the logic is covered by regression tests, but the end-to-end browser check could not be repeated: testing wedged the dev browser profile's IndexedDB for `localhost` (a `deleteDatabase` issued while connections were open), and it does not recover across pane restarts. `127.0.0.1` is a separate storage partition but serves unstyled pages in dev, so it is not a usable substitute.
- [ ] **Registered tool count changes between library and editor, no ghosts** — needs the Tool Inspector, same blocker as [phase 03](./phases/03-webmcp-foundation.md).

### Verified

Assets persist across reload and appear in IndexedDB · JSON export re-imports to an identical state · duplicate copies pixels without aliasing the original · delete is undoable and restores both the pixels and the original library position · **IndexedDB failure degrades to in-memory with a visible warning** — confirmed against a genuinely wedged database: the banner reads "Changes are not being saved… Export the library to keep your work", the indicator turns red, and the editor stays fully usable.

### Four bugs found while building it, all silent

Each rendered a correct-looking library over wrong data, and none would have failed typecheck, lint, or the test suite as it stood:

1. **Strict Mode re-seeding.** `hydrate()` set its guard synchronously before the async load finished, so React's double-invoked effect saw an empty session and seeded on top — resurrecting deleted assets under their original ids. `hydrate()` now returns the same in-flight promise. Regression test named for it.
2. **Writes lost on navigation.** A 600ms debounce plus a 2000ms `requestIdleCallback` timeout could hold a write for over two seconds; navigating away dropped it. Now flushes on `pagehide` and `visibilitychange`, with the idle ceiling cut to 400ms.
3. **Leaked connection on open timeout.** When `indexedDB.open()` exceeded its timeout the request was abandoned, then later succeeded and held a connection open forever — permanently blocking every future `deleteDatabase` and upgrade. This is what wedged the test profile. The late connection is now closed.
4. **Restore position lost.** `undoDelete` re-inserted with a fresh ordinal, so an undone deletion jumped to the end of the library. Caught by a test, not by hand.

## Phase 06 — Generation & pixelisation

The pixelisation pipeline is built and covered by 20 tests. It is pure TypeScript over byte arrays with no DOM dependency, so it runs in a Web Worker *and* is testable headlessly — which matters, given the browser verification problems phase 05 ran into.

### Verified

Native-scale GCD shortcut recovers exact integer upscales (2, 3, 4, 6, 8) and returns 1 for native art · grid detection finds the true cell size rather than a harmonic · cell resolution returns a colour that occurs in the source, never a blend · anti-aliased cell borders are ignored by sampling the core · alpha is binary, never partial · the palette cap is never exceeded · **output is byte-identical across repeated runs** · a gridless image warns instead of guessing silently · harmonic alternatives are offered when confidence is low · a malformed buffer is rejected with an actionable message.

API endpoints verified live: `/health` reports whether generation is configured, and `/v1/generate` plus `/v1/derive` return a clear 503 naming the missing variable rather than failing obscurely.

### Open

- [ ] **The actual OpenAI call is unverified locally.** The key is deployment-only. The endpoint, prompt construction, CORS lock and error paths are exercised; the deployed round trip to `gpt-image-2` still needs the demo smoke test.
- [ ] **Grid detection tested on synthetic images only.** The exit criterion asks for ≥8 of 10 images from real generators. Checkerboards at several scales pass, but real model output is messier than anything constructed here.
- [ ] **The Web Worker path is unexercised.** `pixelizeAsync` falls back to inline execution, and only the inline path has run. The worker needs a browser.
- [ ] **Remaining phase-06 tools are not wired.** `generate_asset`, `derive_variant`, and `pixelize` are exposed through WebMCP; `reduce_colors`, `remove_background`, `extract_palette`, and `check_grid_alignment` remain absent.

### Two bugs found by tests, both silent

1. **Half a metric.** Boundary contrast alone returned a cell **twice too coarse**. It rules out grids that are too fine — every boundary of a too-fine grid lands in a flat interior — but a too-coarse grid also puts every boundary on a real edge, so contrast is equally happy with it. Reconstruction error is what rejects the coarse ones, because a cell spanning two colours cannot represent either. Scoring on contrast alone returns 2× the truth; on reconstruction alone, ½. Only the pair converges.
2. **A scale claimed on no evidence.** With no transitions detected — a smooth gradient — `detectNativeScale` fell through to `gcd(width, height)` and reported a scale of 64 for a 64×64 image. It now requires a minimum number of observed transitions before trusting the divisor.

## Phase 07 — Animation core

Frames, timeline with playback, and the perception layer that makes multi-frame work affordable for an agent. Frame mutation (`addFrame`, `deleteFrame`, `reorderFrames`, `setFrameDuration`) landed in `@zenith/core`, built by the other agent at my request rather than by me editing their file.

### Verified

`readFramesDiff` returns changed pixels with both values and refuses mismatched sizes naming both · `readAnimationSummary` reports centroid movement, and an empty frame gives a null centroid rather than a fake one at the origin · `checkAnimationCoherence` names the frame for off-palette cells, silhouette pops and stuttering loops · six procedural presets, all deterministic, all clamped to the palette, none repeating the base frame at the end · `scroll` wraps so a seamless tile stays seamless while moving · timeline renders frame thumbnails, duplicate/add/delete work, playback is `requestAnimationFrame` against a wall clock rather than a drifting interval.

### Open

- [ ] **Frame tools are not exposed to WebMCP.** `list_frames`, `add_frame`, `select_frame`, `read_frame`, `read_frames_diff`, `read_animation_summary`, `animate_procedural`, `check_animation_coherence` all have working implementations and no tool surface. Deliberately paused: the registry is at 16 and eight more is where [`AGENTS.md`](../AGENTS.md) says view-scoped registration starts to matter.
- [ ] **Onion skin is not built.** In scope for this phase; the timeline ships without it.
- [ ] **GIF/APNG export is not built.** That is [phase 08](./phases/08-animation-authoring.md) proper, but `export_animation` is listed here in the tool catalog.

### Two bugs, both mine, both caught in the browser rather than by tests

1. **The editor route never hydrated.** Persistence worked, but only `AssetLibrary` called `session.hydrate()` — so a deep link to `/asset/[id]` reported "not in this session" for an asset sitting on disk. This is the exact criterion phase 05 claims to satisfy, and it was broken for every direct link. Both routes now hydrate.
2. **Auto-fit ran against an unsettled layout.** Fitting once on the first reported canvas size meant a measurement taken before layout completed, so a 32×32 sprite fitted at 1× in a 615px-tall viewport and stayed there. Auto-fit now re-runs on every resize until the user zooms or pans deliberately, which is better behaviour anyway.

## Phases 08–10 — engines and core authoring surfaces

All three phases share a shape: the algorithmic core is built and tested headlessly, and the UI and WebMCP surfaces are not. That was deliberate — pure logic can be verified here, browser and model paths cannot.

### Phase 08 — Animation authoring

**Verified.** `interpolateFrames` moves pixel *positions* rather than blending values, so an in-between never invents a colour outside the two frames — blending index 3 and index 9 gives index 6, which may be an unrelated hue. Identical frames interpolate to themselves rather than inventing motion. **GIF89a encoder written by hand**, including variable-width LZW: GIF is itself an indexed format with a global colour table, which is exactly what a Zenith document already is, so encoding is a direct write with no quantisation and no colour loss. 22 tests covering header, trailer, per-frame control extensions, the Netscape looping block, transparency reserved past the palette, a full 16-colour table, and determinism.

**Open.** Onion skin. Text-driven animation is exposed in the asset panel and WebMCP, with a 2–12 frame control and the existing timeline as its preview; real-model motion quality still needs a representative visual benchmark.

### Phase 09 — Rotation & directions

**Verified.** The mirror path, which is the whole cost argument: **eight directions cost five generations, four cost three, and a side-on pair costs one.** `mirrorGrid` is lossless and involutive; `planDirectionSet` never mirrors from a direction not yet resolved; north and south correctly have no partner, since they face the camera.

**Open.** The direction ring layout. `rotate_character` and `generate_direction_set` are exposed through WebMCP, and the asset panel can complete cardinal or ordinal sets while preferring exact mirrors. A full real-model eight-angle identity-coherence benchmark is still needed.

### Phase 10 — Concept art → playable character

**Verified.** The chain is five named steps, each committing its own artifact, so a bad direction is fixed in place rather than re-running everything. The generative step is *injected*, which is what let the chain's shape be tested without a network: 13 tests covering provenance (`drawn` / `mirrored` / `generated`), mirror-preference, async generators, failure propagation, and determinism. Spritesheet packing produces an Aseprite/TexturePacker-shaped atlas — the format Phaser loads directly — with 12 tests, including that a tag appearing in two separate runs becomes two ranges rather than one silently spanning the frames between them.

**Verified.** The reference tray stages PNG, JPEG, or WebP input; shows Source and Sprite together; accepts 32, 48, 64, 96, or 128px output, direction set, and the facing depicted by the reference; then runs semantic extraction before local pixelisation. `inpaint_region` is available from a marquee selection and through WebMCP; the model receives the exact document palette before its output is conformed and merged. Tests cover source/mask validation, equal source/mask dimensions, exact preservation outside the selected rectangle, and single-step undo. A real astronaut visor edit changed 34 selected cells and zero outside cells after the complete model → pixelise → palette → merge path.

**Open.** A full real-model direction-set identity-coherence benchmark. The app guarantees inpaint locality outside the selected rectangle; style matching inside it remains model-dependent and must not be advertised as perfect. The first real edit also showed why the palette must be named in the model prompt: asking for a hue outside the fixed 16-colour document palette is necessarily mapped to its nearest existing colour.

## Phase 11 — Worlds, tilesets & textures

The autotiling core is built and covered by 34 tests. This is the phase where composition beats generation most clearly, and the tests assert that specifically.

### Verified

**The 256 → 47 reduction is exact.** A diagonal neighbour is only visible when both its adjacent cardinals are also filled, so normalising away invisible corners collapses 256 neighbour configurations to precisely 47 tiles — asserted, along with idempotence, full reachability (no orphan tiles), and that visually identical masks share a tile.

**A complete 47-tile blob set is derived from one base tile with no model involved.** Every tile is four quadrants drawn from five possibilities, so five quadrant pieces compose the entire set. That is not merely cheaper than 47 generations — it is the only way the tiles are *guaranteed* to fit, since independently generated tiles disagree on edge weight and noise and leave seams that do not meet. All 47 provably share one interior texture.

Map assembly resolves terrain flags to tile indices separately from compositing, so an author edits "is this cell grass" and never "which of the 47 grass tiles goes here" · `extend` versus `clip` edge rules behave differently and are both tested · extending a map preserves existing terrain and leaves new cells empty rather than inventing terrain the author did not place · a partial tileset is reported rather than silently drawing nothing.

### Open

- [ ] **`generate_texture` and `generate_isometric_tile`** — both need a model, same blocker as everywhere else.
- [ ] **Wang and simple16 set types.** Only `blob47` is built; the other two are listed in the tool catalog.
- [ ] **Tiled Mode** (drawing across the seam), deferred here from [phase 02](./phases/02-canvas-editor.md), and **tilemap layers**. Neither built.
- [ ] **No UI and no WebMCP tools.** Same shape as phases 08–10: engine built, surface not.

### One correction to a test, not to the code

My first out-of-range test asserted that a one-tile set must fail. It does not, and should not: an isolated cell has no neighbours, resolves to mask 0, and index 0 exists in a one-tile set. The test premise was wrong. Rewritten to use a surrounded cell, which genuinely needs a high index — and a second test now pins the one-tile case as legitimate so nobody "fixes" it later.

## Phase 12 — Skeletons & animation transfer

32 direct skeleton tests plus generator and tool integration coverage. The design decision that makes the phase work: **poses are stored in normalised coordinates, 0–1 across the content bounds, not in pixels.** A pose in pixels is welded to the sprite it was drawn for; a pose in proportions travels.

### Verified

`estimateSkeleton` reads the silhouette's width profile rather than guessing from proportions alone — the widest row above the midpoint is the shoulders, the narrowest below is the waist — and the tests assert shoulders end up above the pelvis and wider apart than the hips on a humanoid outline. An empty sprite yields `null` rather than a pose centred on nothing, and a single-pixel sprite does not divide by zero.

**Retargeting refuses what it cannot do.** A bipedal pose applied to a quadruped throws instead of dropping the joints that do not correspond — silently dropping them would produce a four-legged character walking on two of its legs. Interpolation likewise refuses to blend across character types, and drops joints missing from either side rather than inventing them.

Templates are stored as **keyframes, not strips**: a walk is two contact poses, and the passes between them are interpolation. Four hand-placed frames would be four things to keep consistent when proportions change; two keyframes stay correct. `resamplePoses` expands a cycle to any frame count and wraps, so the last keyframe blends back toward the first. Six stock cycles — idle, walk, run, attack, jump, hurt — each asserted to define every joint, to have genuinely differing keyframes, and (for walk) to oppose the arms to the legs, which is what makes it read as walking rather than shuffling.

**The editor is now a real no-prompt authoring path.** `Space+E` or **Estimate from silhouette** opens connected joint handles over the canvas. Handles were dragged and pixel-snapped in the live browser at 1× and 16×; **Create posed frame** baked the edited pose into the timeline as one undoable local operation, and undo restored the five-frame source asset. The same deterministic deformation powers the template picker and the registered `animate_with_skeleton` WebMCP tool.

The rig preserves palette indices by inverse-mapping the untouched source grid; it never calls a model or invents colours. A six-frame walk rendered from a real 32×32 generated samurai was visually inspected and returned no `checkAnimationCoherence` problems. This is deliberately a flat-sprite blocking rig: small silhouette and overlap corrections remain normal pixel editing.

### Open

- [ ] **Reusable pose storage and `transfer_animation`.** Poses transfer in the engine, but saved cross-project pose libraries and end-to-end character-to-character application are not surfaced.
- [ ] **`re_pose` and arbitrary agent-authored joint editing.** The agent can apply stock templates through `animate_with_skeleton`; custom keypoint mutation is still UI-only.

## Phase 13 — Export, polish & engine integration

50 tests. The export half is done; the editor-polish half is not.

### Verified

**Indexed PNG-8 with `PLTE` and `tRNS`, written by hand.** Every other raster export flattens indices to RGB; this one does not, because PNG colour type 3 *is* an indexed image with a palette — exactly what a Zenith document already is. The file stays indexed, so a shader can read the index and swap palettes at runtime. Deflate is emitted as stored blocks, which is a valid zlib stream every decoder accepts and keeps the encoder readable; these files are kilobytes, so compression would buy nothing worth a Huffman coder.

**Four engine bundles, and the value is the sidecar, not the PNG.** Godot gets a `.import` with filtering and mipmaps off — Godot writes that file itself on first import using project defaults, which are wrong for pixel art. Unity gets a `.meta` with Point filtering, no compression, and a pre-sliced sheet, **with y flipped** because Unity's texture origin is bottom-left while the atlas is top-left; getting that wrong slices the wrong rows silently, so there is a test for it. Phaser gets a loadable atlas plus the `pixelArt: true` warning. LÖVE gets Lua with `setFilter('nearest','nearest')` already applied.

**Six palette formats** — GPL, JASC PAL (CRLF, as its DOS-era parsers expect), hex list, Paint.NET TXT, binary ASE (big-endian, UTF-16BE names, float channels), and strip indices. Each rejects an empty palette and a malformed colour.

**Deferred-register items now built:** `rotateGrid` (exact at right angles, four turns return the original), `resizeCanvas` (grows with transparency, shrinks by clipping — never scales, since conflating those is how a resize silently blurs a sprite), `findColorRegions` (iterative flood fill, so a large region cannot blow the stack), `sortPalette` (rewrites indices so nothing changes visually), and `checkReadability` (three countable failures, not a quality judgement).

### Open

- [ ] **Layers**, the largest remaining editor gap. The model already treats a frame as a layer composite, so this is UI and compositing rather than a data migration.
- [ ] Selection, shape tools, dither brush, mirror-draw, 8×8 guide — the rest of the deferred register.
- [ ] **RotSprite** for arbitrary-angle rotation.
- [ ] Slices with pivots · 32-colour mode · performance and accessibility passes.
- [ ] **No UI and no WebMCP tools**, as with phases 08–12.

## Wiring — UI tranche 1

The engines built in phases 06–13 were unreachable. This is the first tranche of making them usable.

### Verified in the browser

**Export dialog, 14 formats** — PNG, indexed PNG-8, animated GIF, spritesheet + atlas, four engine bundles, six palette formats. Opened from the toolbar or `Ctrl/Cmd+S`. Verified by intercepting the download rather than trusting the UI: "Godot 4" emitted `Cobblestone.png` (2061 bytes), `.png.import` (512), `.frames.txt` (704) and `README.md` (300), with the status line naming all four.

**Procedural animation presets** in the timeline — six cycles, one transaction each, so a preset is a single `Ctrl+Z`. Verified: 6 frames → 9, then one undo → 6.

**`checkAnimationCoherence` surfaced in the UI**, and it immediately found something unprompted: applying `sway` to an existing cycle reported *"Frame 8 is identical to frame 0, so a looping cycle holds it twice."* A checker written blind two phases earlier, earning its place the moment it had somewhere to speak.

**Onion skin** — previous *and* next ghosted, at 0.3 and 0.18. Both neighbours, because an in-between is judged against both, and seeing only one is how a frame ends up correctly following the last and badly leading the next.

**View-scoped tool registration** (the other agent's work) — the library screen registers 3 tools, an open tile registers more, and a character never sees tileset tools. That also closes an unmet [phase 05](./phases/05-asset-library.md) criterion.

### Still unreachable

Direction picker · tileset panel · skeleton editor · reference upload. And the ~28 WebMCP wrappers around the phase 06–13 engines are not written — scoping infrastructure exists, the tools do not.

### One bug of mine, and what it exposed

I wrapped the preset builder in `store.transaction()`, which the store refused: adding a frame moves the indices every buffered pixel patch refers to. Correct guard, wrong code.

Reporting rather than working around it turned out to matter more than the wart suggested. `AGENTS.md` states *"one logical operation is one entry"*, and [phase 01](./phases/01-core-data-model.md) names undo granularity as a risk — so six presses to undo one preset was a regression against a documented principle. The other agent rebuilt transactions to record ordered steps, which lets structural changes join one, and in doing so found a **latent bug that could not previously fire**: aborting a compound transaction now rolls back frames as well as pixels, where before a failed multi-frame build would have left orphan frames behind.

## Wiring — UI tranche 2

The four dead engines now produce real assets.

### Verified in the browser

**Contextual asset panel**, scoped by type the same way the tool registry is — a tile shows Autotile, a character shows Directions and Skeleton, neither sees the other's.

**Autotile** — derived 47 tiles by composition into a 256×192 sheet, added to the library as a `tileset` asset. No model involved, so every tile shares one texture.

**Directions** — mirrored `side2` into a new asset, provenance reported.

**Skeleton** — estimated from the silhouette and drawn over the canvas as joint markers, projected through the sprite's content bounds since poses are normalised.

**Reference upload** — decodes a file, runs the pixelisation pipeline, and builds directions through the phase-10 chain.

### Two bugs found by using it

1. **Nothing could create a `character` asset.** The library's New-asset control only chose a preset and always defaulted the type to `tile`, so the Directions and Skeleton panels were unreachable no matter what. Added a type selector — `tileset` is excluded, since it is derived rather than authored.

2. **The direction plan promised assets it could not produce.** The panel first reported "1 by mirroring" for `cardinal4`, taken from `planDirectionSet`. That plan is written assuming every generation succeeds, so it counts `west` as mirrorable because `east` will exist by then — but with no generator `east` never arrives and `west` is unreachable too. Clicking produced zero. Added `mirrorableFrom`, which resolves mirrors to a fixed point over *actually present* directions, with a test asserting the two numbers disagree precisely in this case. The panel now says "All 3 need a model — nothing to mirror from a single north sprite. With generation, 2 calls would cover the set."

## Wiring — UI tranche 3 (API-to-UI sweep)

Audited every API endpoint, every engine and every UI surface for orphans.

### Gaps found and closed

**Core's hardware palettes were unreachable.** `BUILTIN_PALETTES` — Game Boy DMG and PICO-8 — shipped in `@zenith/core` at phase 01 and nothing in the app ever referenced them. The palette panel was selection-only: no editing, no swapping. Added a palette swap offering both the core palettes and the editor presets.

**`lib/transform` had zero consumers.** Rotate and readability are now in the asset panel.

**`session.recolor` and `session.reshape`.** The store deliberately has no palette setter and forbids dimension changes — those are document invariants, not fields — so palette swap, rotate and resize rebuild the document instead. The cost is that undo history does not survive, and every one of those operations says so in its result rather than letting the user discover it.

### Three bugs, all mine, all silent

1. **Nothing could create a `character` asset**, so the Directions and Skeleton panels were unreachable no matter what was built. The New-asset control chose a preset and always defaulted the type to `tile`.

2. **The direction panel promised assets it could not produce.** It read "1 by mirroring" for `cardinal4` from `planDirectionSet`, which assumes every generation succeeds — so it counts `west` as mirrorable because `east` will exist by then. With no generator `east` never arrives and `west` is unreachable too, and clicking produced zero. Added `mirrorableFrom`, which resolves mirrors to a fixed point over directions actually present, plus a test asserting the two numbers disagree precisely in this case.

3. **A replaced store left the whole editor stale.** `recolor` swaps the `DocumentStore` object, and every component holding the old reference stayed subscribed to something nobody writes to again — the tile preview updated while the canvas and palette showed the previous colours. Fixed by keying the editor on a per-asset generation counter. The first attempt at that was itself wrong: `#replace` deletes the entry before re-inserting, so reading the old generation inside `#insert` always saw 0 and the key never changed. The counter is now threaded through explicitly.

The third is the one worth remembering: it only surfaced because I read the rendered swatch colours rather than trusting a success message that was itself accurate.

## Wiring — UI tranche 4 (image import and asset creation)

### Gaps found and closed

**Uploading an image ran the wrong thing.** The only upload path was "From reference", which runs the whole concept-to-character chain and produces a direction set. Someone dropping in a PNG usually wants *one sprite they can draw on* — the chain is the special case, not the default. Added `importImageAsAsset`: pixelise, keep the extracted palette, create one editable asset. Verified end to end — a 128×128 four-colour PNG imported to 16×16 with exactly its four source colours, and the canvas accepted a stroke afterwards.

**Size was welded to the palette.** Creating an asset offered only the five canvas presets, so 8×8 was impossible and "8×8 with the PICO-8 palette" was not expressible at all. Size and palette are genuinely independent, and a preset list cannot cover the combinations.

Replaced the inline controls with a **New Asset dialog**: name, type, size (8/16/24/32/48/64/96/128 plus a validated custom field, 4–256), palette (core's hardware palettes and the editor presets), and two create paths — blank, or from an image. Verified: an 8×8 asset creates and the canvas auto-fits it at 32×.

The dialog states plainly that an imported image keeps the palette the pipeline extracts rather than the one selected above — the alternative was letting people pick a palette that is then silently ignored.

## Wiring — palette colour and brush opacity

Palette editing now offers a visual colour picker alongside the existing exact hex input. Pencil and eraser opacity is selectable from 0–100% in 25% steps; because the document format deliberately permits only opaque or transparent indexed pixels, lower opacity uses ordered dither coverage instead of introducing invalid partial alpha. Verified by the pixel test suite (28 passing, including exact 0%, 50%, and 100% coverage) and web lint.

## Cross-cutting

- [ ] **`apps/api` is still the starter's hello-world.** One route, empty `schema.ts`, nothing wired to the frontend. Correct until [phase 06](./phases/06-generation-pixelisation.md), but worth stating so nobody assumes a backend exists.
- [ ] **Auth is dead code.** `next-auth` and Google OAuth are configured and unused. Our whole no-login argument says judges should not hit a signup wall, so this should be removed or deliberately kept for the demo credentials on the landing page.
- [ ] **Landing page palette still competes with the artwork.** The starter's warm `bone parchment / clay` set contradicts the design language ([`idea.md` §6](./idea.md)), which calls for near-neutral low-chroma chrome so the art is the only saturated thing on screen.
- [ ] **Demo credentials (`demo` / `test123`) are shown on the landing page but nothing consumes them.** No auth flow is wired to them.
- [ ] **`next-themes` logs a console error on every load.** *"Encountered a script tag while rendering React component"* — the library injects a blocking script to set the theme before paint, and React 19 warns about it. Functionally harmless, but [`requirements.md` §6](./requirements.md) requires no console errors on load, so it is a submission item. The fix is to replace `next-themes` with an inline `<head>` script, which is the standard pattern; not done because the user was away and theming works.
- [x] **`/v1/generate` rate limiting.** Per-client *and* global windows, metered before the key check so a refused request costs nothing; 429 with `Retry-After`. Defaults 10/hr per client and 60/hr global for generate, 60/400 for chat. The global cap is the one that actually bounds the bill — per-IP does nothing against a spread of addresses. Verified by 11 tests including the memory bound under a stream of unique IPs. **Still unauthenticated**, which is deliberate (no login wall for judges), so the caps are the only thing between a public URL and the bill.
- [ ] **Deployment is unverified.** Nothing has been deployed to Vercel or Cloud Run. CORS, `min-instances: 1`, and the cold-start path in [`idea.md` §12](./idea.md) are all designed but untested.

---

## Collaborative chat (human + agent on one canvas)

Verified in the browser against real gpt-5, on the Cobblestone tile.

- [x] **Chat edits the live canvas.** "Fill my selected region with solid black" → `read_canvas` → `fill_region` → the pixels changed under the marquee while the editor stayed interactive. Tool calls run through the existing `runTool`, so they land in the same transcript and on the same undo stack as a human edit — no second code path.
- [x] **The model reasons from the palette, not from instructions.** Asked for "the darkest colour" it read the palette and chose index 0 on its own. That is the indexed-grid thesis working end to end.
- [x] **Selection becomes context.** `selectionContext()` in [`lib/editor/selection-context.ts`](../apps/web/src/lib/editor/selection-context.ts) encodes the selected region in the same one-character-per-pixel format as `read_canvas`, with the palette folded in — a region of indices is meaningless without knowing what `3` and `9` are. Folded into the user's turn, not the system prompt, so a stale region is not carried through history.
- [x] **Select tool and brush size.** Marquee (`M`) with marching ants; brush sizes 1–8 for pencil and eraser, verified by drawing a 4px-wide stroke.
- [x] **Enter sends, Shift+Enter newlines.** Verified: draft cleared and the model replied.
- [x] **Undo covers the agent.** One press took back a whole agent fill, because the agent's writes are ordinary transactions.

**Bug found and fixed during this verification.** `AgentConsole` took `selection?: Region | null` with a `null` default, and *both* mount points in `editor-workspace.tsx` omitted it. The chat typechecked, ran, and told the model there was no selection on every message while a marquee sat on the canvas — the model replied *"I can't read your selection."* The prop is now required, so omitting it is a compile error rather than a silent lie. This is the same failure shape as the route/session divergence in [`AGENTS.md`](../AGENTS.md): an optional prop with a plausible default makes a broken wire indistinguishable from a working one.

- [ ] **Undo does not survive a page reload.** History is in memory; the grid is persisted. Correct as designed, but it means a reload strands any agent edit as permanent. Worth stating before the demo.

---

## Asset generation tools

Six previously-deferred authoring tools now registered in [`lib/webmcp/tools/authoring.ts`](../apps/web/src/lib/webmcp/tools/authoring.ts), each a thin wrapper over library code the human UI already calls, so agent and human reach one implementation. 13 tests in `authoring.test.ts`.

- [x] **`generate_tileset`** — the 47-tile blob set from one tile, by composition. Verified through chat: "Derived 47 tiles by composition into a 256x192 sheet."
- [x] **`set_palette`** — perceptual Oklab remap into a named or explicit palette. Verified: "Recoloured to 'Game Boy DMG' (4 colours)."
- [x] **`estimate_skeleton`**, **`list_pose_templates`** — read-only. Verified on a character built from an uploaded reference; the model chose `get_silhouette` first on its own.
- [x] **`import_image`** — base64 PNG in, editable indexed art out. Browser-only by design (`decodeBase64Png`), and it says so rather than throwing.
- [x] **`build_character_from_reference` semantic preprocessing** — performs one paid extraction edit before local framing and pixelisation, rather than quantising the entire uploaded scene. Verified end to end on five materially different public-domain references (armour photograph, flat knight illustration, crowded book engraving, lunar photograph, and action line art): each produced one isolated transparent character and a 32×32, 16-colour indexed grid. The run also exposed the honest remaining limitation: extraction can creatively colour or embellish monochrome references, so it preserves character role and silhouette more reliably than exact source palette or fine design details.

**Anatomy-first extraction prompt landed; live image benchmark pending.** The previous prompt gave full clothing and every distinctive detail the same priority as the body, so busy costume masses survived while human landmarks collapsed. The shared extraction prompt now orders the reconstruction explicitly: body plan and gesture → separated limbs and silhouette → outfit/equipment wrapped around the body → one or two signature details. When costume fidelity conflicts with readability at the target size, anatomy wins; small folds, textures and ornament are compressed instead of copied literally. Both the upload UI and WebMCP reference tool share this prompt. Its ordering and absence of the old unconditional clothing-preservation clause are guard-tested, but the quality claim remains open until a fresh real-model reference set is compared.
- [x] Four of them added to `CHAT_TOOL_NAMES` by the owning agent's criterion — deterministic, free, and things a human asks for in a sentence.

### Image → editable pixel art, verified end to end

A 160×160 anti-aliased knight with 46 distinct colours (deliberately not pixel art) through the direct import path became **32×32, 14 colours, input classified "soft"**, opened as a character with directions and skeleton available, and took a pencil stroke immediately. This verifies importing an already-isolated subject; scene-to-character extraction is tracked separately above.

### Text → character, verified end to end

`generate_asset` from the landing prompt produced a recognisable 32×32 knight, open and editable.

**Bug found and fixed: every generated asset was a tile.** The landing prompt sent only `prompt`, and `generate_asset` defaults to `tile` — so a generated *character* got autotiling instead of directions and a skeleton, and every character-scoped tool (`estimate_skeleton`, `get_directions`, `derive_direction_by_mirror`, `generate_direction_set`) was invisible on the asset they exist for. The character workflow was unreachable from characters. The type now travels with the prompt and is chosen in the UI rather than guessed from wording. Re-verified: the same prompt now yields DIRECTIONS and SKELETON and no AUTOTILE.

**Bug found and fixed: creating an asset silently killed the agent surface.** `session.create()` unconditionally reassigns `activeId`. Right when the human asked for a new asset, wrong when one is a by-product — deriving a tileset from a tile does not mean you stopped working on the tile. `activeId` followed the new sheet, the route stayed put, and `readScopeContext` correctly read the disagreement as "no asset open": the console dropped from 66 tools to 14 and the composer said there was nothing to edit, with nothing thrown anywhere. This is the [`AGENTS.md`](../AGENTS.md) route/session hazard reached through *creation* rather than `close()`, a path not previously written down. `preservingActiveAsset()` wraps the three by-product generators; `generators.test.ts` pins it and fails without the fix.

- [ ] **Generation takes ~115–125 seconds, and the UI says "20–40 seconds."** Measured twice: 122.6s and 114.3s. The estimate is wrong by 3×, on the slowest thing in the product, where a user has nothing to look at. Either the copy or the model call needs to change before anyone demos this.

---

## Character generation quality

The complaint was that generated characters look bad. Measured against a raw 1024x1024 generation pulled straight off `/v1/generate`, the model was not the problem — **gpt-image-2 returns genuinely good pixel art**. Three things downstream were destroying it.

**The background was opaque.** The prompt said "plain transparent *or* flat single-colour background" and the model took the second option every time: the response had three channels, no alpha at all, and a background of `rgb(63,104,251)` — within about 40 RGB of the knight's own blue armour. Every generated character had its background baked in, which makes it unusable as a game sprite regardless of how good the art is.

**The subject filled 47% of the frame.** Measured at 485x705 of 1024x1024. `pixelize` divides the *whole* frame into a uniform grid, so at 32 cells the character was drawn in **15x22** and seventeen of the thirty-two columns were background. Under half the linear resolution the canvas offers — that is the muddiness.

**11,168 distinct colours, most common horizontal run length one pixel.** It looks blocky but is soft at byte level, so there is no clean native grid for the detector to lock onto.

### Fixed

- [x] **The model is now asked for transparency directly** — `background: "transparent"` and `output_format: "png"` passed to `images.generate` rather than hoped for in prose, and the prompt asks for one background instead of offering a choice. Verified: colour type went from 2 (RGB, no alpha) to 6 (RGBA), 54% of pixels at alpha 0, and the alpha histogram is cleanly bimodal — 54% at zero, 45% at 224-255 — so binarisation has an easy job.
- [x] **The prompt asks the subject to fill the frame.** Verified: coverage went from 47% to **90% of frame width**.
- [x] **Framing before pixelisation** — [`lib/pixelize/subject.ts`](../apps/web/src/lib/pixelize/subject.ts) flood-fills the background from the border, crops to the subject, and scales it to fill the canvas preserving aspect, sitting on the bottom edge. Bottom-anchored because sprites share a ground line. Measured on the real baseline generation: **15x22 cells of subject before, 22x32 after — 2.1x the pixels the character actually gets.**
- [x] Flood fill rather than a global "near the background colour" test, specifically because the armour was 40 RGB from its background and a colour test punched holes through it. Connectivity is what separates the background from pixels that merely resemble it.
- [x] **`quality` defaults to medium, not high.** Timed on the same prompt: **high 156.6s, medium 52.6s**. Three times faster, and the medium image was *better* for this purpose — the subject filled 95% of the frame against 78%, with identical byte-level softness. The output keeps roughly 0.1% of a 1024x1024 generation's pixels, so detail bought at "high" is detail the resampler averages away. Exposed as a validated body param for anyone who wants to pay for it.
- [x] **Generation asks for the right kind of background.** `kind: "sprite" | "texture"`, wired from the asset type, matching the distinction the derive route already made. A tile asked for transparency invites the model to punch holes in something meant to be solid — the same asymmetry that gates the framing.

**End-to-end result, both pipelines run headlessly over the same prompt and canvas:** the old path filled **100% of cells** — the character was a small blob in a field of opaque background it could never shed. The new path fills **57%**, the rest genuinely transparent, with the subject spanning the full grid and the helmet, plume, shield and sword all legible at 32x32.

**Framing runs only for `character`, `item` and `ui` — never `tile` or `texture`.** A tile legitimately fills its frame and has no background: the fill would start on real artwork and eat any mortar line touching the edge, and the coverage check would accept the holed result because it is still tightly bounded. There is a test named for that.

## Export

- [x] **A transparent sprite exports correctly and is usable.** Verified at the byte level through the real UI download path, not just in a unit test: colour type 3 (indexed), `PLTE` + `tRNS` chunks present, exactly one fully transparent palette entry, 1208 bytes for a 32x32 character. Scaling to 8x preserves it.
- [x] **Engine bundles set the flags that matter.** Godot gets `filter=false`, `mipmaps/generate=false` and `fix_alpha_border=true` (which is what stops dark haloes around transparent edges); Unity gets `filterMode: 0` (Point) and no texture compression; LÖVE gets nearest filtering.
- Before the generation fix, a *generated* character exported with its background baked in — the export was correct, the asset was not.

---

## Quality batch — 40 generations, scored through the real pipeline

20 characters and 20 textures generated against `/v1/generate`, then run through the shipping client path (`frameToCanvas` then `pixelize` at 32x32, 16 colours). Every number below comes from that path, not a parallel measurement.

### Characters: 20 of 20 usable

All 20 came back with a genuine transparent background (30-67% of cells clear), all 16 palette slots used, and 0-1 isolated pixels — no quantisation mush. Nine needed the framing step (source coverage 58-90%); eleven were already tight enough that framing correctly declined. **The generation fix generalises: it was not fitted to one knight.**

### Textures: the fix that mattered was feature scale, not seams

The first 20 all passed transparency (0% clear, correctly solid) and all scored 0-6 seam mismatches of 64. They still looked like static.

**The metric that found it was mean horizontal run length** — how long a stretch of identical palette indices lasts. Nineteen of twenty scored **1.07-1.32**, meaning essentially every neighbouring pixel differs. That is dithered noise, not pixel art, and no other metric could see it: transparency, palette count and seam checks were all clean.

**The cause was not the model.** The raw 1024x1024 cobblestone was excellent — flat grey stones, dark mortar, clean edges — but it contained about 40 stones across the width. Downsampled to 32 cells, each output cell averages a whole stone *and* its mortar, so the structure dissolves. The features were too fine for the target grid.

**The fix is in the prompt**: textures now ask for "at most 8 distinct shapes across the full width, each filled with a single flat colour". Eight features across 32 cells leaves four cells per feature, which survives downsampling as a flat region. Re-measured on seven textures:

| texture | run before | run after |
| --- | --- | --- |
| planks | 1.20 | **2.66** |
| brick | 1.32 | **2.19** |
| lava | 1.11 | **1.86** |
| sand | 1.14 | **1.53** |
| cobblestone | 1.31 | **1.39** |
| grass | 1.12 | **1.39** |
| water | 1.14 | **1.37** |

Mean 1.19 → 1.77. Visually: cobblestone gains stones, brick gains courses, planks gain planks, lava gains a dark crust.

- [ ] **Chunkier textures tile worse.** The trade-off is real and measured: brick's seam mismatches went 4 → 18, planks 1 → 11, cobblestone 3 → 9. Larger features mean the wrap is more likely to cut through one. `generate_tileset` exists for this, but nothing currently tells a user which trade they are making.

### Two cautions about the scoring itself

- **`checkSeamlessTiling`'s boolean is unreliable at 16 colours.** On textures that tile *by construction* it reports "not seamless" for 2/25 at four colours but 14/25 at sixteen, because it accepts a seam pairing only if that pairing also occurs in the interior, and a 16-colour palette has 256 possible pairs against ~992 interior samples. Read the mismatch count, not the boolean: 0-2 is noise, a whole edge (32) is a real seam.
- **A good seam score on a noise field means nothing**, because noise tiles trivially. The first 20 textures scored 0-6 mismatches while looking like static. Seam quality and texture quality are close to independent.

- [x] **An unconfigured deployment fails fast and free.** 40 concurrent requests to an instance with no `OPENAI_API_KEY` all returned 503 `generation_unconfigured` in about a second, before any upstream call. Verified by accident and worth keeping.

---

## Generation prompt grounding — SpriteCook review

Reviewed the MIT-licensed [SpriteCook agent skills](https://github.com/SpriteCook/skills) for workflow ideas; no code or API shapes were copied.

- [x] New sprites explicitly prioritise subject, pose, view angle and key materials, while refusing unrequested props, weapons, effects and secondary subjects.
- [x] Texture prompts are material-only and exclude props, characters, labels, UI and scene composition.
- [x] Derivations treat the source as canonical, change only named traits, and keep unmentioned equipment and design features recognisable without weakening the separate rotate/pose clauses.
- [x] Animation pose planning now names what moves, what stays stable and how visible equipment behaves, without inventing gear or effects.
- [x] Fixed an existing contradiction found during the review: `generate_isometric_tile` requested transparency in prose but `generate_asset` classified every tile as an opaque texture. The tool now passes an explicit transparent composition, which also selects sprite framing.

Prompt-builder tests pin each clause and, critically, assert that rotate and pose instructions still override the general preservation rule.

---

## Phase 14 — Projects ✅

All six exit criteria are verified.

**Workspaces were removed on 2026-09-02**, at the product's request: an asset now
has one place, its folder. The two criteria they carried — a 200-asset infinite
canvas and an even eight-item ring — are **withdrawn, not failed**; both were
verified before the feature was cut, and the code, tools and tests they covered
are gone. What replaced them is the criterion below about opening a project.

| Criterion | Evidence |
| --- | --- |
| Off-style assets report actionable violations | Core tests assert every out-of-palette coordinate and exact expected/actual sizes. Partial alpha cannot enter the indexed grid; invariant tests reject it before project checks. |
| Deterministic conformance | Core and session tests cover perceptual palette remapping, crop/pad across every frame, idempotence, and repeated-input byte equality. |
| Palette changes name exactly the newly violating assets | `project-tools.test.ts` changes the contract and pins the exact asset ids returned. |
| Agent check → conform → re-check | The WebMCP integration test starts with wrong colours and size, conforms the project, and reaches a clean report unaided. |
| Opening a project shows its files and its assets | Verified live in the browser on 2026-09-02. Creating a project routes to `/project/[id]`; the explorer sidebar lists its folders and assets and the main pane shows every asset in it. Dragging an asset onto a folder places it there and expands the folder; dragging it back to empty space returns it to the project root. Both drops were confirmed by reading the tree back, not by watching the highlight. |
| Loose assets remain valid | Model regression test and live browser flow keep assets without project placement available and editable. |

Also verified live: project creation and persistence, project switcher, inline project and asset renaming from the explorer, the complete style editor and violation badges, and zero browser console errors. The project export test proves the bundle contains only project assets plus style, folders and placements.

**A real bug the drop fix caught.** A folder row and the root container were both
drop targets, and the folder's handler did not stop the event. The parent's ran
second and won, so *every* drop into a folder silently placed the asset at the
project root — the drag looked like it worked and quietly did something else.
Folder blocks now stop propagation, and both directions were re-checked by
reading the tree back.

### Preserved structural guards

- `moveFolder` refuses descendant cycles.
- `deleteProject` unplaces artwork instead of deleting it.
- `deleteFolder` refuses while occupied and returns the blocking counts.
- IndexedDB v1 → v2 preserves legacy asset records byte-identically while adding project state.

---

## The chest run: 10 variants x 4 angles

31 generations — one base chest, 10 material variants derived from it, and 2 turned views per variant with the third mirrored free. Everything scored through the shipping pipeline.

**Variants are strong.** Mean palette overlap with the base is **70%** — a shared colour language with room for each variant's own identity (frozen sits at 13%, correctly, because ice blue is a deliberate departure). All ten read as the same game's art: same three-quarter view, same outline weight, same chunky cluster scale.

**Angles were broken, and the batch is what exposed it.** Palette overlap between a variant and its turned views measured **91%**, which looked excellent and meant nothing: the "turned" views were the *same view*. Ten chests asked for a side and a back came back as ten unchanged three-quarter views.

- [x] **Root cause: `buildDerivePrompt` hard-coded "Preserve the subject's ... camera angle"**, unconditionally, while `rotate_character` asked the same endpoint to "redraw the same character facing east". The base prompt is more specific and wins, so every direction tool produced the source view filed under a direction it did not depict — `rotate_character`, `generate_direction_set`, and the whole concept-to-character chain. Nothing errored, and the library filled with "Knight east" assets that were all the front view.
- [x] **Fixed with an explicit `mode` on `/v1/derive`**: `vary` keeps the angle and changes the subject; `rotate` does the reverse. Verified — the knight now comes back genuinely turned, cape covering the back, helmet from behind, shield on the far side, same palette.

**This is the third instance of one pattern**: a general instruction silently overriding the specific one it was meant to support. The others were "fill the frame" clipping compact subjects, and "features too fine for the target grid". All three were invisible to every metric and only visible in the output.

- [x] **Sprite framing no longer clips.** "Filling the frame edge to edge with no margin" fixed floating characters and then over-corrected: a chest came back cropped on all four sides. Now "drawn large so it nearly fills the frame, complete and entirely visible with a small even margin — never cropped". Framing crops the margin afterwards anyway, so a small one costs nothing and clipping is unrecoverable.

## Animation from a description

- [x] **`animate_with_text` now exists.** It was in the tool catalog from the start and had never been implemented, so the only animation available was the six procedural presets — bob, sway, pulse, flicker, blink, scroll. Every one transforms a *single* drawing, which covers an idle bob and nothing else. A run cycle, a weapon draw, a slice and a stomp all need frames that were never drawn.
- [x] **Poses are planned before any image is bought.** One cheap text call breaks the motion into per-frame pose descriptions; a phase fraction ("40% through the motion") produces frames that differ arbitrarily, because nothing tells an image model what 40% of a weapon draw looks like. Verified: asked for a 4-frame run cycle it returned contact and airborne poses with correct limb opposition and an explicit loop back to frame one.
- [x] **`mode: "pose"`** — the same camera-clause fix as rotation, for the same reason: the default prompt preserves the pose, which is the one thing an animation frame must change.
- [x] Verified end to end: four frames of a knight run cycle, visibly different poses, same armour, shield, sword and palette throughout. One transaction, so the cycle is a single undo.
- [ ] The frames read as four distinct action stances rather than a polished run cycle. Usable, and far better than nothing, but not yet animator-quality.

- [x] **A test run cannot spend money.** `paid()` refuses outright when `NODE_ENV` is "test", so every paid call is guarded at the one place they all pass through rather than in each test, where it can be forgotten — and had been, twice. A test that genuinely needs the path opts in explicitly and fails closed.
- [x] **Undeclared paid tools are caught behaviourally**, by running them and checking whether they hit the guard. A name pattern cannot catch delegation: `generate_texture` and `generate_isometric_tile` both call `generate_asset.execute` and declared nothing, so their names said nothing about what they spent.
- [x] **Pose planning goes through the guard too.** `describePoses` calls the chat model, so it is a paid call even though it buys text rather than an image, and a raw fetch would have been the same delegation hole one level down. Verified by removing `animate_with_text`'s declaration and watching the behavioural test name it — refused in 31ms rather than buying an image.
- [x] **Rotation routed through `mode: "rotate"`.** The endpoint supported it before the direction tools used it; they now pass it explicitly, as does `deriveVariant` for `"vary"` — relying on a default that has just changed meaning is how the original bug gets made twice.

## Transparency, measured

Asked whether generated assets are actually transparent, since the previews look like they have a dark glow:

- The **raw generation** is transparent — corner pixel alpha 0, and the alpha histogram is cleanly bimodal (20% at 0-31, 80% at 224-255) with nothing in between.
- The **final asset** has **zero partial-alpha pixels**: fully opaque or fully transparent, which is invariant 2 holding.
- The glow is the *viewer* compositing transparent pixels against a dark page. There is no halo in the asset.
- If a rim ever is painted in, `remove_background`, `replace_color` and the eraser all remove it.

---

## Submission checklist gaps

From [`requirements.md` §6](./requirements.md), the items not yet true:

- [x] `LICENSE` (MIT) at repo root. Written under a stated assumption — `Copyright (c) 2026 Zenith Studio` — because a missing licence fails Stage One screening before a judge opens the repo, and GitHub detects MIT regardless of the holder line. **Changing that one line to the real holder is a ten-second edit and nothing depends on it.**
- [x] `NOTICE` with every attribution verified rather than assumed: no PixelRefiner code ported, `use-webmcp-tool` explicitly listed as NOT used since it is no longer a dependency, RotSprite recorded as implemented from Xenowhirl's published description, Geist under OFL-1.1.
- [x] `README.md` describing the product, the thesis, setup, and how to enable WebMCP in Chrome.
- [ ] Live URL deployed and reachable
- [ ] Demo video (under 3 minutes, audio, public YouTube)
- [ ] Devpost description covering why WebMCP fits, the UX improvement, and implementation details

- [ ] **Reset the dev rate limits before deploying.** They are running at 120/client and 200/global for a quality batch; the shipped defaults are 10 and 60.
- [ ] **Rotate the OpenAI key** after the demo.

*Correction:* this section listed `LICENSE` and `README` as missing for several turns after they were written. The claim was carried forward from an earlier message rather than re-checked against the repo — the same failure as trusting a green test without asking whether it still fires.
