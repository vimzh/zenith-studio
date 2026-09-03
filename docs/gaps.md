# Gaps

Live tracking of what is **actually** done versus what a phase claims. Updated as work lands.

> **Historical engineering log:** later sections preserve earlier audit snapshots and may describe gaps that have since closed. For current hackathon release status, use [`submission-readiness.md`](./submission-readiness.md); for the implemented tool surface, use [`tools.md`](./tools.md).

> Companion docs: [`phases/`](./phases/README.md) (the plan and its exit criteria) · [`idea.md`](./idea.md) · [`requirements.md`](./requirements.md) · [`tools.md`](./tools.md)

**Rule for this file:** a criterion is only ticked when it has been *verified*, not when the code that should satisfy it exists. Anything verified by proxy (a stub, a reasoned argument) says so.

Last updated: 2026-09-03.

## 2026-09-03 — WebMCP discovery budget includes the deployed origin

- [x] Reproduced direct WebMCP discovery disabling itself after the Moss Hollow character gained animation frames. The same 93-tool catalog serialized to 63,378 bytes on localhost but 67,284 bytes on Cloud Run: discovery repeats origin/page URL per tool, which the localhost-only budget test missed.
- [x] Shortened redundant description prose without removing tools, arguments, scope, or handlers. The deployed animated-character catalog is now 62,496 bytes. The 62 KiB regression budget covers localhost and the actual Cloud Run origin across all asset types and static/animated views; four deployed-origin cases failed before the fix and all pass after it.
- [x] `bun test`: 1,038 passed; `bun run lint`, `bun run typecheck`, and `bun run build` passed. Deployed web-only revision `zenith-web-00003-q5t` and verified native browser discovery accepts all 93 animated-character tools on the demo origin after reconnect/reload.
- [x] Replayed the original export through direct WebMCP: `export_animation` at 4× without timing overrides, `export_project`, and two `read_export` chunks per file through `eof=true`. Saved `moss-knight-idle.gif` (61,625 bytes) and `moss-hollow.zenith.json` (69,897 bytes) in the workspace. An independent GIF block read confirmed 512×512, four frames, and four 250 ms holds; the backup contains the original 128×128 character and all four frames. `flush_storage` confirmed local transactions. No tool-console fallback was used for these exports.


## 2026-09-03 — Composed image prompts no longer hit the 1,000-character cap

- [x] Generation and derive/edit requests accept 16,000 characters including client-appended style text, with matching browser/API guards and received-length errors. No truncation.
- [x] The original Moss Knight request reproduces the old failure: 1,149 characters after project-style composition. Regression tests failed on the old guards and pass after the fix, including 16,000/16,001 boundaries and validation before batched paid calls.
- [x] Animation sheets preserve long motion descriptions instead of replacing them with a generic placeholder. The planner's separate 10,000-character description cap is unchanged.
- [x] Real local HTTP replay with the model key deliberately absent: original composed prompt and 16,000 characters reach `generation_unconfigured` (503); 16,001 returns `invalid_argument` (400). This verifies validation, not a new paid image generation; existing artwork was untouched.

Scope: the landing page's 500-character quick-start input is unchanged; this fixes the shared generation/edit transport used by the studio and WebMCP.

Verification: 1,025 workspace tests pass (180 core, 79 API, 766 web), plus lint, typecheck and production build. The final focused replay passes 59 tests. Local web `/home` and API `/health` return 200. `git diff --check` still reports pre-existing trailing whitespace on the removed/folded skeleton-tool rows in `docs/tools.md`; those unrelated edits were preserved.

## 2026-09-03 — Loop timing: a rest beat, and a speed for sharing

The user sent the showcase GIFs to a friend and found them too fast. Two causes:

- [x] **The showcase bench wrote GIFs at a flat 120ms per frame**, ignoring the
  planner's holds — a five-frame jab looped every 600ms. Bench bug, not the
  pipeline; the product's `export_animation` already used authored timing.
  The bench now writes the planner's holds and a `cycle-share.gif` at half speed.
- [x] **A looping preview needs a beat the game gets for free.** In a game an
  attack plays once and returns to idle; a loop restarts the instant it lands.
  The planner now returns `rest` (100–1200ms, long for a one-shot action, an
  ordinary hold for a continuous cycle) and the tool applies it to the source
  frame when that frame still has the default 250ms hold — a frame the human
  timed keeps its timing — inside the same undo entry, and says so.
- [x] **`export_animation` takes `speed` (0.25–4).** Authored holds are game
  timing; 0.5 doubles every hold for a GIF that loops unattended in a chat,
  without retiming the asset. The export dialog does not expose it yet.

