# Character editing regression — 3 September 2026

## Reproduction and scope

The supplied screenshot shows a 128×128 merchant, classified as a tile, followed by a large masked recolour (`x=32, y=12, width=90, height=100`). It is evidence of a damaged result, not proof that rotation alone caused the missing anatomy. A separate QA project was created in the in-app browser; existing user assets were not edited.

The test source is an actual model-generated 128×128 merchant, not a synthetic checkerboard. Its indexed pixels and palette are retained in `apps/web/src/lib/webmcp/fixtures/qa-merchant.json`. The output images in `output/character-regression/` are exact exports, without smoothing or manual cleanup.

## Repairs verified by regressions

- Rotation captures its source without changing the visible asset while waiting; completed results explicitly navigate the editor. Navigation is mounted in the app shell, not only the Agent tab. Explicit tool navigation also works from the library.
- Direction lookup stays within the source project. Source/target camera views are validated and used; named east/south sources are no longer assumed north. Side profiles explicitly specify screen-left/screen-right and changed occlusion.
- Chat can explicitly correct an asset's type using `set_asset_type`; available tools refresh between tool rounds. Rotation instructions distinguish turning an existing character from redrawing it or masking a local edit.
- Inpainting asks for the complete edited canvas, preserves all pixels/colours outside the mask, and refuses results that remove more than 25% of the selected subject unless removal is explicitly requested. This is a catastrophic-erasure guard, **not** an anatomy classifier.
- Palette slots needed by incoming colours cannot be overwritten by later colours in the same edit. Palette overflow is an error, not silent substitution. Inpainting currently requires a square, single-layer frame.
- Palette changes and pixel edits share one undo entry. Failed transactions restore both. A true no-op does not promise an undo that would actually undo prior human work.
- Draw, inpaint and text-animation results cannot overwrite a newer asset/frame/layer/revision or write into a replaced store. Text animation stops buying further frames when the target becomes stale.
- Prompt and concept generation retain the project/folder selected when they started and reject deleted destinations before creating results.
- Re-pixelisation creates a separate, correctly paletted copy of the selected frame composite. It no longer rejects all different-size requests or writes new indices against the old palette. Source frames/history and project/folder placement are preserved; stale and empty results fail clearly.
- Subpixel sampling uses nearest-neighbour pixel centres when upscaling. Every pixel of 64→96 and 64→128 is checked; the previous rounding lost the final row/column and shifted the duplication cadence.
- Background removal includes transparent pixels when identifying the border background and clears only border-connected components of an opaque background on the active layer. Enclosed same-colour subject pixels are preserved; an already-transparent merchant creates no undo entry.
- Variation batches navigate after each completed result, not only after the final paid call. A deferred second-call regression verifies that the first result is already visible and both requests still use the original source.
- Tool registration follows the visible route's asset, avoiding the proven transient 78→20→78 tool churn when the active session changes first. Shared browser execution rejects non-library tools during route/session disagreement; chat is also gated until the target is ready. Regression tests fail against the previous churn and wrong-target execution.

## Executed coverage

