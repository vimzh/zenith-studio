# WebMCP Challenge submission readiness

Verified against the live Devpost hackathon data on 2 September 2026. The official pages remain authoritative: <https://webmcp.devpost.com/> and <https://webmcp.devpost.com/resources>.

The deadline is **3 September 2026 at 1:00 PM Pacific Time**. Do not change the submitted repository, live app, or submission materials between the deadline and the end of judging; use a fork for later development.

## Current verdict

The product is a strong fit for the brief and demonstrates non-trivial WebMCP use. It is **not submission-ready yet** because the public delivery artifacts do not exist or have not been verified.

| Requirement | Status | Evidence or required action |
| --- | --- | --- |
| WebMCP-powered web app | Ready locally | 31 tool definitions share the live browser store with the human UI and are registered by current page context. |
| Working live URL | Blocked | Deploy the web app and API, then test the public URL logged out in both required clients. |
| Public source repository | Blocked | The current `origin` is the old `vimzh/template` repository. The intended `vanshgaur/zenith-studio` URL does not currently resolve publicly. Create the public repository, update `origin`, commit, and push. |
| Devpost registration and project | Partially ready | The authenticated account is registered for The WebMCP Challenge, but no Zenith Studio Devpost project or submission draft exists yet. Create the project and start the submission form now. |
| Detectable open-source license | Ready locally | Root `LICENSE` contains the MIT License. Confirm the hosting service detects it after push. |
| Complete setup instructions | Ready locally | Root `README.md` explains the product, architecture, setup, WebMCP testing, and verification. Replace its submission-status notice with the final URLs. |
| Public YouTube demo under 3 minutes with audio | Blocked | Record a real WebMCP call changing the visible canvas, publish it publicly, and verify it logged out. |
| English submission | Ready | Product and repository copy are in English. |
| Third-party rights | Needs confirmation | Three landing GIFs are documented CC0. Confirm redistribution rights for `hero-pixel-landscape.png` and `logo.png`; their provenance is currently only “supplied by the project author.” |
| Existing-project disclosure | Needs action | The git history is a generic starter dated before the submission period. Select **existing project**, explain that the WebMCP pixel studio was built as the meaningful extension after 25 August, and preserve dated commits proving it. The current product work is still uncommitted. |
| Free judge access | Designed, not deployed | The studio has no login wall. Keep the deployment and model-backed generation available through judging. |
| Generation spend protection | Needs action | `POST /v1/generate` and `POST /v1/derive` are publicly callable and billable. Apply a Cloud Run/API Gateway quota or rate limit and a hard billing budget before exposing the OpenAI key. |
| Tested in supported clients | Partially verified | Local registration and the in-app Agent Console work. Record final evidence from Chrome with the WebMCP testing flag and the ChatGPT in-app browser. |

## Submission description draft

### Why this use case fits WebMCP

Pixel art is a live, stateful artifact rather than a one-shot request. Zenith Studio lets an agent inspect and edit the exact indexed grid a person has open in the browser. Page-scoped tools expose the active asset, frame, palette, and asset type, which a remote MCP service cannot access without duplicating or repeatedly uploading the document.

### How WebMCP improves the experience

The person and agent work on one canvas with no handoff files or hidden agent copy. Every agent change appears immediately in the person's viewport, and tools appear only when relevant to the current page and asset, reducing wrong calls.

### What people and agents can now do together

An agent can read the artwork as a compact character grid, make precise pixel edits, share the person's undo history, add animation frames, check and repair a tile seam, and export the verified result without either collaborator uploading a new copy or losing the current canvas state.

### Implementation

The Next.js client owns an indexed pixel document in IndexedDB. Human controls and 32 WebMCP tool definitions call the same TypeScript handlers and mutate the same store. A local adapter prefers `document.modelContext`, supports the legacy navigator surface, and unregisters each page-scoped tool with an `AbortSignal`. Deterministic pixelisation runs in a Web Worker; only image generation crosses to a Hono API that holds the OpenAI key.

## Final verification sequence

1. Commit the post-25-August work in reviewable commits and push it to a new public repository.
2. Add a platform quota/rate limit and hard billing budget, then deploy `apps/api` with `OPENAI_API_KEY` and an exact `WEB_ORIGIN` allowlist; deploy `apps/web` with `NEXT_PUBLIC_API_URL`.
3. Put the final live URL and repository URL in the README.
4. Test a cold, logged-out visit with no login requirement and no console errors.
5. In Chrome with `chrome://flags/#enable-webmcp-testing`, confirm the scoped tool list, then run a read → edit → verify workflow.
6. Repeat the core workflow in the ChatGPT in-app browser.
7. Record and publish a narrated YouTube demo under three minutes. Show the working product in the first 10–15 seconds, make a real agent tool call the centerpiece, cut loading and typing, and verify the video logged out.
8. Fill every Devpost field, including submitter type, country, existing-project status and explanation, tested agents/clients, AI tools used, and learning/career questions.
9. Submit before the deadline and freeze the submitted app, repository, and materials through judging.

## Eligibility confirmation

Before submission, the designated team representative must confirm age-of-majority, country eligibility for OpenAI API access, and absence of sponsor, administrator, judge, or employer conflicts under the official rules.
