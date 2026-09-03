# Animation showcase — 3 September 2026

Five characters generated from prompts, then three text-driven animations each,
all through the shipping pipeline at its current defaults: vision planning at
low reasoning, one sprite sheet per cycle beside the source cell, ground-line
registration, effect-colour seating, and a vision judge with one repair pass.
Nothing was retouched.

- `characters.json` — the five prompts (`scripts/showcase-characters.ts` reads it; all five generated concurrently in about 54s).
- `run-animations.sh <slug>` — one character's three animations in sequence through `scripts/animate-bench.ts`; the five characters ran as five parallel processes.
- `<slug>/character.json`, `character-4x.png`, `source.png` — the indexed sprite and palette, its 4× preview, and the raw model output.
- `<slug>/<animation>/` — `plan.json` (the planner's reading of the source and per-frame poses, holds and effects), `sheet-*-input.png` and `sheet-*-output.png`, `judge.json` (per-pass verdicts), `strip-4x.png` (source then frames), `cycle.gif`, `frames.json`, `timing.json`, `log.txt`.
- `index.html` — everything above on one page (`scripts/showcase-page.ts`), published at https://claude.ai/code/artifact/20abcf78-9904-402d-b653-06be5aa8cbed.

Result: 15 of 15 animations completed; 10 passed the judge on the first sheet
(about 145s each) and 5 needed one repair sheet (about 320s each). After the
repair the judge still rejected one frame in three of those five: the archer's
roll (a missing dust scuff), the mage's eruption (a held flame column instead of
a recovery) and the mage's fireball (the staff missing from frame 1, a real
identity slip). The five characters and their twenty sheets cost 25 image
generations.

| Character | Animations |
| --- | --- |
| Knight | overhead slash with air-cut arc · shield bash with impact burst · victory pose with golden sparkles |
| Fire mage | fireball with flame trail · staff slam erupting ground flames · flame-ring sweep |
| Ninja | dash slash with speed lines and arc · three-shuriken fan with silver trails · backflip with dust puffs (5 frames) |
| Elf archer | draw and loose with a green arrow trail · dodge roll with dust · leaping triple shot (5 frames) |
| Dragon whelp | cone of fire breath · wing take-off and hover (5 frames) · spinning tail whip with a purple arc |
