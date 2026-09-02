# Devpost description — draft

> Paste into the Devpost submission. Covers the four points the rules require
> explicitly: why WebMCP fits, how the UX improves, what people and agents can
> now do together, and implementation details.
>
> **Every claim here is verified.** Anything that has not been checked in a real
> browser is absent rather than softened — see the bottom section, which is for
> us and should not be pasted.

---

## Zenith Studio

**A pixel-art editor where a human and an AI agent draw on the same canvas, at the same time.**

Not an agent that generates images and hands them over. An agent with its hands
on the live document — reading the exact pixels you are looking at, editing six
of them, checking its own work, and undoing into your undo stack when it gets
something wrong.

### The idea

AI generates game code faster than anyone can produce matching art, and image
models produce pixel-art-*styled* pictures that need hours of manual repair:
anti-aliased edges, pixels off the grid, four hundred colours where the palette
allows sixteen, semi-transparent halos. An entire category of "AI pixel art
fixer" tools exists because of this.

Our answer is not a better repair pass. It is a constraint:

> **Constrain the medium hard enough and pixel art becomes text a language model
> reads and writes losslessly.**

A 32×32 sprite on a 16-colour palette is 1024 cells, each exactly one character —
`0`–`F` for a palette index, `.` for transparent.

```
................
......2222......
....22333322....
...2333333332...
...2331331332...
....23311332....
.....222222.....
......1111......
```

A model can read that, reason about it spatially, and write it back exactly.
There is no rasterisation to blur it, no downscale to knock it off-grid, no
palette to explode. **The defects above are not repaired — they are
unrepresentable.** The agent never renders pixels; it edits the canonical
indexed grid the app draws.

### Why WebMCP fits this, and a remote MCP server does not

**The artifact is visual, stateful and iterative.** A remote MCP server shuttles
base64 PNGs into a chat transcript. You cannot iterate on something you
re-upload every turn, and the human loses the canvas. WebMCP puts the tools
inside the page, so they operate on the document already open in front of you.

**The tools act on implicit page state.** `read_canvas` means *the asset you are
looking at, the frame you have selected*. `fill_region` writes to it. No ids to
pass, no file to sync, no preamble. That is structurally impossible for a server
that cannot see your screen.

**One store, two front doors.** Human actions and agent tool calls invoke the
same mutation, land on the same undo stack, and appear in the same transcript.
There is no separate "agent path" to drift out of sync — which is why
**Ctrl+Z undoes the agent's work as readily as your own.** We use that
constantly, and it is the single detail that makes people willing to let an
agent touch their art.

**The agent can see.** Most integrations only let a model write. `read_canvas`
returns the artwork as text the model genuinely perceives, so it can look, edit,
look again, and correct itself.

### How the UX improves

Ask for a change in a sentence and watch it happen on your canvas, while you
keep drawing. Select a region with the marquee and the agent receives exactly
those pixels — a 16×16 selection is about 290 tokens where the whole canvas is
1300, and the smaller payload is also the more specific one.

Concretely, from a real session: *"Fill the top-left 8×8 corner with the darkest
colour in the palette."* The agent read the canvas, worked out which index was
darkest — it was never told — filled the region, then re-read the canvas to
check itself. Total: three tool calls, one visible change, one undo press to
take it back.

Nothing is hidden. Every call appears in a live transcript with its arguments,
its result and its duration, whether it came from an agent or from you.

### What people and agents can now do together that was not possible before

**Verify and self-correct on real geometry.** `check_seamless_tiling` returns
*coordinates*, never a verdict: fail, fix exactly those pixels, re-check, pass.
An image model cannot do this about its own output. Neither can a tool that
hands back a PNG.

**Reason about motion instead of redrawing it.** `read_frames_diff` returns only
the pixels that differ between two frames — typically 5–15% of them. An agent can
author an in-between by moving the changed pixels halfway, without ever reading a
full frame. **This only works because the format is indexed.** You cannot diff
two PNGs and get something a model can act on. Animation is where the constraint
pays off most, and it is the least obvious place.

