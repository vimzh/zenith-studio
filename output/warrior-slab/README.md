# Slab-sword warrior

Adult warrior in plain opaque briefs, carrying a broad sword roughly twice his body height. Static pose; no animation was requested.

- `warrior-128.png`: transparent 128×128 indexed game sprite, at most 16 colours.
- `warrior-preview.png`: exact 4× nearest-neighbour preview.
- `warrior.json`: editable indexed grid and palette.
- `source.png`: original built-in ImageGen artwork, preserved without edits.

The original static sprite was created with the built-in image-generation tool, then converted with Zenith's existing pixeliser and indexed PNG encoder. Dimensions, palette cap, nonempty artwork and fully transparent canvas edges were checked.

## Swing animation through Zenith WebMCP

Imported with `import_image` as character `asset_029`, **Slab-sword warrior — swing**, in **Character regression QA Sep 3**. The import retained the original indexed grid and palette exactly.

`animate_with_text` generated four new poses through Zenith's live model pipeline in 661.6 seconds. The asset now has five distinct frames (original ready pose plus four generated poses), all at 250ms: **4fps, 1.25-second loop**. The original frame remains unchanged. `list_frames` verified timing and `check_animation_coherence` passed its palette, area-jump and repeated-loop-frame checks. The browser's playback control was started and confirmed as “Pause”, with 4fps displayed.

- `warrior-swing.gif`: actual WebMCP-read frames encoded with Zenith's GIF encoder, 512×512, five independently verified 250ms GIF delays.
- `swing-frame-0.json` through `swing-frame-4.json`: the actual indexed frames returned by `read_frame`, with their unchanged shared palette.
- `swing-sheet.png`: ordered comparison of all five actual frames.
- `swing-browser.png`: the asset in the live editor.

The WebMCP `export_animation` call reported success, but no matching browser download file could be verified. The supplied GIF was therefore saved locally using the same encoder and exact WebMCP-read frames, not claimed as a verified browser download.

Visual limitations: the sword arc is visible and anatomy remains connected, but framing/ground position drifts between poses and the overhead pose touches the canvas edge. The automated coherence verdict does not certify polished motion or an unclipped blade.

An initial overlong animation request failed before drawing any frames because each composed frame instruction exceeded the API's 1,000-character limit. The successful retry used this 341-character description:

> Heavy two-handed sword swing: wind-up overhead, diagonal downward slash, low follow-through, return to ready. Keep this adult warrior in dark briefs, connected anatomy, and the broad slab sword twice his height. Same camera, scale and ground baseline; entire body and blade stay inside canvas. Transparent background. Deliberate 4fps motion.

## Regression replay

`asset_031`, **Warrior swing fixed**, is a separate verification copy; the original
`asset_029` is unchanged. The name was chosen before visual review and is not a
claim that every motion issue is resolved.

The patched independent-pose pipeline completed the saved 1,760-character brief
in 695.7 seconds without the old instruction-limit failure. It preserves the
original source grid and palette exactly and has five distinct 128×128 frames.
Every canvas edge is transparent. All holds are 250ms; native playback was
verified at 4fps.

- `fixed-swing-prompt.txt` and `fixed-swing-activity.txt`: actual request and completion evidence.
- `fixed-swing-source.json`, `fixed-swing-frame-0.json` through `fixed-swing-frame-4.json`: exact WebMCP reads.
- `fixed-swing-sheet.png`: ordered contact sheet; no manual alignment or retouching.
- `warrior-swing-fixed.gif`: those frames encoded with Zenith's encoder, 512×512,
  41,595 bytes; independent GIF block parsing confirms five 250ms delays.

**Partial result:** prompt overflow and edge contact are resolved in this run,
but foot-position drift remains visible. The lowest skin rows are 123, 122, 112,
119 and 120; the slash pose is elevated relative to the source. This is not a
finished, registered animation. The GIF is a local save of actual WebMCP frames,
not a verified browser download.

While this job ran, a separate writer replaced the on-disk animation implementation
with a sprite-sheet pipeline. This replay used the already-built independent-pose
client, not that new implementation. Rebuilding and final integration were paused
for coordination; do not use this evidence to certify the overlapping rewrite.

## Prompt

Use case: stylized-concept. Asset: one game-ready pixel-art warrior sprite for Zenith Studio, transparent square canvas. A cool imposing adult male human warrior, about 30 years old, muscular but with readable realistic limb proportions, short tousled black hair, stern face, bare chest, bare arms, bare legs and bare feet. He wears ONLY plain dark charcoal opaque underwear briefs with a simple waistband; no armour, cloak, boots or accessories. Nonsexual battle-ready character presentation. His defining feature is an absurdly huge, VERY BROAD, thick heavy iron slab greatsword inspired by Guts' oversized sword from Berserk: the complete weapon from pommel to tip is about TWO TIMES THE WARRIOR'S FULL HEAD-TO-FOOT HEIGHT, not merely two times the torso. Blade as broad as his torso, flat dark steel face, bright bevel along its cutting edges, blunt angular tip, tiny practical guard, long wrapped grip. Not a skinny sword. Compose the warrior low and toward the right of the square, gripping the hilt firmly with both hands near his shoulder/chest; the immense blade angles up toward the upper left, towering far beyond him. The sword and the entire warrior including both feet MUST FIT in the canvas, with a clear transparent margin all around the blade tip, head, hands and feet. Three-quarter fighting stance facing left; bent knees planted apart, balanced weight. Keep face, two arms, two hands, torso and two legs visibly connected and unobscured enough to read instantly at small size. Clean professional 16-bit pixel-art style intended to rasterize to 128x128: deliberate chunky pixel clusters, clear silhouette, dark crisp outline, flat stepped shadows, restrained 16-color-like palette, warm skin against cold steel. No smoothing, no anti-aliasing, no blurry texture, no gradients. Genuine transparent background, no scenery, no floor, no shadows, no labels, no text, no logos, no extra figures. Single character, single static pose, not a sheet. The giant sword should visually dominate the composition while the warrior remains unmistakably human.
