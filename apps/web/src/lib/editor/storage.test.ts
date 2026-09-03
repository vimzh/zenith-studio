// A second flush must wait for an earlier transaction whose queue is already drained.
import { expect, test } from "bun:test";
import { createDocument, serializeDocument } from "@zenith/core";
import { AssetStorage } from "./storage";

for (const kind of ["asset", "tree"] as const) test(`flush waits for a ${kind} write already in flight and does not report ready before commit`, async () => {
  const assetStorage = new AssetStorage();
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const transactions: { oncomplete?: () => void }[] = [];
  const database = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const transaction = { objectStore: () => ({ put: () => {}, count: () => ({ result: 1 }) }), oncomplete: undefined as (() => void) | undefined };
      transactions.push(transaction);
      return transaction;
    },
  };
  const request = { result: database, onsuccess: undefined as (() => void) | undefined };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open: () => {
    queueMicrotask(() => request.onsuccess?.());
    return request;
  } } });
  try {
    await assetStorage.open();
    if (kind === "asset") assetStorage.save({ id: "flush-test", name: "Flush", type: "tile", order: 0, document: serializeDocument(createDocument({ width: 2, height: 2, palette: ["#000000"] })) });
    const first = kind === "asset" ? assetStorage.flush() : assetStorage.saveTree({ projects: [] });
    let complete = false;
    const second = assetStorage.flush().then(() => { complete = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(complete).toBe(false);
    expect(assetStorage.state).toBe("saving");
    transactions[0]!.oncomplete!();
    await Promise.all([first, second]);
    expect(complete).toBe(true);
    expect(assetStorage.state).toBe("ready");
  } finally {
    for (const transaction of transactions) transaction.oncomplete?.();
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});