The showcase page now plays loops at half speed with the rest beat and has a
"Game speed" switch; `output/showcase/*/*/frames.json` records both delay sets.

## 2026-09-03 — Text animation v3: speed, measured

The user asked for the pipeline to be fast without losing quality. Local work
was measured first and dismissed: decoding a sheet is 61ms, cutting it 1ms,
pixelising a cell 40ms, compressing a sheet 3ms. Every second is in the four
model calls, so the levers are model settings and concurrency
(`scripts/animate-speed.ts`, `output/animation-bench/*/speed.json`).

| Lever | Before | After | Quality |
| --- | --- | --- | --- |
| Planner reasoning (same warrior plan) | default, 69.0s | `low`, 24.9s | same source reading, same four-stage plan, effects placed |
| Judge reasoning (same strip) | default, 28.1s | `low`, 10.4s | same 4/4 verdict |
| `minimal` reasoning | — | plan 5.4s, judge 2.4s | **rejected**: judge falsely failed a frame, which buys a 115s repair |
| gpt-5-mini at `low` | — | plan 8.8s, judge 6.5s | **rejected**: planner invented sparkles; judge falsely failed a frame |
| Sheet quality (same warrior plan) | `high`, 115s | `medium`, 52s | **rejected**: an unrequested arc on the wind-up, a clipped trail, one repair bought and one frame still rejected — net time equal, output worse |
| Two sheets (8 frames at 128px) | sequential, ~230s | one concurrent batch, 159s | identical per-sheet output; the paid slot is held once for the batch, so a rival action is still refused |
| Direction set (ordinal8 from south) | 3–4 turned views one after another | one concurrent batch | same prompts; a failed view is reported while the others are kept |

- [x] `/v1/chat` accepts `reasoning` and `verbosity`; the planner and judge send
  `low`/`low`. The assistant loop keeps the defaults — a tool-using
  conversation is where reasoning earns its time.
- [x] `paidAll` holds a category's slot once for a batch of concurrent requests
  and returns settled results in order. `deriveAnimationSheets`,
  `deriveImages` and `deriveFromSources` are built on it; `animate_with_text`
  buys a cycle's sheets together and `generate_direction_set` buys its turned
  views together, mirroring partners afterwards.
- [x] A blank cell is a rejection the judge never saw: it now joins the repair
  batch instead of silently shortening the cycle. Found live — the 8-frame
  combo's first sheet came back with its sixth cell empty and the cross
  extension was missing from the loop. The sheet prompt now also says every
  cell in the frame range must contain its frame.
