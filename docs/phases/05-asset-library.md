# Phase 05 — Asset library & persistence

**Goal.** Assets are real, durable objects. Create, rename, duplicate, delete — and everything survives a reload.

**Why here.** Phase 04 runs on fixtures. This makes them real, and gives the agent a library to act on.

## The model

```
Asset                      one pixel-art thing
├── id, name
├── type                   character | tile | texture | item | ui
├── width, height
├── palette                ≤16 colours
├── frames[]               one frame unless animated (phase 07)
└── directions{}           only for characters (phase 09)
```

**Flat, for now.** [Phase 14](./14-projects.md) layers projects over this without changing the asset shape — an `Asset` gains an optional `projectId`, and nothing else moves. Designing that field in now costs nothing; retrofitting the relationship later would.

**No container above it yet.** Type unlocks capability rather than implying a folder: a `tile` gets seam checking, a `character` gets directions and animations. A grass block and a hero are the same kind of object with different capabilities switched on.

## In scope

- Asset CRUD — create from preset, rename, duplicate, delete (with undo)
- **IndexedDB persistence** — assets, palettes, undo history. Autosave debounced, with a visible save indicator.
- Library filtering by `type` and free-text name search
- Import/export a single asset, and the whole library, as JSON
- **Pre-seeded examples** so a cold visitor sees real art immediately — a cobblestone tile, a character, an item ([`../requirements.md` §6](../requirements.md))
- **Context-scoped tool registration** ([`../tools.md` Part 6](../tools.md)) — library tools register on the library screen, editing tools only inside the editor

## Out of scope

Server persistence and sharing ([13](./13-export-polish.md)) · projects and any grouping above an asset ([14](./14-projects.md))

## Tools introduced

`list_assets` · `create_asset` · `open_asset` · `rename_asset` · `duplicate_asset` · `delete_asset` · `describe_asset`

## Exit criteria

- [ ] 30 assets survive reload with palettes and frames intact
- [ ] Cold visit to the deployed URL shows seeded examples, no login
- [ ] JSON export re-imports to an identical state
- [ ] Registered tool count changes between library and editor — verified in the Tool Inspector, no ghosts
- [ ] IndexedDB failure (private browsing, quota) degrades to in-memory with a visible warning rather than silent data loss
- [ ] Deleting an asset is undoable

## Risks

| Risk | Mitigation |
| --- | --- |
| IndexedDB quota on large libraries | Store grids as packed indices, not JSON arrays. Warn at 80%. Budget: 500 32×32 assets comfortably. |
| Autosave stalls the UI | Debounce; write in an idle callback. |
| Deviating from `AGENTS.md` SQLite guidance | Documented in [`../idea.md` §12](../idea.md): Cloud Run's filesystem is ephemeral and a login wall costs judges. |
