# Requirements — The WebMCP Challenge

> **Companion docs:** [`idea.md`](./idea.md) (what we're building and why) · [`tools.md`](./tools.md) (tool catalog). All three must stay in sync.
>
> Source: <https://webmcp.devpost.com/> and its official rules page. Verified 2 Sep 2026. **Re-check the rules page before submitting** — this is a transcription, not the authority.

---

## 0. Dates

| Milestone | Date |
| --- | --- |
| Submission period | 25 Aug 2026, 11:00am PT → **3 Sep 2026, 1:00pm PDT** |
| Judging | 4 – 21 Sep 2026 |
| Winners announced | ~23 Sep 2026 |

Recorded as fact; the build plan is **not** scoped to it. Per the current direction we build the full phase sequence in [`idea.md` §13](./idea.md) and treat phase ordering — not the calendar — as the risk control. If a submission is made against a partial build, **phases 01–05 are the minimum coherent product**: an editor that works standalone, a durable asset library, and a real WebMCP tool surface. Phases 06–10 are what make it memorable.

No modifications are permitted after the submission period closes.

---

## 1. What the hackathon asks for

**The brief:** *"Build a WebMCP-powered web app that imagines and explores the future of the open web."*

**Sponsors:** OpenAI (primary), Cloudflare, Vercel, Shopify, Google Chrome, Render, Netlify.

**What WebMCP is, per the organisers:** *"an emerging open standard that lets websites expose structured tools agents can use directly"* — so agents complete tasks *"faster, more accurately, and more reliably"* than by driving a UI.

**Prizes:** ~$35,000 across the **top 10**, ~$3,500 combined each (OpenAI $3,000 cash + Codex Micro + 1yr ChatGPT Pro; Cloudflare $10k credits; Vercel $3,600 + $600 credits; Render $300 credits; Netlify $500 cash; Shopify gear; Chrome AI Ultra ~$300/member). One prize per project.

---

## 2. Mandatory deliverables

Every item is required. A miss fails Stage One screening before judging begins.

- [ ] **Working live URL**, reachable in **ChatGPT's in-app browser** *or* **Chrome with WebMCP enabled** (`chrome://flags/#enable-webmcp-testing`).
  - **Free to access for the entire judging period (through 21 Sep).**
  - **No login wall.** Not formally required, but a judge who must create an account may simply not. The IndexedDB-first architecture exists partly for this.
- [ ] **Text description** covering four things explicitly: *why WebMCP fits this use case*, *how the UX improves*, *what people and agents can now do together that was difficult or impossible before*, and *implementation details*.
- [ ] **Demo video** — under 3 minutes, **with audio narration**, public on **YouTube**, showing the app working **and WebMCP actually being used**.
- [ ] **Public repository** (GitHub / GitLab / Bitbucket) with *"all necessary source code, assets, and instructions required for the project to be functional."*
- [x] **Open-source licence**, *"detectable and visible at the top of the repository page"* → `LICENSE` at repo root, **MIT**. Confirm the public repository shows the licence badge after push.
- [ ] Everything in **English**.
- [ ] One designated team representative.

### Technical

- [ ] Tools registered via **`document.modelContext.registerTool()`**. Chrome 150 deprecated `navigator.modelContext`; feature-detect both, prefer `document`.
- [ ] Verified in **Chrome 149+** with `chrome://flags/#enable-webmcp-testing`, **and** in the **ChatGPT in-app browser**.
- [x] Deployed: **`apps/web` and `apps/api` on GCP Cloud Run** in `asia-south1`. Deployment platform is explicitly free choice in the rules. See [`idea.md` §12](./idea.md).
- [x] Backend reachable from the deployed frontend — CORS locked to the Cloud Run web origin, `min-instances: 1` so a cold start never lands in a judge's session.
- [ ] **App remains usable with the backend down** — only generation degrades.

### Originality

- [ ] New project built during the submission period, **or** a pre-existing project *"meaningfully extended using WebMCP"* with documented proof.
  - **Our position:** the repo previously held only a generic unrelated starter (landing page + app shell, per git history). Everything product-specific is new. Keep commits granular and dated so the log is self-evident proof.
- [ ] Original work solely owned by the entrant; no third-party IP infringement.

### Third-party material — specific watch items

We study [PixelLab](https://www.pixellab.ai/) as a competitive reference (see [`idea.md` §4](./idea.md)). Feature *concepts* — rotation, skeleton animation, style references, Wang tilesets — are category conventions and free to implement. What must **not** happen:

- [ ] No copied code, API shapes, schemas, or response formats from PixelLab or any competitor.
- [ ] Third-party showcase assets must be permissively licensed and recorded in [`NOTICE.md`](../NOTICE.md). The landing page currently uses three CC0 animations from OpenGameArt.
- [ ] No scraped or reproduced documentation text.
- [ ] **Aseprite is source-available under a restrictive EULA, not open source** (the GPL fork is LibreSprite). Feature concepts are free to implement; **do not copy Aseprite source**. RotSprite is a separately published algorithm (Xenowhirl) — implement from the algorithm description, not from their `rotsprite.cpp`.
- [ ] **Lospec palettes are fetched on user request with `name` + `author` attribution shown, never bundled.** Lospec states no blanket licence and artist palettes carry named authors, so redistribution isn't ours to assume. Hardware palettes (NES 54-colour, Game Boy DMG, C64, PICO-8) are factual data and ship as built-in presets.
- [ ] Any OSS dependency licence-checked and attributed. Current watch list: shadcn/ui, Geist + Geist Mono (Vercel, OFL-1.1 — ships fine, retain the licence), the OpenAI SDK, and anything adapted from [PixelRefiner](https://github.com/HappyOnigiri/PixelRefiner) (MIT — retain the notice if substantial code is ported).
- [ ] If any third-party algorithm or implementation is adapted, record it in a `NOTICE` or the README's acknowledgements with its licence.

---

## 3. Judging criteria → how we address each

Four criteria, **equally weighted** per the organiser's 1 September announcement. Two-stage: Stage One confirms baseline viability, Stage Two applies the criteria.

### 3.1 WebMCP Leverage
> *Thoroughness and skill in using WebMCP; a genuine, non-trivial implementation.*

- A **read** path, not just a write path: `read_canvas` returns artwork as an indexed grid (compact hex or explicit `@hex` tokens) so the agent genuinely *perceives* what it edits and can iterate. `recolor_region` adds exact local shades as one shared undo entry without remapping unrelated artwork.
- **Self-verification tools** (`check_seamless_tiling`, `check_animation_coherence`) that let the agent validate and correct its own output.
- Tools operate on **implicit page state** — open asset, direction, animation, frame, selection. Structurally impossible for a remote MCP server.
- **Composed workflows from primitives** — agents combine perception, exact raster edits, frame operations, validation, and export rather than calling one opaque black box.
- Proper lifecycle: `AbortSignal` unregistration tied to component mount, plus **context-scoped registration** so tool count stays legible ([`tools.md` Part 5](./tools.md)).

### 3.2 Execution
> *A working project with a complete, coherent product experience — not just a technical proof of concept.*

The editor is a real, usable pixel-art tool **with the agent turned off**. Asset library, palettes, canvas tools, animation timeline, export. The WebMCP layer is an additional way to drive a product that already stands alone. This is the criterion most PoC submissions lose on.

**Bar:** no dead buttons, no placeholder screens, no console errors, and an export a game engine actually accepts.

### 3.3 Potential Impact
> *A credible case for solving a real problem for a real audience.*

Name the audience precisely — solo devs, jammers, hobbyists — and the bottleneck: LLMs write game code faster than anyone produces matching art, and image models produce pixel-art-*styled* images needing manual repair. The existence of a whole class of AI-pixel-art-fixer tools is the evidence. See [`idea.md` §2](./idea.md).

### 3.4 Creativity & Ambition
> *A novel concept, different from existing solutions.*

Lead with the thesis, not the feature list: **constrain the medium until it becomes lossless text an LLM can read and write directly.** Then the consequence — the agent edits the canonical grid, so anti-aliasing, grid drift and palette explosion are structurally impossible rather than repaired after the fact. And the payoff nobody expects: this makes *animation* tractable, because temporal coherence becomes arithmetic on pixel positions instead of a hope about four independent renders.

**Address the comparison head-on.** PixelLab exists and is good. The description should say so and then draw the line: their MCP server hands an agent images; ours hands it a live, editable grid alongside a human working on the same canvas. See [`idea.md` §4](./idea.md). Judges will find PixelLab; better that we frame the comparison than that they do.

---

## 4. Strategic notes

**Judges may not run the project.** Official rules state decisions may rest on submitted materials alone.

1. **The video is the primary artifact, not documentation.** Budget real time.
2. **Show a tool call and the resulting pixel change in the same frame.** Split-screen: agent transcript left, canvas right. If a judge has to infer that WebMCP did something, WebMCP Leverage suffers.
3. The written description must stand alone.

**Video structure (under 3:00)** — from the loop in [`idea.md` §11](./idea.md):

| Time | Content |
| --- | --- |
| 0:00–0:15 | Open on the working canvas: show one agent tool call changing visible pixels immediately. No title screen. |
| 0:15–0:35 | The problem and thesis: generated “pixel art” is blurry/off-grid; canvas → indexed text grid → precise shared editing. |
| 0:35–1:15 | Human draws a cobblestone; agent reads it, fixes shading, fails the seam check, fixes it, passes |
| 1:15–2:05 | Doodle uploaded → pixelised → 4 directions → walk cycle. The palette check catches a violation and the agent fixes it. |
| 2:05–2:35 | Human takes back over, hand-fixes pixels, exports; assets dropped into a real engine |
| 2:35–2:50 | Tool list on screen; one sentence on why a remote MCP server couldn't do this |
| 2:50–3:00 | Live URL + repo |

Animation and the character pipeline are the memorable part — give them the middle minute, not the tail.

**Fallback if WebMCP is flaky on the day:** the in-app **Agent Console** invokes the same handlers. It proves the tool layer to anyone without a WebMCP-capable browser and is a demo safety net. The video still shows the genuine path.

---

## 5. Eligibility

Entrant must be of legal age of majority in their country of residence, in a country where OpenAI API access is supported.

**Excluded** territories: Belarus, Brazil, China, Crimea, Cuba, Donetsk People's Republic, Hong Kong, Iran, North Korea, Luhansk People's Republic, Quebec, Russia, Syria, Venezuela.

Also excluded: employees/representatives of Devpost, OpenAI, or promotion entities; judges and their employers; anyone with a real or apparent conflict of interest.

**Action:** confirm residency eligibility before investing further. Winners complete affidavits within 10 business days; US entrants may need a W-9, international a W-8BEN.

---

## 6. Pre-submission checklist

**Repo**
- [ ] Public
- [x] `LICENSE` (MIT) at root; confirm GitHub shows the licence badge after push
- [ ] `README.md`: what it is, live URL, local setup, **how to enable WebMCP in Chrome**, tool list, acknowledgements
- [ ] `bun run lint`, `bun run typecheck`, `bun run build` all pass
- [ ] No secrets committed; `.env.example` accurate
- [ ] Third-party attributions recorded (see §2)

**Deployment**
- [ ] Live URL loads cold in incognito
- [ ] Backend health-checked from the deployed frontend, not just locally
- [x] Cloud Run `min-instances: 1` set for the judging period
- [ ] No login required to reach the editor
- [ ] Works in Chrome 149+ with `chrome://flags/#enable-webmcp-testing`
- [ ] Works in the ChatGPT in-app browser
- [ ] Tools appear in the Model Context Tool Inspector extension
- [ ] Pre-seeded example assets load, so a cold visitor sees art and an animation immediately
- [ ] No console errors on load
- [ ] Mobile doesn't visibly break

**Video**
- [ ] Under 3:00
- [ ] Audio narration audible
- [ ] Public on YouTube — verify in a logged-out window
- [ ] Shows a WebMCP tool call causing a visible canvas change
- [ ] Ends on the live URL

**Devpost**
- [ ] Description names all four required points explicitly: why WebMCP fits, UX improvement, what people and agents can now do together, and implementation details
- [ ] Live URL, repo URL, YouTube URL filled and tested logged-out
- [ ] Team representative designated
- [ ] Submitted before 3 Sep 2026, 1:00pm PDT