- [x] The second judge pass rules only on repaired frames. A judge asked twice
  about an unchanged frame can answer differently (it did: a follow-through
  passed, then failed after another frame's repair); a frame that passed once
  and was never touched has not become wrong.

**Measured end to end at the new defaults**, 128px boxer, effects on, judge on:

| Cycle | Plan | Sheets | Judge | Repair | Total |
| --- | --- | --- | --- | --- | --- |
| 4 frames (v2 numbers, default reasoning) | 52s | 112s | 26s | none | ~190s |
| 4 frames (v3 settings) | ~25s | ~115s | ~10s | none | ~150s |
| 8 frames, two sheets concurrent | 25s | 159s | 13–18s | 152s + 11s (one blank cell plus two frames with unplanned streaks, redrawn together; final 8/8) | ~365s |

**Still open:** the image call is now three quarters of a clean run and cannot
be made faster without the quality loss measured above. Concurrency gives
about 1.4× for two sheets, not 2×, because the two requests share the model's
throughput. A repair is a second full image; the judge at `low` has not yet
produced a false rejection in four runs, but it is a model.


## 2026-09-03 — Agent-first WebMCP input/output

The main workflow now supports external browser agents without using the built-in
chat. See [the protocol guide](./agent-workflow.md) and
[verification record](./verification/agent-io-2026-09-03.md).

- [x] Native in-app-browser WebMCP discovery and calls work with 94 tools on an
  animated character. The previous oversized catalog was rejected by the browser;
  shorter descriptions and a per-scope payload regression test address that failure
  without removing tools. Library scope exposes 32 tools.
- [x] Agents can retrieve complete PNG, GIF, spritesheet, engine and palette files
  as bounded base64 chunks, not just trigger a human download. Live PNG, GIF,
  spritesheet and Phaser bundle bytes were saved and inspected; the other existing
  engine/palette formats have automated export coverage, not engine-runtime proof.
- [x] Project/folder organization, additive backup import with fresh IDs, reference
  remapping and local save confirmation are exposed as tools. Live export/import
  preserved every serialized document after expected ID remapping. Reload restored
  the correct asset **and its project**, with four animation frames intact.
- [x] Source-asset concept input avoids making agents round-trip base64 themselves.
  Validation and source preservation are tested with mocked generation; no new paid
  concept generation was performed for this verification.
- [x] Long paid tools have start/poll jobs and same-request-ID retry protection.
  A live invalid-source job failed before a paid call and its retry returned the same
  job; successful asynchronous completion and concurrency guards have unit coverage.
- [x] Save checks await in-flight writes and reject concurrent document edits.
  Moving/deleting a style reference cleans the shared project model; deletion undo
  restores it. Legacy stale references fail backup preflight with a tool-based
  repair path. Regression tests cover these cases.
- [x] Root lint, typecheck and production build passed; the full test run passed
  **976 tests** (178 core, 76 API, 722 web).

**Boundaries:** this remains live-tab WebMCP, not a standalone headless/cloud MCP
server. Files and job IDs are page-session-local; IndexedDB saves are browser-local.
This pass verifies the agent handoff and persistence, not every model's visual
quality or every game engine's import behavior.

## 2026-09-03 — Text animation v2: the planner sees, the judge checks, effects get colours

The user's second ask: make the animations "super accurate, valid and
consistent" and "more magical" — air-cut arcs, purple trails. Five changes,
each measured live (`scripts/animate-bench.ts`, outputs under
[`output/animation-bench`](../output/animation-bench/README.md)):

- [x] **The planner reads the sprite.** The rest pose goes to the chat model as
  an image beside the brief. Read back for the warrior: "right hand grips
  pommel by hip, left hand under the guard by cheek; slab greatsword …
  angled up-left towering overhead" — so the wind-up now starts from where
  the blade actually rests, where the name-only plan had swung it low first.
- [x] **Animator timing.** Each planned frame carries a hold (60–400ms):
  jab 90/200/90/120ms, swing 90/180/100/160ms. Frames are appended with
  those holds; the timeline shows "Mixed" and can retime.
- [x] **Effects.** `effects` travels to the planner (which places the effect
  per frame), to the sheet prompt (which permits only the requested effect and
  otherwise forbids every trail and glow — the ban is conditional so it never
  names a requested effect), and to the judge. Verified: a purple trail riding
  the blade through all four swing frames with a white air-cut arc on the
  slash; a grey streak trailing the boxer's glove at full extension.
- [x] **Effect colours get palette slots.** Only colours *foreign* to the
  palette (Oklab distance > 0.12 from every entry) are seated, so a drifted
  glove red conforms instead of stealing a slot. A full palette folds its
  closest near-duplicate pair(s) — the warrior folded #3a373e into #2f2b31
  (0.047) and #7e767d into #958b93 (0.073) — to seat #6f05f3 and #e248fe. The
  fold is an ordinary colour replacement inside the same undo entry. The boxer,
  whose palette already had whites and greys, seated nothing.
- [x] **A vision judge checks the strip; one repair sheet redraws rejections.**
  Strict on identity, scale, facing, completeness and the *stage* of the motion;
  told not to reject over foot, heel or hand detail after a first pass rejected
  two clean boxer frames for a lifted heel. After tuning, both cycles passed
  4/4 with no repair image bought. When the purple had failed to seat, the
  judge rejected all four warrior frames for "purple trail missing" — the check
  sees what the pixels show, which is the point.
- [x] **Images are deflated before they travel.** The encoder writes stored
  blocks; a 4× judge strip was 998,297 characters of base64 against the chat
  route's 400,000 cap. `compressIndexedPng` recompresses IDAT with the
  browser's own `CompressionStream` (a 1024² sheet drops from 1 MB to under
  100 KB) and is applied to every image sent to a model.
- [x] `gpt-image-2` rejects `input_fidelity`; not sent.

| Cycle, 4 frames at 128px | Plan | Sheet | Judge | Ground row | Palette |
| --- | --- | --- | --- | --- | --- |
| Warrior swing + purple trail + air-cut | 59s (vision) | 115s, 1 image | 4/4 ok, 33s | 123 ×5 | 2 folds, +#6f05f3 +#e248fe |
| Boxer jab + air-cut streak | 52s (vision) | 112s, 1 image | 4/4 ok, 26s | 113 ×5 | unchanged |

**Still open, honestly:** the judge is a model and can be wrong both ways; a
repair costs an image, so `verify: false` exists. The air-cut arc on the slash
frame reaches the frame's left edge and the coherence check will say so. Only
two slots are ever folded, so an effect with three foreign hues keeps the two
most-used. Registration is vertical only. This is verified through the pure
pipeline and the live API; the browser panel's new effects field is covered by
the tool tests, not by a paid run from the UI.


