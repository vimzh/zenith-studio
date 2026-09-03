/**
 * Assembles the animation showcase into one self-contained HTML page.
 *
 * Reads what `showcase-characters.ts` and `run-animations.sh` wrote — each
 * character's indexed sprite and palette, and each animation's plan, judge
 * verdicts, timings, frame holds, looping GIF and 4x strip — and embeds them
 * as data URIs so the page travels as a single file. Strips are recompressed
 * with the product's own `compressIndexedPng`; the encoder writes stored
 * blocks and a 4x strip of nine frames is over four megabytes uncompressed.
 *
 *   bun run scripts/showcase-page.ts <showcase-dir> <out.html>
 */

import { compressIndexedPng } from "../src/lib/export";
import type { FrameVerdict, PlannedPose, PosePlan } from "../src/lib/webmcp/api";

const [dir, out] = Bun.argv.slice(2);
if (dir === undefined || out === undefined) {
  console.error("usage: bun run scripts/showcase-page.ts <showcase-dir> <out.html>");
  process.exit(1);
}

interface CharacterSpec { readonly slug: string; readonly name: string; readonly prompt: string }
interface CharacterFile { readonly name: string; readonly palette: string[]; readonly prompt: string; readonly seconds: number }
interface AnimationRecord {
  readonly slug: string;
  readonly title: string;
  readonly motion: string;
  readonly effects?: string;
  readonly plan: PosePlan;
  readonly planSeconds: number;
  readonly sheetSeconds: number[];
  readonly sheets: number;
  readonly holds: number[];
  readonly frames: number;
  readonly judge: { pass: number; verdicts: FrameVerdict[] }[];
  readonly wall: number | null;
  readonly gif: string;
  readonly gifShare: string;
  readonly restMs: number;
  readonly strip: string;
  readonly stripWidth: number;
}

/** HTML-safe and pure ASCII, so the file reads the same whether or not a charset header travels with it. */
const escape = (text: string): string =>
  text
    .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string)
    .replace(/[^\x00-\x7f]/g, (c) => `&#${String(c.codePointAt(0))};`);
const dataUri = (bytes: Uint8Array, type: string): string => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
const pngWidth = (bytes: Uint8Array): number => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16);
const seconds = (value: number): string => `${value.toFixed(0)}s`;
const title = (slug: string): string => slug.split("-").map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");

async function readAnimation(characterDir: string, slug: string): Promise<AnimationRecord | null> {
  const base = `${characterDir}/${slug}`;
  if (!(await Bun.file(`${base}/frames.json`).exists())) return null;
  const plan = (await Bun.file(`${base}/plan.json`).json()) as { motion: string; effects?: string; plan: PosePlan; planSeconds: number };
  const timing = (await Bun.file(`${base}/timing.json`).json()) as { sheetSeconds: number[]; sheets: number };
  const frames = (await Bun.file(`${base}/frames.json`).json()) as { durations: number[]; frames: unknown[]; gifDelays?: { cycle: number[]; share: number[] } };
  const judgeFile = Bun.file(`${base}/judge.json`);
  const judge = (await judgeFile.exists()) ? ((await judgeFile.json()) as { pass: number; verdicts: FrameVerdict[] }[]) : [];
  const log = (await Bun.file(`${base}/log.txt`).exists()) ? await Bun.file(`${base}/log.txt`).text() : "";
  const wall = /wall (\d+)s/.exec(log);
  const strip = await compressIndexedPng(await Bun.file(`${base}/strip-4x.png`).bytes());
  return {
    slug,
    title: title(slug),
    motion: plan.motion,
    effects: plan.effects,
    plan: plan.plan,
    planSeconds: plan.planSeconds,
    sheetSeconds: timing.sheetSeconds,
    sheets: timing.sheets,
    holds: frames.durations.slice(1),
    frames: frames.frames.length - 1,
    judge,
    wall: wall === null ? null : Number.parseInt(wall[1]!, 10),
    gif: dataUri(await Bun.file(`${base}/cycle.gif`).bytes(), "image/gif"),
    gifShare: dataUri(await Bun.file(`${base}/cycle-share.gif`).bytes(), "image/gif"),
    restMs: frames.gifDelays?.cycle[0] ?? frames.durations[0] ?? 250,
    strip: dataUri(strip, "image/png"),
    stripWidth: pngWidth(strip),
  };
}

