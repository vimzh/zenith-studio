/** Timeline timing reflects the document, never a disconnected local FPS default. */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, createStore, type DocumentStore } from "@zenith/core";
import { FrameTimeline } from "./frame-timeline";

function fpsControl(store: DocumentStore): string {
  const markup = renderToStaticMarkup(<FrameTimeline store={store} onionSkin={false} onToggleOnionSkin={() => {}} />);
  return markup.match(/<input[^>]*aria-label="Frames per second"[^>]*>/)?.[0] ?? "";
}

test("new animation timing displays 4 fps", () => {
  const store = createStore(createDocument({ width: 4, height: 4, frameCount: 2, palette: ["#000000"] }));
  expect(fpsControl(store)).toContain('value="4"');
});

test("saved custom timings display their actual FPS without rewriting frames", () => {
  const store = createStore(createDocument({ width: 4, height: 4, frameCount: 2, palette: ["#000000"] }));
  store.setFrameDuration(0, 100);
  store.setFrameDuration(1, 100);
  const before = store.snapshot();
  expect(fpsControl(store)).toContain('value="10"');
  expect(store.snapshot()).toEqual(before);
});

test("mixed frame timings remain mixed and are not reported as one FPS", () => {
  const store = createStore(createDocument({ width: 4, height: 4, frameCount: 2, palette: ["#000000"] }));
  store.setFrameDuration(0, 80);
  store.setFrameDuration(1, 350);
  const before = store.snapshot();
  expect(fpsControl(store)).toContain('placeholder="Mixed"');
  expect(fpsControl(store)).toContain('value=""');
  expect(store.snapshot()).toEqual(before);
});
