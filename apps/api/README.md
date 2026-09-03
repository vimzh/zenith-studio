# `apps/api`

Hono on Bun. Deploys to GCP Cloud Run.

Its long-term job is the model calls that cannot run in the browser — generation, rotation, animation, inpainting. Today it serves the `@zenith/core` document model over HTTP, using the same package the browser store is built from.

The editor stays fully usable with this service down. Nothing here is on the path of a deterministic edit.

## Running

```sh
bun run dev       # http://localhost:3002
bun test
bun run typecheck
```

`WEB_ORIGIN` is a comma-separated allowlist of browser origins, defaulting to `http://localhost:3000`. It is never `*`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness, plus the document format and version this build speaks |
| `GET` | `/v1/palettes` | Built-in hardware palettes. Community palettes are fetched client-side with attribution, never bundled. |
| `POST` | `/v1/documents/validate` | Checks a serialised document against the five invariants; returns it normalised, with coverage and palette stats |
| `POST` | `/v1/quantize` | Reduces a base64 RGBA image to an indexed text grid; defaults to 16 colours, supports up to 255 opaque colours plus transparency |
| `POST` | `/v1/generate` | Generates source artwork with `gpt-image-2`; requires `OPENAI_API_KEY` |
| `POST` | `/v1/derive` | Creates a high-fidelity variation from a source PNG with `gpt-image-2`; requires `OPENAI_API_KEY` |

`/v1/quantize` returns the grid in the same text format `write_region` takes, so a response drops straight into the store with no conversion step.

## Errors

A rejected request returns `400` with the message the core model produced:

```json
{ "error": { "code": "invalid_index", "message": "frames[0].layers[0] holds 9 at (0, 0), which is not a palette index 0-3 or -1 (transparent)." } }
```

Codes match `PixelErrorCode` in `@zenith/core`. Unexpected faults return `500` with code `internal_error`.
