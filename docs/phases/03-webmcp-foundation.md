# Phase 03 — WebMCP foundation

**Goal.** The agent becomes a first-class editor. Registration lifecycle done properly, plus the ~20-tool core.

**Why here.** This is the submission's central claim ([`../requirements.md` §3.1](../requirements.md)). Building it early means every later phase adds tools to a proven harness rather than retrofitting one.

## In scope

- **Adapter** — feature-detect `document.modelContext` (Chrome 150+) with `navigator.modelContext` fallback ([`../tools.md` Part 4](../tools.md))
- **Registration lifecycle** — per-component via `AbortSignal`, using the local registration hook for surface detection, cleanup, and result normalisation
- **14 core tools — the minimum that makes an agent genuinely capable**, no more:

| Group | Tools |
| --- | --- |
| Context | `list_documents`, `create_document`, `open_document` |
| Perception | `read_canvas`, `get_palette` |
| Editing | `write_region`, `set_pixels`, `fill_region`, `bucket_fill`, `replace_color` |
| History | `undo`, `redo` |
| Validation | `check_seamless_tiling` |
| Export | `export_png` |

  Deferred because a phase-03 tool must be *load-bearing*: `read_region` (`read_canvas` covers documents this small), `get_color_at` (same), `clear_region` (`fill_region` with the transparent index), `set_palette` (`set_palette_color` covers restyling), `export_indexed_png` → [13](./13-export-polish.md).

  An agent that can read a grid, write a grid, fill, recolour, verify, undo and export can complete the entire demo loop. Everything else saves it tokens, and tokens are not the constraint at 32×32.
- **Handler conventions** — actionable text returns, structured errors, `readOnlyHint` annotations, page state named in every description, one undo entry per agent mutation, immediate render
- **Agent Console** — live transcript of tool calls with arguments and results. Two jobs: makes collaboration legible to the human, and is the demo fallback if WebMCP is unavailable in a judge's browser ([`../requirements.md` §4](../requirements.md)).

## Out of scope

Context-scoped registration ([05](./05-asset-library.md), once there are enough tools to need it) · every non-core tool family

## Tools introduced

**14.** See the table above; full catalog in [`../tools.md` Part 2](../tools.md).

The external-agent integration adds `start_tool_job` and `get_tool_job`: an
asynchronous front door to existing paid tools, with page-session request-ID
idempotency and pollable results. They share the regular runner, scope guards
and transcript. They do not introduce a remote MCP server or persistent queue.
The current end-to-end protocol is [`../agent-workflow.md`](../agent-workflow.md).

## UI introduced

Agent Console panel · a WebMCP availability indicator

## Exit criteria

- [ ] All 14 tools appear in the **Model Context Tool Inspector** extension with correct schemas
- [ ] `check_seamless_tiling` returns **coordinates**, not a boolean, and an agent can close the loop: fail → fix → re-check → pass
- [ ] An agent completes the cobblestone refinement from [`../idea.md` §11](../idea.md) end to end
- [ ] Every agent mutation is visible in the human's viewport within one frame
- [ ] `Ctrl+Z` undoes an agent's edit
- [ ] Navigating away unregisters tools — zero ghosts in the inspector
- [ ] Works in Chrome 149+ with `chrome://flags/#enable-webmcp-testing` **and** in the ChatGPT in-app browser
- [ ] Agent Console can drive every tool with no WebMCP client present

## Risks

| Risk | Mitigation |
| --- | --- |
| WebMCP API shifts under us (still origin-trial) | All access behind one local adapter module. |
| Agent misreads coordinates | Origin and axis direction stated in *every* positional tool description. Test with a deliberately off-centre asymmetric sprite. |
| Vague returns leave the agent unable to recover | Every error names the problem and the fix. Test by feeding deliberately malformed input. |