## 2026-09-03 — Text animation rebuilt as one sprite sheet

The user's verdict on the generated animations — boxer jab, karate kick, sword
swings — was that they were not good at all, and the five-frame warrior swing
in [`output/warrior-slab`](../output/warrior-slab/README.md) shows why: the body
changed size between frames, the feet wandered up and down the canvas and the
overhead pose ran off the edge, while every mechanical check passed. The cause
was structural. Each frame was a separate `images.edit` call, and N independent
renders cannot share a camera however firmly the prompt asks.

**What changed, end to end:**

- [x] **Poses are planned like an animator plans them.** The planner is told
  the source drawing is frame 0 of the loop, asked for anticipation, key
  extreme, follow-through and recovery, told the sprite's facing (from the
  direction in its name), and returns JSON with a per-frame `contact` of
  grounded or airborne. Live output for "a quick straight jab with the lead
  hand" named the coil, the locked-elbow extension with the rear glove at the
  jaw, the half-retraction and the settle — four poses an animator would key.
- [x] **The whole cycle is one sheet.** `/v1/derive` gained `mode: animate`
  with `columns`, `rows` and `poses`; the browser composes the source into
  cell 1 of a 1024²/1536×1024 sheet at 4–16 px per cell, the model fills the
  next N cells, and the browser cuts them. `lib/animation/sheet.ts` is pure
  TypeScript, so layout, composition, cutting and registration are tested and
  scriptable. One paid image per sheet: 3–5 frames beside a 128px sprite, up to
  15 beside a 32px one.
- [x] **Grounded frames are registered to the source's ground line.** The one
  drift a sheet still shows comes by the row — the model drew the warrior's
  second row 72px (14% of the cell) high. Tolerance is asymmetric: a grounded
  frame floating above the floor is brought down by up to 20% of the cell,
  because that is never right; one hanging below is lifted at most 8%, because
  a low follow-through can trail a blade beneath the feet. Airborne frames are
  never touched.
- [x] `gpt-image-2` rejects `input_fidelity` (400, "does not support"); it is
  not sent.
- [x] The tool reports repeated poses, empty cells, ground-line corrections and
  edge contact, and says the frames hold 250ms so an action wants 8–12 fps.

**Measured live, through the real pipeline** (`scripts/animate-bench.ts`,
outputs in [`output/animation-bench`](../output/animation-bench)):

| Cycle | Before (one image per frame) | After (one sheet) |
| --- | --- | --- |
| Warrior swing, 4 frames, 128px | 661.6s, 4 images; ground row varied 105–123; blade clipped at the top edge | **115.4s, 1 image**; ground row 123 in all five frames after registration; no frame touches an edge; blade inside the canvas in the overhead pose |
| Boxer jab, 4 frames, 128px | not previously possible to judge; earlier idle needed an external tool | **115.4s, 1 image**; ground row 113 in all five frames with 0–5px corrections; same boxer, same scale; coil → extension → retract → settle |

Raw sheets came back 86–90% transparent with 1.2–1.3% partial alpha (a glow the
model paints around the figure), which the 128 alpha threshold drops; the
indexed frames have no halo.

**Still open, honestly:** the frames are a coherent cycle of the same character,
not animator polish. The warrior's anticipation pose swings the blade low before
the overhead wind-up, which is what the planner asked for and reads as one
motion, but a human animator would key it differently. Registration corrects
vertical drift only; horizontal drift is left alone because a lunge moves the
body on purpose. A source whose lowest pixel is a prop rather than a foot
defines the ground line by that prop. Body scale is consistent by eye; there is
no automated scale check, because bounding boxes change with the pose.


## 2026-09-03 — Sword-swing regression repair (partial; overlapping rewrite)

- Reproduced per-pose fitting moving/rescaling a stationary body and stripping
  transparent weapon margins. Exact-grid regressions at 32px and 128px failed
  before the fix and now pass, including an intentionally airborne pose.
  Text animation now keeps the full generated camera canvas and pixelises to
  the document's explicit dimensions. Existing base frames remain unchanged.
- Long briefs are planned intact (up to 10,000 characters) into self-contained
  pose instructions. Every composed instruction is checked against the existing
  1,000-character derive limit before any image call; nothing is silently cut.
  Pose prompts no longer request re-centring or constant silhouette occupancy.
