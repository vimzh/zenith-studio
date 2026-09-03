# Repository conventions

**Zenith Studio** — a browser-native pixel-art studio where a human and an AI agent edit the same canvas, live, through [WebMCP](https://developer.chrome.com/docs/ai/webmcp).

## Architecture

- **`packages/core`** — the pixel document model. Pure TypeScript, no DOM, no framework. Indexed grids, invariants, mutations, undo/redo, Oklab, serialisation.
- **`apps/web`** — Next.js on Vercel. UI, canvas rendering, WebMCP tool surface, IndexedDB persistence, and the pixelisation pipeline in a Web Worker.
- **`apps/api`** — Hono on GCP Cloud Run. Model calls only — anything needing the OpenAI key.

Persistence is **IndexedDB in the browser**, not server SQLite. Cloud Run's filesystem is ephemeral, and a login wall costs us judges who need to reach a working URL. Revisit only if project sharing lands (phase 13).

## Performance

This is a real-time graphics tool. A repaint touches thousands of cells and has ~16ms. The rules below are not micro-optimisation — each one exists because the naive version is measurably slow at 64×64.

**Measure before you optimise, but know the hot paths.** They are: the render loop, drag strokes, and store reads. Everything else can be written for clarity first.

### Reading cells

- **`peekCell` in loops, `getCell` everywhere else.** `getCell` validates coordinates and throws a structured `PixelError` naming the valid range — exactly what a WebMCP tool handler should return to an agent. That costs two `Number.isInteger` calls and four comparisons per read, which is right for one tool call and wrong for 4096 reads a frame. `peekCell` skips validation and treats out-of-bounds as transparent. Use it only where the caller controls the iteration.
- **Never call `store.readLayer()` or `store.readComposite()` per pixel or per frame.** Both return a *copy*. Read once per store revision through `useStoreSelector`, which caches on `store.revision` — an uncached `getSnapshot` returns a fresh reference every call and renders forever.

### Mutating

- **Wrap every drag stroke in `store.transaction(label, fn)`.** Without it each pixel bumps `revision`, and each bump clones a grid and triggers a repaint. A 50-pixel stroke costs 50 clones instead of one, and produces 50 undo entries instead of one.
- **Undo stores `PixelPatch[]`, never grid snapshots.** A patch is `{frame, layer, offset, from, to}`. Snapshotting a 64×64 grid per operation is 4KB a stroke and unbounded history growth.
- One logical operation is one undo entry. This is also why `Ctrl+Z` correctly undoes an agent's edit.

### Canvas rendering

- **Never set `imageSmoothingEnabled = true`.** It reintroduces exactly the anti-aliasing the document model exists to prevent.
- **Integer coordinates only.** For 1px strokes, offset by `+ 0.5` so the line lands on a device pixel instead of blurring across two.
- **Coalesce runs.** Pixel art is mostly flat regions — merge same-colour horizontal runs into one `fillRect` rather than one call per cell. Typically an order of magnitude fewer draw calls.
- **Integer zoom only.** Fractional zoom resamples the art. `ZoomLevel` is a union type so it is not representable, not merely discouraged.
- **One paint per frame.** Coalesce pointer events with `requestAnimationFrame`; a fast drag delivers far more events than frames.
- Cull offscreen work and use lower-detail thumbnails when zoomed out.

### Data

- `Int16Array` for cells, never `number[]`: indices 0–254 plus the transparent sentinel. Use `cloneGrid`, never `structuredClone`, on grid data. Generation defaults to 16 colours; editing supports 255 opaque colours plus transparency.
- IndexedDB: store grids as packed indices, debounce writes, and write in an idle callback so autosave never stalls input.
- Move heavy analysis off the main thread. The pixelisation grid search (phase 06) is a Web Worker for this reason — it is pure TypeScript over a byte array, so it ports with no DOM dependency.

### Check that a guard test still fails when it should

A guard either works or it does not, and it keeps working. A *test* of a guard
decays silently — a changed import, a filter that stops matching, a list built
from the same source it is checking — and stays green while checking nothing.

This has already happened here. "Groups every tool exactly once" passed while
eight tools were unregistered, because `TOOLS` is derived from `TOOL_GROUPS`, so
a missing tool was absent from both sides of the comparison. Green, vacuous, and
invisible until a tool nobody could call turned up in the browser.

So when a test exists to catch a class of mistake, make the mistake and watch it
fail — then check **which** test failed, because a mutation caught by a
neighbouring assertion tells you nothing about the one you meant to verify.

The guards here have been checked this way: marking a mutating tool `readOnly`,
stripping the coordinate origin from a description, shortening a description
below the floor, and changing a tool's scope each fail their own assertion and
no other. Repeat that after changing how any of them work.

### When a prompt has a general clause and a specific one, check which won

Prompts are not code: adding an instruction does not override an earlier one, it
competes with it. The more specific clause usually wins, and it is often the one
you did not mean.

This has bitten three times, and every instance was invisible to every metric:

- *"Preserve the subject's camera angle"* in the base prompt beat *"redraw this
  character facing east"*. Rotation returned the source view unchanged, and the
  asset was filed under a direction it did not depict. Palette overlap with the
  front view measured 91%, which read as an excellent result and was in fact the
  bug — nothing had changed.
- *"Fill the frame edge to edge"* beat *"draw a whole chest"*, and the chest came
  back clipped on all four sides.
- *"Plain transparent or flat single-colour background"* offered the model a
  choice and it always took the second, so every generated sprite had an opaque
  background baked in.

The fix in each case was to make the conflicting clause conditional rather than
to add more adjectives. When you add a clause to a shared prompt, read the whole
prompt back and ask which instruction a reader would follow if they could only
follow one — then check the output, because the metrics will not tell you.

### N independent renders cannot share a camera

When several generated images have to agree — frames of one animation, views of
one object — asking for agreement in the prompt does not produce it. The first
text-animation pipeline bought one image per frame, each conditioned on the same
source and each told to "preserve scale and registration". Every frame was the
same character; every frame had its own scale, its own ground line and its own
framing, and one ran off the canvas. Every mechanical check passed, because a
frame can be individually perfect and collectively useless.

The fix was structural, not adjectival: draw all the frames as one sprite sheet
with the source in the first cell at the exact scale every other cell must
match. Consistency becomes the easiest thing for the model to do rather than the
hardest thing to ask for, and it is one paid call instead of N. The general
rule: if a property spans several outputs, put those outputs in one image.

### Test the input the product actually produces

Not the one that is convenient to construct. The two diverge quietly, and the gap is where bugs live.

The indexed PNG encoder had 35 passing tests, every one of them exporting 32×32 at 1×, because that was the easy fixture to write. The export dialog's smallest real option is 8×, and its largest is 16× — and the encoder threw `Maximum call stack size exceeded` above roughly 64×64, because `array.push(...other)` passes every element as an argument. A shipped, submission-listed feature was broken at every size a user could pick, and the suite was green.

Before writing a fixture, ask what the product hands this code in practice: the sizes the UI offers, the images a model returns, the grids a real asset has. If that is expensive to construct, construct it once and keep it.

### React

- **The store is not React state.** The WebMCP tool layer mutates it from outside the render tree, and both front doors must land in the same place. Bind with `useSyncExternalStore` and a revision-cached selector.
- Never put grid data in `useState`.

### A stable reference whose contents change is invisible to React

`DocumentStore` and `EditorSession` are both mutable objects that never get replaced. React's equality checks compare references, so **anything keyed on the object itself never recomputes**. This shape has now caused three separate bugs, each silent:

- `useMemo(..., [store])` — never re-runs, because `store` is the same object after every edit.
- An uncached `getSnapshot` calling `store.readComposite()` — returns a *fresh copy* each call, so `useSyncExternalStore` sees a new reference every time and renders forever. The opposite failure, same root cause.
- Reading `session.list()` directly in a component — the array is rebuilt per call.

**Always go through `useStoreSelector` / `useSessionSelector`.** They cache on `store.revision` / `session.revision`, which is the value that actually moves. If a selector depends on something outside the store (a toggle, a mode), build it with `useCallback` over that dependency and pass it in — do not reach for `useMemo`.

### The route owns which asset is open

`session.activeId` and the `/asset/[id]` route must never disagree. Tools resolve `session.active`; the editor renders `session.get(id)`. When those diverge the agent edits an asset the human is not looking at — and **nothing errors**, which is the worst possible failure for this product. It has already happened twice, in both directions.

Two rules keep them together:

1. **The route pushes into the session.** `AssetEditor` calls `session.open(id)` on mount and on id change. The URL is the source of truth.
2. **The session never pushes back by inference.** Anything that needs to move the route asks explicitly — `assetNavigation.request(id)` in `lib/webmcp/navigation.ts`, which `open_asset` and `create_asset` call.

**Do not "fix" this by detecting a mismatch and navigating.** That was tried and it bounced: effects run child-first, so on mount the route and session legitimately disagree for one commit, and a detector cannot tell that apart from real divergence — it navigated to the wrong asset. Only an explicit request can mean it. There is a regression test named for that bounce.

The live hazard is anything that reassigns `activeId` as a side effect. `session.close()` does, which will matter when phase 05 adds delete from the library.

### Agent-facing performance

Token cost is a performance concern, not a separate topic.

- Prefer `read_frames_diff` to full frame reads — it returns only changed pixels, typically 5–15% the size.
- Register tools **scoped to the current view**. A flat list of 65 tools measurably degrades an agent's tool selection; library tools belong on the library screen, editing tools inside the editor.
- Tool descriptions should say when an operation is slow, so an agent prefers the deterministic tool where one exists — `derive_direction_by_mirror` over `rotate_character`, `animate_procedural` over `animate_with_text`.

## Design

Minimal, dense, sharp-edged. Panels 2px radius, controls 3–6px, 1px hairline borders, no shadows or gradients. `--spacing` is `0.22rem` and is the global density knob. Geist and Geist Mono; **Geist Mono is load-bearing** — the indexed grid only reads correctly in a monospace face. Chrome stays near-neutral and low-chroma so the artwork is the only saturated thing on screen.

Application screens use shadcn components whenever an equivalent exists. Do not render raw browser-native selects, inputs, textareas, or buttons in application code; native elements belong inside the shared shadcn and SmoothUI primitives only.

## Working practice

- Run `bun run setup` when initializing a fresh copy.
- `bun run lint`, `bun run typecheck` and `bun test` must all pass before work is considered done.
- Ship the irreducible set, not the comfortable one. A deferred feature is **absent, not a disabled button**.
