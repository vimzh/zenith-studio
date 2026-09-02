# Phase 14 — Projects

**Status:** Complete and verified on 2026-09-02. See [`../gaps.md`](../gaps.md#phase-14--projects-) for the evidence ledger.

**Workspaces were cut on 2026-09-02**, after shipping. A workspace was a second
place an asset could live — a spatial canvas beside the folder tree — and two
places was one too many: an asset had a folder *and* a position, and opening a
project asked which of them you meant before it would show you anything.
Opening a project now does the obvious thing: the project's files appear in the
explorer sidebar and its assets on screen. The spatial tools went with it
(`list_workspaces`, `create_workspace`, `open_workspace`,
`move_asset_to_workspace`, `place_asset`, `move_asset`, `arrange_assets`), and
so did the workspace coordinate space — which retires the two-coordinate-space
risk this phase's own table called its most likely source of subtle bugs.

**Goal.** Group assets into games, and make a game's visual style enforceable across everything in it.

**Why here, and why last.** Everything below is real product value, and none of it demonstrates the thing this project exists to demonstrate. The thesis is **an agent and a human editing the same canvas with pixel precision.** A flat library proves that completely. Hierarchy is scaffolding around the proof — it has to be built, styled, navigated and explained, and it makes the demo longer without making it better.

So it waits until the collaboration loop is finished and polished. Then it becomes the thing that turns a sprite tool into something you ship a game with.

## What it adds

### Projects

```
Project — "Moss Hollow"          one game
├── StyleProfile                 the style contract
├── Palettes                     one primary, optional secondaries
└── Folders                      a file tree, in the sidebar
    ├── "Characters"    the hero, enemies, NPCs
    ├── "Tiles"         tiles, textures, tilesets
    └── "UI"            buttons, bars, icons
```

Project placement is stored beside the asset. Nothing about the asset document's own shape changes, and an unplaced asset remains valid.

### The StyleProfile

```ts
StyleProfile {
  palette:      PaletteRef                                    // the hard colour law
  canvasSizes:  { character: 32, tile: 32, texture: 32, item: 16, ui: 16 }
  view:         'side' | 'low top-down' | 'high top-down'
  projection:   'orthographic' | 'isometric'
  directionSet: 'side2' | 'cardinal4' | 'ordinal8'
  outline:      'none' | 'dark' | 'darker-hue' | 'coloured'
  shading:      'flat' | 'basic' | 'detailed'
  proportions:  'realistic' | 'semi-chibi' | 'chibi'
  references:   AssetRef[]                                    // exemplars generation conditions on
}
```

This is what recovers the **style-drift** argument that a flat library cannot make. Your hero is 32×32, 16 colours, dark outline; three sessions later the enemy you generated is 48×48, soft-edged, 40 colours. Nothing in a flat library notices. A project does:

- **`conform_to_style`** — palette re-quantisation and canvas crop/pad. Alpha is already binary by the core grid invariant. Deterministic, so conformance never depends on a model cooperating.
- **`check_style_consistency`** — specific violations with coordinates, never a boolean: *"uses 21 colours (allows 16); out-of-palette pixels at (3,7), (3,8), (12,20); canvas is 48×48 but project character size is 32×32."*
- **Durable context for the agent.** *"Generate a slime enemy"* is underspecified in a chat window and fully determined inside a project: 32×32, high top-down, 4 cardinal directions, dark outline, this exact palette, matching these references.

### The file explorer

Opening a project is a route — `/project/[id]` — and the explorer sidebar is what
appears beside it. Clicking a folder selects it, and a new asset — from the
explorer, from `create_asset`, from `generate_asset` — lands there rather than at
the project root. Folders rename inline, and a new one opens straight into its
name field.

A project's **resolution is chosen once, when it is created** — one game is one
size. It sets every asset type's canvas size, and a new asset inside the project
takes it without being asked; a named canvas preset is still an explicit size
for that one asset and outranks it. The style panel can retune a single type
afterwards.

An asset's **type can be changed** from the Asset panel. Every generative entry
point defaults to `tile`, so a character generated from a prompt arrived typed
as one — and Directions, Text animation and Skeleton are character-only panels,
so the entire directional workflow was unreachable for an asset that plainly was
a character, with nothing on screen saying why. Type is metadata, so the change
needs no rebuild and costs no undo history.

Assets **delete from the explorer and from the project screen**, and deletion
moves the document and its placement together: a placement left pointing at a
deleted document is not inert, because the explorer renders a row per id in a
folder and falls back to the raw id when the name is gone. Undo restores both,
falling back to the project root if the folder went away meanwhile.

The project palette is a **contract, not a generation-time law**: assets
generated inside a project keep the colours their image actually had, and
`check_style_consistency` and `conform_to_style` are how a human applies the
palette when they want it. What holds a project together at generation time is
the rest of the brief — view, projection, outline, shading, proportions, feature
bound — and a style reference, which the model is shown rather than told about. Folders are where an asset *sits*, not what it is: dragging
one between folders rewrites a placement record and never touches the document,
which is why a failed drop is harmless and why deleting a project unplaces its
assets rather than destroying them.

Style drift is still the argument for grouping, and it is still visible: the
project screen lays every asset in the project side by side with a violation
badge on each one that has left the contract.

## In scope

Project CRUD · project switcher · optional project placement for assets · a file-explorer sidebar with drag-and-drop placement · StyleProfile with an editing panel · `conform_to_style` · `check_style_consistency` · reference assets · violation badges in the library · bulk conform · project-level export bundle

## Tools introduced

`list_projects` · `create_project` · `open_project` · `get_style_profile` · `set_style_profile` · `add_style_reference` · `conform_to_style` · `check_style_consistency` · `export_project`

## Exit criteria

- [x] An asset drawn deliberately off-style is caught with exact palette coordinates and exact expected/actual dimensions; partial alpha is unrepresentable by the indexed-grid invariant
- [x] `conform_to_style` fixes palette and size violations deterministically — same input, same output, every time — while preserving binary alpha
- [x] Changing a project palette reports exactly which assets now violate it
- [x] An agent runs check → conform → re-check unaided and reaches a clean state
- [x] Opening a project shows its files in the explorer sidebar and its assets on screen; an asset dragged into a folder, and back out to the project root, lands where it was dropped
- [x] Existing assets with no `projectId` keep working untouched — projects are additive, never a migration

## Risks

| Risk | Mitigation |
| --- | --- |
| Pulled forward under pressure because it sounds foundational | It is not. Re-read the second paragraph. A flat library proves the thesis; this makes the product shippable, which is a different and later goal. |
| Over-eager conform destroys deliberate artistic choices | Conform is explicit and never automatic. The tool reports palette and resize changes; resizing replaces the document and clearly reports that prior pixel undo history is cleared. |
| Two coordinate spaces (workspace vs asset-local) breed bugs | Removed at the root: workspaces are gone, so asset-local pixels are the only space a tool takes. |
