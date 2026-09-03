// Generated export bytes remain reachable until their visible handoff is dismissed.
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createDocument, createStore } from "@zenith/core";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toast, type ExternalToast, type ToastT } from "sonner";
import { exportGif, exportIndexedPng, exportPalette } from "./editor/exporters";

const restore: (() => void)[] = [];
let urls: string[];
let notices: ExternalToast[];
let clicks: { url: string; filename: string; attached: boolean }[];

beforeEach(() => {
  urls = [];
  notices = [];
  clicks = [];
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    body: { appendChild: (link: { attached: boolean }) => { link.attached = true; } },
    createElement: () => ({
      href: "", download: "", attached: false,
      click() { clicks.push({ url: this.href, filename: this.download, attached: this.attached }); },
      remove() { this.attached = false; },
    }),
  } });
  restore.push(() => {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
  const createUrl = URL.createObjectURL.bind(URL);
  const urlMock = spyOn(URL, "createObjectURL").mockImplementation(blob => {
    const url = createUrl(blob);
    urls.push(url);
    return url;
  });
  const message = spyOn(toast, "message").mockImplementation((_title, options) => {
    notices.push(options!);
    return notices.length;
  });
  restore.push(() => urlMock.mockRestore(), () => message.mockRestore());
});

afterEach(() => {
  for (const url of urls) URL.revokeObjectURL(url);
  for (const reset of restore.splice(0)) reset();
});

function fixture() {
  return createStore(createDocument({ width: 2, height: 2, frameCount: 2, palette: ["#000000", "#ffffff"] }));
}

test("indexed PNG bytes remain readable after the initial browser download request", async () => {
  const status = exportIndexedPng(fixture(), "hero");
  const response = await fetch(urls[0]!);
  expect(response.status).toBe(200);
  expect(Array.from(new Uint8Array(await response.arrayBuffer()).slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(clicks[0]).toEqual({ url: urls[0]!, filename: "hero.png", attached: true });
  expect(notices[0]?.duration).toBe(Infinity);
  expect(notices[0]?.closeButton).toBe(true);
  expect(status).toContain("Prepared");
});

test("Download action exposes a persistent native link without requiring a synthetic click", async () => {
  exportIndexedPng(fixture(), "hero");
  const action = notices[0]?.action;
  expect(isValidElement(action)).toBe(true);
  if (!isValidElement(action)) throw new Error("Missing native download link");
  const markup = renderToStaticMarkup(action);
  expect(markup).toContain("<a ");
  expect(markup).toContain(`href="${urls[0]!}"`);
  expect(markup).toContain('download="hero.png"');
  expect(markup).toContain(">Download</a>");
  expect(markup).not.toContain("<button");
  expect(clicks).toHaveLength(1);
  expect((await fetch(urls[0]!)).status).toBe(200);
});

test("each file in a multi-file export remains available until its own dismissal", async () => {
  exportGif(fixture(), "hero");
  exportPalette(fixture(), "hero", "hex");
  expect(notices).toHaveLength(2);
  expect((await fetch(urls[0]!)).status).toBe(200);
  expect((await fetch(urls[1]!)).status).toBe(200);
  notices[0]!.onDismiss!({} as ToastT);
  await expect(fetch(urls[0]!)).rejects.toThrow();
  expect((await fetch(urls[1]!)).status).toBe(200);
  notices[1]!.onDismiss!({} as ToastT);
  await expect(fetch(urls[1]!)).rejects.toThrow();
});
