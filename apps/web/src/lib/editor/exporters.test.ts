/** Export adapters retain the authored timing rather than replacing it with a default. */
import { afterEach, expect, spyOn, test } from "bun:test";
import { createDocument, createStore } from "@zenith/core";
import * as animation from "@/lib/animation";
import * as spritesheet from "@/lib/spritesheet";
import { exportEngine, exportGif, exportSpritesheet } from "./exporters";

const restore: (() => void)[] = [];
afterEach(() => { for (const reset of restore.splice(0)) reset(); });

function mixedTiming() {
  const store = createStore(createDocument({ width: 2, height: 2, frameCount: 2, palette: ["#000000"] }));
  store.setFrameDuration(0, 80);
  store.setFrameDuration(1, 350);
  return store;
}

/**
 * Asserted through the injectable sink, not by mocking an internal.
 *
 * This used to stub `gridToPngBlob` and expect the rejection to abort the
 * export before anything downloaded. When the exports were refactored to build
 * bytes with `encodeIndexedPng` and hand them to an `ExportSink`, that internal
 * stopped being called at all — so the stub never fired, the real
 * `downloadBlob` reached for `document` in a runtime that has none, and the
 * failure read as "document is not defined" rather than as a stale test.
 *
 * The sink is the seam the refactor introduced, and it is a public parameter,
 * so a test written against it survives whatever the inside does next.
 */
test("spritesheet and engine exports keep each saved frame duration", async () => {
  const pack = spyOn(spritesheet, "packSpritesheet");
  restore.push(() => pack.mockRestore());

  const saved: string[] = [];
  const sink = (_blob: Blob, filename: string): void => { saved.push(filename); };

  const store = mixedTiming();
  await exportSpritesheet(store, "hero", sink);
  await exportEngine(store, "hero", "phaser", sink);

  // The durations are what this test is named for: every packed frame carries
  // the authored timing rather than a default.
  for (const [frames] of pack.mock.calls) expect(frames.map((frame) => frame.durationMs)).toEqual([80, 350]);
  expect(pack).toHaveBeenCalledTimes(2);
  // And the exports reached the sink rather than the browser.
  expect(saved).toContain("hero.png");
  expect(saved.length).toBeGreaterThanOrEqual(3);
});

test("GIF export preserves mixed timing unless FPS is explicitly supplied", () => {
  const gif = spyOn(animation, "encodeGif").mockImplementation(() => { throw new Error("stop before download"); });
  restore.push(() => gif.mockRestore());
  const store = mixedTiming();
  expect(() => exportGif(store, "hero")).toThrow("stop before download");
  expect(gif.mock.calls[0]?.[2]?.delayMs).toEqual([80, 350]);
  expect(() => exportGif(store, "hero", 4)).toThrow("stop before download");
  expect(gif.mock.calls[1]?.[2]?.delayMs).toBe(250);
  expect(store.snapshot().frames.map((frame) => frame.durationMs)).toEqual([80, 350]);
});