**Enforce a style rather than describe one.** A project carries a contract —
palette, canvas size per asset type, camera angle, outline, shading. Conformance
is *arithmetic*: `conform_to_style` remaps out-of-palette pixels and resizes
deterministically, so it never depends on a model cooperating. And generation
inside a project is conditioned on the project's own art: we hand the image model
an existing asset, and it returns a new subject in the same palette, outline and
pixel scale. We verified this by asking for a treasure chest with a knight as the
reference — we got a chest, unmistakably from the same game.

**Divide the work by what each side is good at.** The agent does the tedious,
exact, verifiable parts. The human draws. Both on the same pixels.

### Implementation

**`packages/core`** — the document model. Pure TypeScript, no DOM, no framework.
Indexed grids, the text codec, Oklab colour, a deterministic k-means quantiser,
undo/redo. Five invariants are enforced at one store chokepoint rather than per
caller:

1. Every pixel is a valid palette index or transparent
2. Every pixel is fully opaque or fully transparent
3. Dimensions are immutable except by explicit resize
4. Rasterisation is integer nearest-neighbour only
5. All frames of an asset share dimensions and palette

Violations are **rejected with a message naming what was wrong and what to do
instead** — never silently corrected. That is what makes the agent path safe: it
cannot express a defect, and when it tries it gets an actionable error.

**`apps/web`** — Next.js. Canvas, editor, the WebMCP surface, IndexedDB
persistence, and the whole pixelisation pipeline in a Web Worker. Uploaded images
never leave the device.

**`apps/api`** — Hono. Model calls only, because they need a key. Per-client and
global rate limits, CORS locked to an allowlist. **The app is fully usable with
this service down** — every deterministic tool, the entire editor, and all of
pixelisation work offline. Only generation degrades, with a readable error.

**The tool surface.** 82 tools, registered **scoped to the current view** rather
than all at once — the library offers a handful, a character is never offered
tileset tools, frame diffing appears only once an asset has a second frame. A
flat list that size measurably degrades a model's tool selection. Registration is
per-tool with `AbortSignal` lifetime, so navigating away unregisters cleanly and
leaves no ghosts.

**The chat loop.** The browser owns the conversation and executes every tool call
locally against the store; the server holds the key and relays. Tool calls go
through the same code path the WebMCP tools use, so a chat edit lands in the same
transcript and the same undo stack.

**Pixelisation.** Grid detection combines reconstruction error with boundary
contrast, because reconstruction error alone always prefers a grid twice too
fine and contrast alone one twice too coarse — only the pair converges. Cells
resolve directly to a palette index by weighted medoid in Oklab, so the sampler
respects the 16-colour budget as a constraint rather than repairing it
afterwards. Alpha is binarised at downsample time, which is what kills halos.

**688 tests**, covering the invariants, a 500-operation undo fuzz, byte-identical
grid round-trips across 1000 random documents, and property tests over the tool
surface — including one asserting every tool marked read-only actually leaves the
document unchanged when run.

### Honest limitations

Rotation to new facings is the least reliable feature in this category and ours
is no exception. Text-driven animation produces distinct action stances rather
than a polished cycle, and the tool says so. Generation takes one to two minutes.
Blockier textures tile slightly worse than busy ones — a real trade-off between
reading as pixel art and tiling invisibly, which we surface rather than hide.

---

## Not for pasting — checklist before submitting

- Live URL, and re-verify the description's claims against the deployed build
- Confirm the tool count above (82 at time of writing) still matches
- Verify in Chrome 149+ with `chrome://flags/#enable-webmcp-testing`
- Verify in the ChatGPT in-app browser
- Confirm tools appear in the Model Context Tool Inspector
- Rotate the OpenAI key used during development
- Set the copyright holder in `LICENSE` if `Zenith Studio` is not wanted