interface CharacterEntry {
  readonly spec: CharacterSpec;
  readonly file: CharacterFile;
  readonly preview: string;
  readonly animations: AnimationRecord[];
}

const specs = (await Bun.file(`${dir}/characters.json`).json()) as CharacterSpec[];
const characters: CharacterEntry[] = [];
let totalAnimations = 0;
let totalSheets = 0;
let totalRepairs = 0;
let totalRejectedFinal = 0;
for (const spec of specs) {
  const characterDir = `${dir}/${spec.slug}`;
  const file = (await Bun.file(`${characterDir}/character.json`).json()) as CharacterFile;
  const preview = await compressIndexedPng(await Bun.file(`${characterDir}/character-4x.png`).bytes());
  const entries = await Array.fromAsync(
    (await Array.fromAsync(new Bun.Glob("*/frames.json").scan({ cwd: characterDir }))).map((path) => path.split("/")[0]!),
    (slug) => readAnimation(characterDir, slug),
  );
  const animations = entries.filter((entry): entry is AnimationRecord => entry !== null).sort((a, b) => a.slug.localeCompare(b.slug));
  for (const animation of animations) {
    totalAnimations += 1;
    totalSheets += animation.sheets;
    if (animation.judge.length > 1) totalRepairs += 1;
    const last = animation.judge.at(-1);
    if (last !== undefined) totalRejectedFinal += last.verdicts.filter((verdict) => !verdict.ok).length;
  }
  characters.push({ spec, file, preview: dataUri(preview, "image/png"), animations });
}

function verdictChip(animation: AnimationRecord): string {
  const first = animation.judge[0];
  const last = animation.judge.at(-1);
  if (first === undefined || last === undefined) return `<span class="chip chip-muted">not judged</span>`;
  const rejectedFirst = first.verdicts.filter((verdict) => !verdict.ok);
  const rejectedLast = last.verdicts.filter((verdict) => !verdict.ok);
  if (rejectedFirst.length === 0) return `<span class="chip chip-ok">judge ${String(first.verdicts.length)}/${String(first.verdicts.length)} first pass</span>`;
  if (rejectedLast.length === 0) return `<span class="chip chip-ok">judge ${String(last.verdicts.length)}/${String(last.verdicts.length)} after repair of ${rejectedFirst.map((verdict) => String(verdict.frame)).join(", ")}</span>`;
  return `<span class="chip chip-bad">judge still rejects frame ${rejectedLast.map((verdict) => String(verdict.frame)).join(", ")} after repair</span>`;
}

function judgeNotes(animation: AnimationRecord): string {
  const notes: string[] = [];
  for (const pass of animation.judge) {
    for (const verdict of pass.verdicts) {
      if (!verdict.ok) notes.push(`<li><span class="mono">pass ${String(pass.pass)}, frame ${String(verdict.frame)}</span> ${escape(verdict.problems.join(" "))}</li>`);
    }
  }
  return notes.length === 0 ? "" : `<ul class="notes">${notes.join("")}</ul>`;
}

function poseList(plan: PlannedPose[]): string {
  return `<ol class="poses">${plan
    .map((pose) => `<li><span class="mono hold">${String(pose.ms)}ms${pose.contact === "airborne" ? " &middot; airborne" : ""}</span> ${escape(pose.pose)}${pose.effect === undefined ? "" : ` <em class="effect">Effect: ${escape(pose.effect)}</em>`}</li>`)
    .join("")}</ol>`;
}

