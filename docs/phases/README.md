# Build phases

Fifteen ordered phases. Each is independently shippable and demoable; each unlocks the next.

> **Live status:** [`../gaps.md`](../gaps.md) tracks what is actually verified versus what these phases claim. Update it as work lands.
>
> **Context:** [`../idea.md`](../idea.md) (product brief) · [`../requirements.md`](../requirements.md) (hackathon rules) · [`../tools.md`](../tools.md) (tool catalog). Phase tags in `tools.md` reference these numbers.

| # | Phase | Unlocks |
| --- | --- | --- |
| [01](./01-core-data-model.md) | Core data model & indexed grid | Everything |
| [02](./02-canvas-editor.md) | Canvas editor | A usable tool for humans |
| [03](./03-webmcp-foundation.md) | WebMCP foundation | A usable tool for agents |
| [04](./04-app-shell.md) | App shell — library & editor | The product's shape |
| [05](./05-asset-library.md) | Asset library & persistence | Durable assets |
| [06](./06-generation-pixelisation.md) | Generation & pixelisation | Model input that is real pixel art |
| [07](./07-animation-core.md) | Animation core | Frames, timeline, perception |
| [08](./08-animation-authoring.md) | Animation authoring | Motion without hand-drawing every frame |
| [09](./09-rotation-directions.md) | Rotation & directions | Top-down and isometric games |
| [10](./10-concept-to-character.md) | Concept art → playable character | The flagship flow |
| [11](./11-worlds-tilesets.md) | Worlds, tilesets & textures | Levels, not just sprites |
| [12](./12-skeletons.md) | Skeletons & animation transfer | Reusable motion |
| [13](./13-export-polish.md) | Export, polish & engine integration | Shipping into a real game |
| [14](./14-projects.md) | Projects | Grouping and enforceable style |

## The unit of work is an asset

**An asset is any single pixel-art thing** — a grass block, a cobblestone texture, a character sprite, a sword icon, a health bar. They live in one flat library. Type (`character` · `tile` · `texture` · `item` · `ui`) unlocks capability rather than implying a folder: a tile gets seam checking, a character gets directions and animations.

The core interaction still has two screens: a **library** you browse, and an **editor** you open one asset into, with the agent alongside it. Projects and the file explorer layer on additively; loose assets still use the same flow.

That was the deliberate core cut, not an oversight. [Phase 14](./14-projects.md) now layers hierarchy back on additively: project placement remains optional and loose assets keep working unchanged.

## Ordering rationale

**01–03 are the substrate.** Data model before UI before agent surface, because the tool layer is a thin wrapper over store mutations and must not be designed twice.

**04–05 before content features.** Both screens and real persistence come first; every later phase renders into them.

**06 before 10.** The pixelisation pipeline is the dependency of every generative feature; the concept-to-character flow just composes it.

**07–08 before 09.** Animation is the stronger differentiator and mostly deterministic. Rotation depends on generation quality and is honestly the least reliable feature in the category.

**11–12 late.** World building is broad but shallow; skeletons are the single highest-cost feature, and phases 07–08 already cover most real animation needs.

**13 last of the core sequence** — it depends on everything having a final shape.

**14 follows the core sequence.** It adds the product structure needed to ship a coherent game without changing the human-agent editing thesis proven by the earlier phases.

## Scope discipline in early phases

Phases 01–03 carry a hard constraint: **ship the irreducible set, not the comfortable one.**

A pixel-art editor is usable with six tools (pencil, eraser, bucket, eyedropper, pan, zoom) and an agent is capable with fourteen. Everything past that is convenience — real, wanted, and deferrable. The test for admitting anything to an early phase is *"can the demo loop complete without it?"* If yes, it moves down.

This is why line/rect/ellipse, selection, dithering, symmetry, layers and Tiled Mode all sit in later phases despite being obvious editor features. They make the tool nicer; they don't make it work.

**Nothing deferred is dropped.** Every feature cut from an early phase has a named destination, and [phase 13](./13-export-polish.md) carries an explicit register of everything pushed down — so the backlog lives in the plan, not in memory.

Two corollaries:

- **No stubs.** A deferred feature is absent, not a disabled button. Greyed-out controls hinting at things that don't exist read worse than a smaller, complete toolbar.
- **One structural exception:** model the frame as a layer composite in [phase 01](./01-core-data-model.md) even though layers don't ship until [13](./13-export-polish.md). Carrying an unused abstraction is far cheaper than retrofitting one through every phase that touches pixels.

## Phase file format

Each file carries: **Goal · Why here · In scope · Out of scope · Tools introduced · UI introduced · Exit criteria · Risks.** Exit criteria are testable statements, not aspirations — a phase is done when they all pass.