| Surface | Test and evidence |
| --- | --- |
| Generation | Live 128×128 merchant generated through the app's actual model → pixelisation → store pipeline. |
| Single rotation | Live south → east, side view. Visually inspected: one visible eye, nose points right, connected head/torso/limbs, backpack behind and staff in front. Original source retained. |
| Direction sets | Live ordinal8 completed: north, north-east and south-east were generated from south; west, north-west and south-west were exact mirrors; existing south/east were reused. All eight were visually inspected. Re-running side2 and cardinal4 returned “already complete”, buying no more images. Automated tests additionally validate cross-project isolation, partial failure, captured palette, accurate completed-set UI and idempotent local mirrors. |
| Inpainting | Screenshot-sized mask retested live. New purple shades exceeded the 16-colour budget; a clear error was shown and the asset remained unchanged. Automated tests cover catastrophic erasure, explicit removal, outside-region preservation, stale targets, atomic undo/redo and no-op reporting. |
| Raster tools | Actual-source fixture executes read/write region, individual pixels, fill/bucket, replace/clear, line/rectangle, colour queries, regions, silhouette and readability. In the browser, a pencil stroke changed 6 pixels, eraser changed 7 and bucket changed 5,323; each was undone. Eyedropper sampled the skin colour, selection produced an 11×11 rectangle, and pan moved the view without changing the grid. All six brush-size buttons were selected. The copy's grid was checked exactly restored. |
| Transform options | Fixture executes both mirror axes, all three dither patterns, wrapped/unwrapped shifts, 90/180/270° rotations and their inverse, all nine resize anchors, and content crop. |
| Reduction and interpolation | Actual-source fixture reduces to eight colours and restores pixels with Undo; interpolation between genuinely different frames produces four frames. The initial background-removal check exposed deletion of 1,643 outline pixels on an already-transparent sprite. After repair the fixture remains byte-identical with no undo entry; a separate opaque-background fixture verifies connected removal, enclosed-colour preservation and Undo. The transparent no-op was also verified live in production. |
| Re-pixelisation | Live production browser-worker conversion creates a 32×32/12-colour copy from the 64px reference, then a separate 128×128/16-colour copy. Every pixel of the 128px result was compared against exact 2× nearest-neighbour output and matched, including alpha. Pure-pipeline regressions additionally check same-size copies, palette correctness, selected composite, source history and destination/stale/empty cases. Upscaling adds no new detail; it is not another model generation. |
| Frames | Fixture executes add/select/read/reorder/delete, duration, undo/redo, frame diff and coherence. Live six-frame timeline, 15fps setting, per-frame duration, play/pause and onion-skin toggle verified. |
| Procedural animation | All six presets (bob, blink, flicker, pulse, scroll, sway) executed on the real fixture. |
| Skeleton | Every shipped template executed on the fixture. Live joint drag changed 591 pixels; bake created a new editable frame; Undo removed it. A local six-frame walk was built and exported as GIF. |
| Palette and opacity | All eight currently offered named/preset palettes, custom palette, and opacity endpoints/intermediate stops tested deterministically. Every palette swap restores original pixels and palette on Undo. Palette controls preserve frame/layer selection and older history; brush selection stays in range when the palette shrinks. The actual browser slider was keyboard-tested at 0/25/50/75/100%. Right-click → Edit colour rejected invalid hex, saved #663399 into the selected slot, and Undo restored #0f0309 with the same 1,643-pixel usage. Live palette exports tested below. |
| Type-specific tools | Fixture exercises tile/texture seam checks and tilesets, plus character direction mirror/list/select. |
| Export UI | Clicked PNG at8×, indexedPNG, spritesheet+atlas, Godot, Unity, Phaser, LÖVE, GPL, PAL, ASE, HEX, Paint.NET and PNG-strip actions. Actual files downloaded; live six-frame GIF export also completed. Encoder tests exercise PNG scales1/2/4/8/16 and real128px source. |
| Slow-call failures | Deferred mocked model responses reproduce frame/asset/store/revision and destination races; assertions confirm rejection without overwriting newer work. These are deterministic integration tests, not claims of live model quality. |
| Chat classification and facing | Live natural-language request on a deliberately tile-classified east sprite: chat called `set_asset_type`, refreshed its tools, called `get_directions`, then `derive_direction_by_mirror`; it created a west copy without an image-model call. The east source's grid was checked unchanged. Chat verified direction membership, not visual anatomy. |
| Text animation | Live UI request generated two distinct walking poses from the east sprite and appended them as editable frames. All three frames persisted through reload and exported as a 15fps GIF. Both new poses retain connected anatomy and face right; equipment placement and framing drift, so this is not a claim of production-ready animation quality. |
| Reference extraction | Live UI “Use open asset” → 64×64 → “Build base sprite” produced a new character through an image-model extraction/redraw, framing and indexed pixelisation. Source remains 128×128, output is 64×64 with 16 colours. The body, face, staff and backpack remain identifiable. This run starts from the generated character, not a new photographic reference. |
| Variations | Two live model-generated variants, Leather and Traveller, retained a connected right-facing character. Leather adds armour; Traveller adds the red scarf and rolled map. Both grids/palettes were exported and visually inspected. The east source's grid and palette were checked exactly unchanged. The batch exposed delayed intermediate navigation; its repair is verified with deferred integration tests, not another paid batch. |
| Animated WebMCP scope | The configuration-limit error occurred in both development and production before the registration repair, so hot reload alone was not the cause. After repair, ten consecutive south/east switches each completed an editor frame read; switching to the three-frame animation fetched all 82 tools and read every frame, followed by successful variant/source reads. No tools were removed. These production checks passed without the limit error; its browser-internal trigger is not established by this finite test. |

