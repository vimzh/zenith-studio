import { describe, expect, test } from "bun:test";
import { session } from "./session";
import { exportGif, type ExportSink } from "./exporters";

/** Delays from every Graphic Control Extension, in milliseconds. */
function gifDelays(bytes: Uint8Array): number[] {
  const delays: number[] = [];
  for (let at = 0; at + 5 < bytes.length; at += 1) {
    if (bytes[at] === 0x21 && bytes[at + 1] === 0xf9 && bytes[at + 2] === 0x04) {
      delays.push(((bytes[at + 4] as number) | ((bytes[at + 5] as number) << 8)) * 10);
    }
  }
  return delays;
}

describe("GIF export speed", () => {
  function twoFrames(): { store: NonNullable<typeof session.active>; captured: Blob[] } {
    for (const asset of session.list()) session.close(asset.id);
    session.create({ name: "boxer", type: "character", width: 8, height: 8, palette: ["#000000", "#ffffff"] });
    const store = session.active!;
    store.setPixels([{ x: 1, y: 1, index: 1 }]);
    store.addFrame({ copyFrom: 0 });
    store.setFrameDuration(0, 600);
    store.setFrameDuration(1, 90);
    return { store, captured: [] };
  }
  const sinkInto = (captured: Blob[]): ExportSink => (blob) => { captured.push(blob); };
  const delaysOf = async (blob: Blob): Promise<number[]> => gifDelays(new Uint8Array(await blob.arrayBuffer()));

  test("authored holds are the default, and speed only scales the clock", async () => {
    const { store, captured } = twoFrames();
    const sink = sinkInto(captured);
    exportGif(store, "boxer", undefined, 1, sink);
    expect(await delaysOf(captured[0]!)).toEqual([600, 90]);
    const message = exportGif(store, "boxer", undefined, 1, sink, 0.5);
    expect(await delaysOf(captured[1]!)).toEqual([1200, 180]);
    expect(message).toContain("at 0.5x speed");
    exportGif(store, "boxer", undefined, 1, sink, 2);
    expect(await delaysOf(captured[2]!)).toEqual([300, 50]);
    // The asset itself was not retimed.
    expect(store.snapshot().frames.map((frame) => frame.durationMs)).toEqual([600, 90]);
  });

  test("a fixed fps is scaled the same way, and a nonsense speed is refused", async () => {
    const { store, captured } = twoFrames();
    exportGif(store, "boxer", 10, 1, sinkInto(captured), 0.5);
    expect(await delaysOf(captured[0]!)).toEqual([200, 200]);
    expect(() => exportGif(store, "boxer", undefined, 1, sinkInto(captured), 0)).toThrow("positive");
  });
});