function animationBlock(animation: AnimationRecord, still: string): string {
  const cycleMs = animation.holds.reduce((sum, ms) => sum + ms, animation.restMs);
  return `
<article class="animation">
  <header class="animation-head">
    <h3>${escape(animation.title)}</h3>
    <p class="motion">&ldquo;${escape(animation.motion)}&rdquo;${animation.effects === undefined ? "" : ` <span class="muted">with</span> &ldquo;${escape(animation.effects)}&rdquo;`}</p>
    <div class="chips">
      ${verdictChip(animation)}
      <span class="chip mono">${String(animation.frames)} frames &middot; ${String(cycleMs)}ms loop</span>
      <span class="chip mono">plan ${seconds(animation.planSeconds)} &middot; sheet ${animation.sheetSeconds.map(seconds).join(" + ")}${animation.wall === null ? "" : ` &middot; total ${String(animation.wall)}s`}</span>
    </div>
  </header>
  <div class="animation-body">
    <figure class="loop">
      <img class="gif pixel" src="${animation.gifShare}" data-gif="${animation.gif}" data-share="${animation.gifShare}" data-still="${still}" alt="${escape(animation.title)} loop" width="256" height="256">
      <figcaption class="mono muted">rest ${String(animation.restMs)}ms &middot; holds ${animation.holds.map(String).join(" / ")}ms &middot; <span class="speed-label">half speed</span></figcaption>
    </figure>
    <div class="strip-wrap">
      <img class="strip pixel" src="${animation.strip}" alt="${escape(animation.title)} frames" width="${String(animation.stripWidth / 2)}" height="256">
      <p class="mono muted strip-caption">source frame, then frames 1&ndash;${String(animation.frames)} &middot; scroll sideways</p>
    </div>
  </div>
  <details class="plan">
    <summary>Plan and judge</summary>
    <p class="muted">Planner read the source as: ${escape(animation.plan.source || "&mdash;")}</p>
    ${poseList(animation.plan.frames)}
    ${judgeNotes(animation)}
  </details>
</article>`;
}

function characterSection(entry: CharacterEntry): string {
  const swatches = entry.file.palette.map((hex) => `<span class="swatch" style="background:${hex}" title="${hex}"></span>`).join("");
  return `
<section class="character" id="${entry.spec.slug}">
  <aside class="character-card">
    <img class="pixel portrait" src="${entry.preview}" alt="${escape(entry.spec.name)}" width="256" height="256">
    <h2>${escape(entry.spec.name.replace(/ east$/, ""))}</h2>
    <p class="muted small">${escape(entry.file.prompt)}</p>
    <div class="palette" aria-label="${String(entry.file.palette.length)}-colour palette">${swatches}</div>
    <p class="mono muted small">128&times;128 &middot; ${String(entry.file.palette.length)} colours &middot; generated in ${seconds(entry.file.seconds)}</p>
  </aside>
  <div class="animations">
    ${entry.animations.map((animation) => animationBlock(animation, entry.preview)).join("")}
  </div>
</section>`;
}

