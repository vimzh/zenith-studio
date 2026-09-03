# Agent-driven Zenith workflow

Zenith exposes **WebMCP tools in the live studio browser tab**. Codex or another
browser-enabled agent operates the same document, history and project as the
human. No built-in chat prompt is required. This is not a standalone stdio or
HTTP MCP server: a client without access to the live tab cannot use these tools.

Discover the registered tools and their schemas after navigation. Library and
project operations are always available; drawing tools require an open asset,
and character/tile/animation tools appear only in the appropriate context.
Call `open_asset`, wait for its visible route, then edit. A route/active-asset
mismatch is rejected rather than editing unseen artwork.

## Main flow

1. **Organize:** `list_projects` → `create_project` or `open_project` →
   `list_project_contents`. `create_folder`, `move_asset`, `rename_project` and
   `rename_asset` organize files without changing pixels. Project operations
   request the visible project route explicitly.
2. **Input:** `create_asset` for an empty indexed canvas; `import_image` for a
   base64 PNG; `generate_asset` for new art. For concept art, use
   `build_character_from_reference` with **exactly one** of `image` (base64 PNG)
   or `source_asset_id`. It extracts a clean character before pixelization;
   target widths include 64 and 128. Existing source artwork is preserved.
   Convert JPEG/WebP to PNG in the client before sending an image.
3. **Inspect and edit:** `read_canvas`, `get_palette`, `read_region`,
   `describe_asset`; then indexed drawing/fill/transform tools. Use `recolor_region`
   for exact local hex changes: it appends missing shades without globally
   remapping the artwork. Omit outline/hilt indices from the mapping. `undo`/`redo`
   use the human's history. `inpaint_region` is source-conditioned paid editing.
4. **Animate and turn:** deterministic `animate_procedural`, frame operations,
   `estimate_skeleton` / `animate_with_skeleton`, or paid `animate_with_text`.
   Inspect `read_frames_diff`, `read_animation_summary`, `check_animation_coherence`
   and actual frame pixels. Use `generate_direction_set` or `rotate_character`
   for new views, `derive_direction_by_mirror` where an exact mirror is appropriate.
   Automated checks do not certify anatomy or animation quality.
5. **Save and deliver:** `flush_storage` confirms local transactions or reports
   why it cannot. Export a project backup for portability. Export PNG, GIF,
   spritesheet, engine bundle or palette; retrieve every file through `read_export`.
   Restore a backup with `import_project` using the parsed bundle object.

## Long paid calls: start once, poll

Call `start_tool_job` instead of waiting synchronously on a long generation:

```json
{
  "tool": "build_character_from_reference",
  "arguments": {
    "source_asset_id": "<id from list_assets>",
    "name": "Astronaut",
    "target_width": 128
  },
  "request_id": "astronaut-concept-1"
}
```

Save the returned `job_id`, then call `get_tool_job`. Status is `running`,
`succeeded` (with the tool result), or `failed` (with the actual error).
If the **start response** is lost, repeat the exact same request ID and arguments:
it returns the same job rather than spending again. A different operation needs
a new ID. Do not retry paid operations blindly after a timeout.

Only one wrapped job runs at once. Direct paid calls are not tracked by this
wrapper. Keep the page open: reload loses tracking and request-ID protection,
and does not prove a remote model request was cancelled. No automatic retries
or cancellation are offered. After 50 jobs, save results before reloading.

## Complete file output without download clicks

`export_png {"scale":1}`, `export_animation {"format":"gif"}` and the other
export tools return a JSON manifest. Each file has `artifact_id`, `filename`,
`mime_type` and `byte_length`. `delivery` defaults to `artifact`; choose `both`
to also offer the human a browser download.

Use the client's tool runner to retrieve chunks programmatically, not by asking
the language model to transcribe base64. Pseudocode (adapt `call` to the client):

```js
const manifest = JSON.parse(await call("export_animation", { format: "gif" }));
for (const file of manifest.files) {
  const chunks = [];
  let offset = 0;
  for (;;) {
    const chunk = JSON.parse(await call("read_export", {
      artifact_id: file.artifact_id, offset, length: 49152,
    }));
    chunks.push(Buffer.from(chunk.data, "base64")); // decode EACH chunk
    offset = chunk.next_offset;
    if (chunk.eof) break;
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== file.byte_length) throw new Error("Incomplete export");
  // Write bytes to an explicitly chosen local output path, then:
  await call("release_export", { artifact_id: file.artifact_id });
}
```

Offsets and lengths count **bytes**, not base64 characters. Default chunk size
is 12,288 bytes; maximum is 49,152. Files remain immutable after later artwork
edits, until released or the page reloads. Capacity is 32 files / 64 MiB; full
storage fails clearly without evicting older exports. `list_exports` recovers
file IDs after a lost export response in the same page session.

## Persistence and restore boundaries

IndexedDB is browser-local, not cloud storage. `get_storage_status` is a status
read, not a backup. `flush_storage` waits for local writes and fails if storage
is unavailable or the document changes during the save check.

`export_project` produces the current `zenith.project` version 1 format. Its
pixel documents may be version 1 (up to 16 colours) or version 2 (expanded
palettes up to 255 opaque colours). Grid strings remain compact below index 16;
higher indices use an `@hex` header and space-separated hex tokens, not one
character per pixel. Both formats are accepted on import.
`import_project` validates every document, folder relationship, placement and
style reference before adding a new project with fresh IDs and returning the
old-to-new mappings. Existing assets are never overwritten. This is an
additive in-memory commit, not an observer-level or cross-store disk transaction;
flush it separately. Project backups contain serialized pixel documents and
project metadata, not external image source files or a remote job history.

Moving/deleting a style exemplar removes its old project's reference; undoing
deletion restores it. Older persisted projects may already contain stale
references: export refuses clearly instead of producing an unrestorable file.
Repair with `set_style_profile {"reference_asset_ids":[]}`, or keep only valid
IDs from `list_project_contents`, then export again.

Engine bundle bytes can be retrieved, but successful retrieval is not proof of
compatibility with every engine version. Inspect model output visually before
calling it ready for a game.