- Coherence checks report character canvas-edge contacts and explicitly avoid
  certifying anatomy, foot contact or smooth motion. Replaying the old swing
  through the patched native tool flags all four generated poses instead of
  reporting a clean cycle.
- Shared exports retain their Blob URLs behind persistent native Download links,
  releasing each only when its notice is dismissed. A regression demonstrated
  that the old immediately revoked URL was already unreadable after export;
  PNG bytes now remain readable. Tool messages no longer claim a confirmed disk
  save. In-app browser delivery is still being verified.

At the tested snapshot, **856 tests passed** (178 core, 612 web, 66 API), as did
root lint/typecheck. A production build passed before the native-link refinement.
The paid four-pose replay completed in **695.7s**, using the original 128px warrior
on `asset_031` with a 1,760-character brief. All five frames are distinct, the
source is unchanged, and all canvas edges are transparent. Native playback shows
4fps/250ms; the independently parsed GIF has five 250ms delays.

**Still unresolved:** visual ground-position drift remains. The lowest skin rows
are 123, 122, 112, 119 and 120, with the downward-slash pose visibly floating
relative to the source. Retaining the full canvas removes deterministic fitting
drift, but does not make independent model poses share exact contact points.
The retained-button export still produced no verifiable browser download; a
native-link refinement passes tests but has not been loaded in the live build.

