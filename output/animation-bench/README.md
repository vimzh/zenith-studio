# Animation bench — sheet pipeline, 3 September 2026

Live runs of `animate_with_text`'s rebuilt pipeline, driven by
`apps/web/scripts/animate-bench.ts` against the local API. Everything after the
model calls is the product's own code: vision pose planning (`planPoses`), sheet
layout and composition, the `/v1/derive` `mode: animate` request, cutting,
ground-line registration, effect-colour seating, pixelisation and the vision
judge (`judgeFrames`). Nothing was retouched.

Each directory holds:

- `plan.json` — the planner's reading of the source pose and its per-frame poses, holds, ground contact and effect placement.
- `sheet-1-input.png` — the sheet the model received: the source in cell 1, every other cell transparent.
- `sheet-1-output.png` — the model's raw sheet, untouched.
- `judge.json` — the vision judge's per-frame verdicts (v2 runs).
- `strip-4x.png` — source frame followed by the resulting indexed frames, 4× nearest-neighbour.
- `cycle.gif` — the loop at 120ms per frame; `frames.json` carries the planner's holds.
- `timing.json`, `log*.txt` — measured seconds and the run transcripts.

| Run | Effects | Plan | Sheet | Judge | Ground row per frame | Palette |
| --- | --- | --- | --- | --- | --- | --- |
| `boxer-jab` (v1, text planner) | — | 31.1s | 115.4s | — | 113 ×5 | unchanged |
| `warrior-swing` (v1, text planner) | — | 34.6s | 115.4s | — | 123 ×5 after registration | unchanged |
| `boxer-jab-v2` (vision planner) | white air-cut streak behind the glove | 51.8s | 112.3s | 4/4 ok, 26.1s | 113 ×5 | unchanged: existing whites and greys served |
| `warrior-magic` (vision planner) | purple trail on the blade, white air-cut arc on the slash | 59.2s | 115.4s | 4/4 ok, 32.8s | 123 ×5 | folded #3a373e→#2f2b31 and #7e767d→#958b93; seated #6f05f3, #e248fe |
| `warrior-magic-medium` | same as above at `quality: medium` | reused | 52.3s | 3/4 after a 54s repair; a trail clipped, an unrequested arc | 123 ×5 | same folds |
| `boxer-combo-8` | jab-cross combo, 8 frames, two sheets bought concurrently | 25.0s | 159.0s for both | first pass: one blank cell and two unplanned streaks; one 152s repair sheet redrew all three; final 8/8 ok | 113 ×9 | unchanged |

`warrior-magic/speed.json` and `speed-log.txt` hold the planner/judge timings
at default, `low`, `minimal` and gpt-5-mini settings on the same plan and strip.

The v1 warrior's raw sheet had its second row drawn 72px high; registration
brought frames 3 and 4 down 74px and 65px onto the source's ground line. The
same motion through the previous one-image-per-frame pipeline took 661.6s for
four images and left the ground row varying between 105 and 123.

The first v2 judge pass (before the judge was told to ignore foot and heel
detail) rejected two clean boxer frames for a lifted heel, and rejected all four
warrior frames for a missing purple trail — correctly, because a seating bug had
conformed the purple to grey. Both are recorded in `log2.txt`; the repairs they
would have bought were stopped before the image call.

`REUSE=1` re-runs the free half of the pipeline on the saved plan and sheet,
which is how the registration, seating and judge fixes were checked without
buying more images. `VERIFY=0` skips the judge and repair.