### Visual outputs

`output/character-regression/eight-directions.png` contains N, NE, E, SE on the
first row and S, SW, W, NW on the second. The five generated grids are captured
from the browser; the other three use the identical pixel-exact mirror operation
as the completed in-app set. No artwork was manually cleaned up.

`rotation.gif` plays those directions; `skeleton-walk.gif` is the actual
six-frame browser download. The local walk is silhouette deformation, not a
professionally segmented skeletal rig; pose estimation and cleanup still matter.

`text-walk-1-4x.png` and `text-walk-2-4x.png` capture the actual model-generated
walking poses at integer zoom. The two-pose test checks distinct motion and the
append/export path; two generated poses alone are not enough for a smooth walk.
`text-walk.gif` is the actual 42,817-byte, 512×512 browser download: three frames,
each with a 7-centisecond delay. `reference-64-4x.png` is the regenerated 64px
character, enlarged exactly 4×; `reference-browser.png` shows it in the app.
`variant-leather-4x.png` and `variant-traveller-4x.png` show the actual variant
outputs. `side-browser.png` records the repaired side view in the user's current
narrow browser panel; the viewport was not overridden for the screenshot.

A second recolour used a full-canvas selection on a separate copy, allowing
palette slots to be reassigned. It completed in156s, changing2557 indices and
adding purple shades. The face and hands are purple and the anatomy is intact;
however, the scarf shifted from red toward brown. This is a visible quality
limitation, not a perfect style-preserving success. Live Undo restored both the
source grid and palette exactly, and Redo restored the edit. See `purple-4x.png`.

### Download validation

The native indexed PNG is 16,672 bytes and byte-identical to encoding the saved merchant fixture. The 8× PNG is 1024×1024 RGBA. The atlas describes the actual 128×128 frame. Godot disables mipmaps; Unity uses Point filtering and no texture compression; Phaser enables `pixelArt`; LÖVE sets nearest filtering. GPL/PAL/HEX/Paint.NET contain 16 colours; the palette strip is 128×8. The downloaded GIF is 512×512, six frames, with six 7-centisecond delays (67ms rounds to 70ms in GIF).

Project export was retried in the fresh browser and downloaded successfully:
`character-regression-qa-sep-3.zenith.json`, 421,980 bytes, format `zenith.project`
version 1. Its 18 assets and 18 placements belong to the QA project; no original
user project was included. Earlier download attempts in the long-running browser
session had no verifiable file, so only this fresh-session download is counted.

## Limits of this verification

Passing tests do not establish that every model output has good anatomy, style, correct facing or smooth motion. The 25% guard cannot detect every malformed result. A full palette can still prevent a new requested colour without first freeing colours or selecting a larger permitted region.

Engine bundle generation is tested; importing the bundles in running Godot/Unity/Phaser/LÖVE projects is not part of this run. This report distinguishes live browser checks from fixture tests; it does not claim every parameter combination was exercised visually.

## Final automated verification

`bun test`: **831 pass, 0 fail, 49,759 assertions across 59 files**. Root lint,
typecheck and production build all pass. A read-only palette/history review also
exercised 24 palette changes over three frames and two layers with exact undo,
redo and transaction-abort restoration. Tests using the pure pixeliser inject
only the browser worker boundary; they do not substitute invented image outputs.

The final resize/background and navigation checks run against `next start`, not
hot reload. The final production build remains running locally on port 3000;
the existing API on port 3002 was not restarted. Browser tool handles were
refreshed after route transitions as required by the browser's page-bound safety
checks. An initial immediate read was refused because navigation was still in
progress; settling the route and fetching the current page's tools resolved it.

The root development launcher currently errors because `@zenith/core` has no
`dev` script. For these checks the existing web workspace's `dev`/`start` scripts
were run directly; the API was already running. This pre-existing launcher issue
was not changed as part of the character-editing repairs.