const html = `<title>Zenith Animation Showcase</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>
  :root {
    --ground: #f4f3f0;
    --panel: #fcfbf9;
    --ink: #1a1b1e;
    --muted: #686a70;
    --line: #d8d6d0;
    --check-a: #ecebe7;
    --check-b: #f8f7f4;
    --ok: #2f7a4b;
    --ok-bg: #e4f1e8;
    --bad: #b03d2e;
    --bad-bg: #f7e3df;
    --chip: #ebeae6;
    --spacing: 0.22rem;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground: #141518; --panel: #1b1c20; --ink: #ecebe7; --muted: #9c9ea6; --line: #2d2e33;
      --check-a: #202126; --check-b: #26272c; --ok: #6fc48f; --ok-bg: #1e3327; --bad: #ec8a7a; --bad-bg: #3d2320; --chip: #26272c;
    }
  }
  :root[data-theme="dark"] {
    --ground: #141518; --panel: #1b1c20; --ink: #ecebe7; --muted: #9c9ea6; --line: #2d2e33;
    --check-a: #202126; --check-b: #26272c; --ok: #6fc48f; --ok-bg: #1e3327; --bad: #ec8a7a; --bad-bg: #3d2320; --chip: #26272c;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ground); color: var(--ink); font-family: Geist, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; }
  .mono { font-family: "Geist Mono", "SFMono-Regular", Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); }
  .small { font-size: 12px; }
  .pixel { image-rendering: pixelated; image-rendering: crisp-edges; }
  h1, h2, h3 { text-wrap: balance; margin: 0; font-weight: 600; letter-spacing: -0.01em; }
  h1 { font-size: 22px; }
  h2 { font-size: 17px; }
  h3 { font-size: 15px; }
  a { color: inherit; }
  .page { max-width: 1280px; margin: 0 auto; padding: calc(var(--spacing) * 8) calc(var(--spacing) * 6) calc(var(--spacing) * 16); display: flex; flex-direction: column; gap: calc(var(--spacing) * 8); }
  .masthead { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: calc(var(--spacing) * 3); border-bottom: 1px solid var(--line); padding-bottom: calc(var(--spacing) * 4); }
  .masthead p { margin: 0; max-width: 62ch; }
  .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 2px; }
  .totals div { background: var(--panel); padding: calc(var(--spacing) * 3) calc(var(--spacing) * 4); }
  .totals strong { display: block; font-size: 20px; font-weight: 600; }
  .controls { display: flex; align-items: center; gap: calc(var(--spacing) * 2); font-size: 12px; }
  .controls label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .toc { display: flex; flex-wrap: wrap; gap: calc(var(--spacing) * 2); }
  .toc a { text-decoration: none; border: 1px solid var(--line); border-radius: 3px; padding: 2px 10px; background: var(--panel); font-size: 12px; }
  .toc a:hover, .toc a:focus-visible { border-color: var(--ink); outline: none; }
  .character { display: grid; grid-template-columns: 288px 1fr; gap: calc(var(--spacing) * 6); align-items: start; border-top: 1px solid var(--line); padding-top: calc(var(--spacing) * 6); }
  .character-card { position: sticky; top: calc(var(--spacing) * 4); display: flex; flex-direction: column; gap: calc(var(--spacing) * 3); }
  .character-card p { margin: 0; }
  .portrait, .gif, .strip { background-color: var(--check-b); background-image: linear-gradient(45deg, var(--check-a) 25%, transparent 25%, transparent 75%, var(--check-a) 75%), linear-gradient(45deg, var(--check-a) 25%, transparent 25%, transparent 75%, var(--check-a) 75%); background-size: 16px 16px; background-position: 0 0, 8px 8px; border: 1px solid var(--line); border-radius: 2px; display: block; }
  .portrait { width: 256px; height: 256px; }
  .palette { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; width: 256px; }
  .swatch { display: block; height: 18px; border: 1px solid var(--line); border-radius: 2px; }
  .animations { display: flex; flex-direction: column; gap: calc(var(--spacing) * 5); min-width: 0; }
  .animation { border: 1px solid var(--line); border-radius: 2px; background: var(--panel); padding: calc(var(--spacing) * 4); display: flex; flex-direction: column; gap: calc(var(--spacing) * 4); min-width: 0; }
  .animation-head { display: flex; flex-direction: column; gap: calc(var(--spacing) * 2); }
  .animation-head p { margin: 0; }
  .motion { max-width: 80ch; }
  .chips { display: flex; flex-wrap: wrap; gap: calc(var(--spacing) * 2); }
  .chip { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 3px; background: var(--chip); border: 1px solid var(--line); }
  .chip-ok { color: var(--ok); background: var(--ok-bg); border-color: transparent; }
  .chip-bad { color: var(--bad); background: var(--bad-bg); border-color: transparent; }
  .chip-muted { color: var(--muted); }
  .animation-body { display: grid; grid-template-columns: 256px minmax(0, 1fr); gap: calc(var(--spacing) * 4); align-items: start; }
  figure { margin: 0; display: flex; flex-direction: column; gap: 4px; }
  figcaption, .strip-caption { font-size: 11px; margin: 0; }
  .gif { width: 256px; height: 256px; }
  .strip-wrap { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .strip-wrap > div, .strip-scroll { overflow-x: auto; }
  .strip { height: 256px; width: auto; max-width: none; }
  .strip-wrap { overflow-x: auto; }
  details.plan { border-top: 1px solid var(--line); padding-top: calc(var(--spacing) * 3); }
  summary { cursor: pointer; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  summary:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  .poses { margin: calc(var(--spacing) * 2) 0 0; padding-left: 1.4em; display: flex; flex-direction: column; gap: 4px; max-width: 90ch; }
  .hold { color: var(--muted); font-size: 12px; }
  .effect { color: var(--muted); font-style: normal; }
  .notes { margin: calc(var(--spacing) * 2) 0 0; padding-left: 1.2em; color: var(--bad); max-width: 90ch; }
  .notes li { margin-bottom: 2px; }
  @media (max-width: 900px) {
    .character { grid-template-columns: 1fr; }
    .character-card { position: static; }
    .animation-body { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) { .strip, .gif { transition: none; } }
</style>
<main class="page">
  <header class="masthead">
    <div>
      <p class="eyebrow">Zenith Studio &middot; text-driven animation &middot; 3 September 2026</p>
      <h1>Five characters, fifteen animations</h1>
      <p class="muted">Each character was generated from a prompt, then each animation was planned from the sprite image, drawn as one sprite sheet beside it, cut, registered to the ground line, pixelised into the character's own 16 colours, and checked by a vision judge that redraws what it rejects. Nothing here was retouched by hand. Loops play at half speed with a rest beat, the way a shared GIF should; switch on game speed to see the holds a game would use.</p>
    </div>
    <div class="controls">
      <label><input type="checkbox" id="loop" checked> Play loops</label>
      <label><input type="checkbox" id="gamespeed"> Game speed</label>
    </div>
  </header>
  <section class="totals" aria-label="Run totals">
    <div><span class="eyebrow">Characters</span><strong>${String(characters.length)}</strong></div>
    <div><span class="eyebrow">Animations</span><strong>${String(totalAnimations)}</strong></div>
    <div><span class="eyebrow">Sheets bought</span><strong>${String(totalSheets)}</strong></div>
    <div><span class="eyebrow">Needed a repair</span><strong>${String(totalRepairs)}</strong></div>
    <div><span class="eyebrow">Frames still rejected</span><strong>${String(totalRejectedFinal)}</strong></div>
  </section>
  <nav class="toc" aria-label="Characters">${characters.map((entry) => `<a href="#${entry.spec.slug}">${escape(entry.spec.name.replace(/ east$/, ""))}</a>`).join("")}</nav>
  ${characters.map(characterSection).join("")}
</main>
<script>
  (function () {
    var box = document.getElementById("loop");
    var speed = document.getElementById("gamespeed");
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function apply() {
      var game = speed.checked;
      document.querySelectorAll("img.gif").forEach(function (img) {
        img.src = box.checked ? (game ? img.dataset.gif : img.dataset.share) : img.dataset.still;
      });
      document.querySelectorAll(".speed-label").forEach(function (label) { label.textContent = game ? "game speed" : "half speed"; });
    }
    if (reduce) { box.checked = false; }
    apply();
    box.addEventListener("change", apply);
    speed.addEventListener("change", apply);
  })();
</script>
`;
await Bun.write(out, html);
console.log(`wrote ${out}: ${String(characters.length)} characters, ${String(totalAnimations)} animations, ${(html.length / 1024 / 1024).toFixed(1)} MB`);
