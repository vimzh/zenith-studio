# Phase 12 — Concept art → playable character

**Goal.** The flagship flow. A photo, doodle, or prompt becomes a style-conformed, multi-direction, animated, export-ready character.

**Why here.** It **composes** phases 08, 09, 10 and 11. Nothing new is invented — the value is entirely in the orchestration, which is precisely what showcases WebMCP leverage.

## Deliberately not one tool

```
import_reference(image | prompt)
  → extract_character()                → clean full-body raster, transparent background
  → frame_subject(target_size)
  → pixelize(target_size)
  → generate_direction_set('cardinal4')
  → animate_procedural('bob')          → idle
  → animate_with_text('walk', 4)       → walk
  → check_palette_compliance()         → fix → re-verify
  → export_spritesheet()
```

Every step is inspectable, undoable, and overridable. A bad north-facing sprite is fixed in place; nothing re-runs from scratch. Compare a monolithic "make me a character" endpoint, where a bad result means starting over — that difference is the argument for tool granularity, and it belongs in the submission description.

## In scope

- **Image upload** — drag onto the canvas, file picker, or paste. Formats: PNG, JPG, WebP.
- **Reference tray** — uploaded art staged before pixelisation, with live before/after preview and target-size control
- Semantic subject extraction for scene photographs and illustrations before pixelisation
- Clean transparent full-body raster as the inspectable intermediate
- `import_reference` and `pixelize` as first-class tools
- **Progress across a multi-step chain** — each step visible in the agent pane as it completes, with per-step undo
- `inpaint_region` for repairing any step's output
- `export_spritesheet` with JSON atlas, laid out by direction and animation
- Results placed spatially on the canvas: source reference, pixelised version, direction ring, animation strips

## Out of scope

Skeleton animation for the walk cycle ([12](./12-skeletons.md)) — text-driven is sufficient here

## Tools introduced

`import_reference` · `inpaint_region` · `export_spritesheet` · `export_project`

## UI introduced

Upload affordance · reference tray with before/after · multi-step progress · spritesheet preview

## Exit criteria

- [ ] A hand-drawn doodle becomes a 4-direction animated sprite in under 2 minutes wall-clock
- [ ] Every intermediate artifact stays on the canvas and is individually editable
- [ ] The human can hand-fix one direction mid-chain without re-running anything
- [ ] Final spritesheet + atlas loads in Godot and Phaser unmodified
- [ ] An agent runs the whole chain from a single natural-language request
- [ ] Every step is one undo entry; the whole chain can be walked back
- [ ] Uploaded images leave the browser only for the explicit character-extraction image edit; framing and pixelisation remain local

## Risks

| Risk | Mitigation |
| --- | --- |
| Chain failure mid-way leaves confusing partial state | Every step commits its own artifact to the canvas. Partial results are useful, not garbage. Failure names the step and what to retry. |
| Users upload photos expecting magic | Reference tray's before/after preview sets expectations before the chain runs. |
| Copyright — users uploading others' art | Note in the UI that uploads stay local and the user is responsible for rights. Not our call to police, but worth stating. |
