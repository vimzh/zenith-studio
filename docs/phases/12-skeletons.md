# Phase 14 — Skeletons & animation transfer

**Goal.** Reusable motion. Author a walk cycle once, apply it to every character in the project.

**Why here.** The single highest-cost feature, and phases 09–10 already cover most real animation needs. Its payoff is *reuse*, which only matters once a project has several characters — so it belongs after the character pipeline, not before.

## The idea

A skeleton is a set of named keypoints (joints) posed per frame. Pose sequences are saveable, reusable, and transferable between characters. That transferability is the whole justification for the build cost.

Character types shape the skeleton: `bipedal` · `bipedal-chibi` · `quadrupedal`.

## In scope

- Skeleton model — named keypoints, per-frame poses
- **`estimate_skeleton`** — infer keypoints from an existing sprite
- **Skeleton editor** — draggable keypoints overlaid on the canvas, `Space+E` to enter
- **`animate_with_skeleton`** — generate editable frames locally from a pose sequence, with no prompt or model call
- **Skeleton library** — save and reuse pose sequences across characters and projects
- **Stock templates** — walk, run, idle, attack, jump, hurt
- **`transfer_animation`** — apply one asset's pose sequence to another. The payoff.
- **`re_pose`** — change a single frame's pose and regenerate just that frame

## Out of scope

Full IK, bone hierarchies with constraints, physics. Keypoints and interpolation are enough for 32×32 sprites; anything more is disproportionate at this resolution.

## Tools introduced

`estimate_skeleton` · `get_skeleton` · `set_skeleton_pose` · `list_skeleton_templates` · `apply_skeleton_template` · `save_skeleton_template` · `animate_with_skeleton` · `transfer_animation` · `re_pose`

## UI introduced

Skeleton editor overlay · skeleton library panel · template picker

## Exit criteria

- [x] `estimate_skeleton` produces a usable skeleton on a 32×32 humanoid sprite
- [x] Keypoints are draggable at any zoom and snap sensibly to the pixel grid
- [x] A stock walk template applied to a new character produces a recognisable walk
- [ ] `transfer_animation` moves a hand-authored cycle to a different character with the pose preserved
- [ ] Every generated frame passes `check_palette_compliance` and `check_animation_coherence`
- [ ] Saved skeletons persist across sessions and projects
- [x] An agent can pose a skeleton entirely through tools, no UI required — `estimate_skeleton`, then `animate_with_skeleton` with `joints`

## Risks

| Risk | Mitigation |
| --- | --- |
| Keypoint precision is poor at 32×32 — a joint is 1–2 pixels | Keep normalised pose storage, render and drag on the pixel grid, and bake only when the pose reads clearly. |
| Flat deformation can distort overlaps | Bind every pixel to one bone and move it rigidly, so a limb turns as a piece and the body stays put; a held prop follows the hand. Use it for blocking, preserve the indexed source, and finish overlap corrections with normal pixel tools. |
| Highest-cost phase, most deferrable | It is 14th for exactly this reason. Phases 09–10 already ship real animation; this is leverage, not table stakes. |