During this live replay, work outside this agent's team replaced `api.ts` and
`animate-text.ts` with a sprite-sheet generation pipeline. Those overlapping
changes were preserved, not reverted or rebuilt. The earlier green checks and
live output **do not certify that replacement**. User coordination was requested
before final integration. The original `asset_029` remains untouched; see
[the new output evidence](../output/warrior-slab/README.md#regression-replay).

## 2026-09-03 — Live WebMCP sword swing

Imported the 128px slab-sword warrior with `import_image` into `asset_029`, then
used `animate_with_text` to generate four swing poses through the actual Zenith
pipeline. The five-frame asset uses 250ms holds (4fps); original pixels/palette
are unchanged and all five frames are distinct. Browser playback was started,
and native frame/coherence reads succeeded. The exported GIF's five 250ms delays
were verified independently. See [the artifact evidence](../output/warrior-slab/README.md).

Limits: a long description exceeded the composed per-frame API instruction limit
and bought no image frames; a concise retry completed in 661.6s. Ground position
drifts and one raised-sword pose touches the edge despite a passing coherence
check. WebMCP export reported success without a verifiable download; the supplied
GIF uses Zenith's encoder over the exact WebMCP-read frames. No app code changed
during this generation run.

## 2026-09-03 — 4fps default and boxer idle hop

New frames now default to 250ms (4fps), including generated, procedural,
skeleton and interpolated frames. GIF and atlas fallback timing uses the same
core constant. Existing explicit durations and duplicated-frame timings remain
unchanged. The timeline derives its displayed rate from saved durations and
shows “Mixed” for unequal holds; export adapters now retain those holds in
spritesheet/engine metadata instead of dropping them.

Verification: **839 tests pass** using `OPENAI_API_KEY='' bun run test` (178 core,
597 web, 64 API); root lint, typecheck and production build pass. The initial
unsanitised test run picked up a configured API key and made the unconfigured-key
case fail; explicitly disabling the key made the declared suite deterministic.
A production-browser reload showed an existing 100ms asset as 10fps, preserving
its old timing instead of applying the new default retroactively.

The [boxer output bundle](../output/boxer-idle/README.md) contains four distinct
128×128 poses, a shared 16-colour palette, transparent margins and a one-second
4fps GIF. GIF blocks were independently checked: four 250ms delays. Art came
from built-in ImageGen, followed by Zenith's actual pixeliser and encoders.
**Not yet imported into the live studio:** browser auto-review denied new-asset
creation over a canvas-preset concern; explicit user approval was requested.
The original assets were not changed.

## 2026-09-03 — Character editing regression

See [the dated evidence and option matrix](./verification/character-regression-2026-09-03.md).
Repairs cover correct direction/source navigation, explicit type correction in
chat, shared stale-result guards, palette-safe masked editing, atomic palette
undo and captured generation destinations. An actual 128×128 merchant and its
side/back views were generated through the in-app browser. A prompt-free joint
drag, frame bake, six-frame walk and every export format were exercised; the
downloaded indexed PNG matches the source exactly. The screenshot-sized new-colour
inpaint correctly refused palette overflow without changing the asset.

Current verification: **831 tests pass; lint, typecheck and production build pass.**
Model anatomy, every camera/view combination and engine runtime imports are not
proven by these checks. Earlier audit snapshots below remain historical.

The option sweep additionally repaired non-destructive re-pixelisation (correct
palette, source/destination retention), nearest-neighbour upscaling edge/cadence
loss, and background removal deleting outlines on already-transparent sprites.
Live production checks verify 64→32 and 64→128 copies, exact 2× pixels and the
transparent-background no-op. Real text animation, 64px reference redraw, all six
manual tools and the colour editor were also exercised; see the matrix for the
difference between live checks, pure-pipeline tests and remaining quality limits.

**Animated-character WebMCP surface:** the browser's configuration-limit error
occurred in development and production. Investigation proved unnecessary
78→20→78 registration churn during navigation. Registration now follows the
visible route while shared execution and chat reject an unsettled target.
After repair, ten live production asset switches, editor reads after each,
the full 82-tool animated surface, and subsequent variant/source reads all
succeeded without the error. No tools were removed. The exact browser-internal
limit trigger and indefinite-session stability remain unproven.

Two live variants retained connected right-facing anatomy and left the source's
grid and palette byte-identical. The batch's delayed intermediate navigation
was repaired and checked with a deferred-response regression. Full-mask purple
recolour still shifted scarf colour; text-generated poses still drift in framing
and equipment. These are recorded quality limitations, not perfect successes.

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
| 12 Skeletons | done | partial | Silhouette-read estimation, bone rig with live preview, stock cycles and agent posing live; reusable rig library and transfer remain |
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
| [12](./phases/12-skeletons.md) Skeletons & transfer | **Rig rebuilt; reuse incomplete** | 4/7 | Agent posing through `animate_with_skeleton` joints; saved pose libraries and cross-character transfer remain |
| [13](./phases/13-export-polish.md) Export & polish | **Exports done; UI polish not** | 5/9 | Engine bundles, palettes, indexed PNG all built |
| [14](./phases/14-projects.md) Projects | **Complete** | 6/6 | Browser, WebMCP, model and persistence paths verified |

### Known hazard, carried forward

**`session.activeId` and the `/asset/[id]` route must not diverge.** Tools resolve `session.active`; the editor renders `session.get(id)`. When they disagree the agent edits an asset the human is not looking at, and **nothing errors**. This has already occurred twice, in both directions, and was found both times only by checking a claim rather than assuming it.

The rules are in [`AGENTS.md`](../AGENTS.md) under "The route owns which asset is open". The live hazard is anything that reassigns `activeId` as a side effect — `session.close()` does, which lands in scope the moment [phase 05](./phases/05-asset-library.md) adds delete from the library. Warning comment sits on the method itself.

Do **not** resolve this by detecting a mismatch and navigating: effects run child-first, so route and session legitimately disagree for one commit on mount, and a detector navigates to the wrong asset. There is a regression test named for that failure.

**Repo health:** 740 tests pass · typecheck clean (3 bun workspaces) · lint clean.

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

- [x] **`apps/api` is wired and deployed.** Pixel validation/quantisation and model-backed generation routes are covered by the API tests and are live at the deployed Cloud Run URL.
- [ ] **Auth is dead code.** `next-auth` and Google OAuth are configured and unused. Our whole no-login argument says judges should not hit a signup wall, so this should be removed or deliberately kept for the demo credentials on the landing page.
- [ ] **Landing page palette still competes with the artwork.** The starter's warm `bone parchment / clay` set contradicts the design language ([`idea.md` §6](./idea.md)), which calls for near-neutral low-chroma chrome so the art is the only saturated thing on screen.
- [ ] **Demo credentials (`demo` / `test123`) are shown on the landing page but nothing consumes them.** No auth flow is wired to them.
- [ ] **`next-themes` logs a console error on every load.** *"Encountered a script tag while rendering React component"* — the library injects a blocking script to set the theme before paint, and React 19 warns about it. Functionally harmless, but [`requirements.md` §6](./requirements.md) requires no console errors on load, so it is a submission item. The fix is to replace `next-themes` with an inline `<head>` script, which is the standard pattern; not done because the user was away and theming works.
- [x] **`/v1/generate` rate limiting.** Per-client *and* global windows, metered before the key check so a refused request costs nothing; 429 with `Retry-After`. Defaults 10/hr per client and 60/hr global for generate, 60/400 for chat. The global cap is the one that actually bounds the bill — per-IP does nothing against a spread of addresses. Verified by 11 tests including the memory bound under a stream of unique IPs. **Still unauthenticated**, which is deliberate (no login wall for judges), so the caps are the only thing between a public URL and the bill.
- [x] **Deployment verified (3 September 2026).** `apps/web` and `apps/api` are live on Cloud Run in `asia-south1`; the API health endpoint, frontend response, deployed API URL in the client bundle, CORS allowlist, and `min-instances: 1` were smoke-tested. The API uses Secret Manager for `OPENAI_API_KEY`.

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

Landing-page generation now waits for the saved project tree, clears its active
project, and then calls `generate_asset`. The result is therefore a loose asset:
it appears under **Not in a project** and in **All assets**, never inside whichever
project happened to be open earlier in the browser session.

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

## Phase 12 — Skeleton rework, 2026-09-03

The skeleton was accurate on nothing and functional for nothing. Checked against the product's real input — the model-generated merchant at 32px, side view, staff in hand, now kept as `lib/skeleton/fixtures/merchant-side-32.json` — rather than the 8×8 box the suite had been passing on.

### What was wrong, measured

- **The estimator did not read the sprite.** It took the widest row in a band as the shoulders and hung every other joint off proportions. On the merchant: head joint on the top pixel of the hat, hands outside the silhouette, legs straight below hips that were nowhere near the legs, and the staff read as the left arm. The old test suite could not see any of this because it only ever ran on a synthetic box.
- **The deformer was not a rig.** Inverse-distance weighting let every joint pull on every pixel: dragging a hand slid the head, and a walk cycle melted the torso. Nothing rotated, because nothing was a limb.
- **Templates stretched every character to one body.** Keyframes were absolute positions, so applying a stride grew or shrank the character's legs to the template author's proportions.

### Verified

- **Estimation reads runs of opaque pixels per row.** Head peak, neck valley, shoulder peak off the width profile, with the neck-versus-waist ambiguity resolved by whether the profile widens again below the valley; the crotch is the row where one run becomes two, and each leg is tracked to its own foot; an arm is the run beside the torso, or the torso's edge when held against it. Every joint lands on an opaque pixel of the part it names on the real 32px merchant and on the 128px front-view merchant (viewed at 8× and 2×). A held staff — a thin separated run in more than half the rows, in both halves of the sprite — is stripped before any of that, so it is no longer an arm or a leg, and two narrow legs are not mistaken for props.
- **Bone rig with hard binding.** Every pixel binds to its nearest bone in the base pose (the spine as a capsule, so the torso's interior stays with the spine), and moves rigidly with it by inverse mapping, so a rotated limb has no holes. A toy test pins the property that matters: rotating one bone moves exactly its pixels and nothing else. Prop pixels bind to a zero-length bone at the hand, so the staff translates with the hand upright and in one piece — asserted as one contiguous column of the staff's index in every frame of a walk.
- **Templates are angles, applied by rotation.** Keyframes are authored as degrees per bone and expanded by forward kinematics from the rest pose, so a limb's length cannot drift between keyframes (asserted for every bone of every template). `retargetPoseOnto` reads each bone's turn relative to the rest pose and applies it to the character's own bone in its own pixel space, keeping its length within a 0.5–1.5 clamp. Grounded cycles plant the lowest foot on the character's ground line; a jump on a sprite with no headroom is held at the canvas edge instead of clipped. Walk and run are four keyframes each (two contacts, two passes), with the arms opposed to the legs. `facing: "west"` mirrors the east-authored cycles.
- **Retention on the real merchant:** every template keeps 75–100% of the sprite's pixels in every frame (losses are limbs crossing), six 32px frames in about 2ms and six 128px frames in about 5ms — cheap enough that the editor re-poses the sprite under the pointer on every drag.
- **The editor poses live.** The canvas shows the rig source in the current pose while a skeleton is open, joints are colour-coded by side and labelled on hover, and a stroke that misses a joint no longer paints under the preview. The panel picks type, facing and a template pose (retargeted onto the character), builds a cycle from the corrected rig, bakes the pose as a new frame after the source frame, and resets or hides. `Space+E` still toggles the rig.
- **An agent can pose through tools.** `animate_with_skeleton` takes `joints` — without a template they are the pose and one frame is inserted; with one they correct the estimated rig before the cycle — so an agent reads `estimate_skeleton`, moves what matters and gets a frame back with no UI. This was going to be a separate `re_pose`, and `list_pose_templates` was going to stay: the discovery catalog's byte budget (a regression guard under an observed browser rejection) had 290 bytes of headroom, so the pose path was folded into the one tool and the template list, whose only content was the enum the schema already carries, was removed.

### Found while verifying in the browser

- [x] **Frame selection never repainted.** `DocumentStore.selectFrame` and `selectLayer` notified subscribers without moving `revision`, and every `useSyncExternalStore` selector caches on `revision` — so clicking a frame in the timeline changed the store and nothing on screen: the old frame stayed highlighted and the canvas kept painting it. Confirmed by hashing the canvas across programmatic frame clicks (unchanged) and by forcing an unrelated re-render (the timeline then showed the new frame while the canvas still showed the old composite). Unchanged since the initial commit; found only because a built attack cycle looked identical on every frame. Selection now bumps the revision, re-selecting the current frame does not, and two core tests pin both. Frames 1, 3 and 4 of the cycle now render as three different poses.

### Open

- [ ] Reusable pose storage and `transfer_animation` across assets: poses transfer in the engine; no saved library or end-to-end application is surfaced.
- [ ] Arms held against the torso in a side view are the torso's edge strip, so a swing shears that strip. Inherent to a flat rig without segmentation; it is why the cycles are labelled blocking quality.
- [ ] Quadruped estimation reads the head end, body line and feet off the silhouette but has only a synthetic dog to check against; no stock quadruped cycles.

## Moss Hollow demo repair and rehearsal — 2026-09-03

The original sword edit was blocked by a full 16-colour palette: the existing
shades were used outside the blade too, so replacing them globally would change
the knight. Generation still defaults to 16 colours, but documents now allow
255 opaque colours plus transparency. `recolor_region` appends exact local
shades and changes the chosen indices in one shared undo entry. Indexed grids
use `Int16Array`; expanded palettes use document v2 and explicit `@hex` rows,
while existing v1 documents remain readable. This supersedes the earlier
16-colour/compact-only limits recorded above.

### Verified locally

- [x] Exact purple/dark-violet/lavender recolour of a full-palette 128px fixture;
  every unaffected RGBA pixel, other frames and hidden layers preserved; one
  undo/redo restores both palette and pixels. Invalid/capacity-exhausted edits
  leave artwork unchanged. The final 255 limit is indexed PNG/GIF capacity,
  not an arbitrary 16-colour editing restriction.
- [x] High indices, including 128 and 254, survive text encoding, hydration,
  project backups, animation, PNG and GIF. Export round trips compare pixels
  and authored timing. The API retains a 16-colour quantization default while
  accepting explicit expanded palettes.
- [x] Generated sprites retain transparent padding. Four-frame, two-pixel bob
  tests preserve opaque pixels even for tightly framed source images.
- [x] Tool-discovery budget passes for all asset types/frame contexts. Removing
  `recolor_region` from registration makes the exported-tool guard fail naming
  that tool; restoring it makes the same guard pass.
- [x] Actual external WebMCP rehearsal against the local production build:
  `create_project` → 128px style → real `generate_asset` job (64.9 seconds) →
  editable `Moss Knight` character. Visually inspected: right-facing, green
  helmet, red scarf, brown boots, steel sword, separated limbs and full body.
- [x] `animate_procedural` bob, four frames, amplitude 2; all frames 250 ms.
  Each frame retains 6,537 opaque pixels. Manual UI Undo/Redo restores one/four
  frames, and manual Play switches to Pause.
- [x] `export_animation` GIF at 4× with no FPS override, `export_project`, and
  complete chunked `read_export` retrieval. Saved under
  `output/moss-hollow-rehearsal/` without replacing the user's existing files.
  Independent Pillow decoding confirms 512×512, four 250 ms frames, and every
  RGBA pixel equal to the backup. `import_project` preserves every frame;
  `flush_storage` and a page reload preserve the restored artwork.
- [x] `bun test`: 1,060 pass, 0 fail. Root lint, typecheck and build pass.
  Read-only code review found no blocking defects in recolour/framing; a
  separate propagation audit's stale-documentation finding was addressed.

### Not yet verified / not performed

- [x] **Live browser recolour and its manual undo/redo.** On the deployed
  `asset_046`, the 16-colour palette grew to 19 and exactly 145 inspected blade
  pixels changed; every unmapped/outside pixel remained identical. UI Undo and
  Redo restored the complete before/after canvas strings exactly. A fresh
  production generation (`asset_047`) repeated the check on 187 blade pixels.
- [ ] Optional matching chest was not generated.
- [x] Deployed to Cloud Run and verified on the public URL: API revision
  `zenith-api-00004-jhz` and web revision `zenith-web-00004-jq6`, both serving
  100% traffic. Health reports document v2; deployed CORS admits only the web
  origin. A fresh paid generation completed in 59.2 seconds. Its four 250 ms
  bob frames retain 5,914 opaque pixels, manual Play reached Pause, and its
  4× GIF (512×512) matches every backup pixel. Complete live artifacts are in
  `output/moss-hollow-live/`.
