/** Paid tool jobs return promptly without losing the normal execution and safety path. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { session } from "@/lib/editor/session";
import { assetNavigation } from "./navigation";
import { transcript } from "./transcript";
import { ToolJobs } from "./jobs";
import { createToolJobTools } from "./tools/jobs";
import type { ToolDefinition } from "./types";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
beforeEach(() => { transcript.clear(); assetNavigation.clear(); });
afterEach(() => {
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
  else Object.defineProperty(globalThis, "window", originalWindow);
});

function show(id: string | null): void {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { pathname: id === null ? "/home" : `/asset/${id}` } } });
}

function deferred() {
  let resolve!: (text: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function tool(execute: ToolDefinition["execute"], scope: ToolDefinition["scope"] = "always"): ToolDefinition {
  return { name: "paid_probe", scope, network: true, description: "Test only; never makes a network request.", inputSchema: { type: "object", properties: {} }, execute };
}

async function settle(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

test("returns a running job before the deferred tool completes, then records its result and navigation", async () => {
  const pending = deferred();
  const jobs = new ToolJobs();
  const started = jobs.start(tool(() => pending.promise), { prompt: "swing" }, "request-one");
  expect(started.status).toBe("running");
  expect(jobs.get(started.job_id).status).toBe("running");
  expect(transcript.list()).toHaveLength(0);
  assetNavigation.request("new-sprite");
  pending.resolve("Created new-sprite");
  await settle();
  const completed = jobs.get(started.job_id);
  expect(completed.status).toBe("succeeded");
  expect(completed.result).toBe("Created new-sprite");
  expect(completed.context.requested_asset_id).toBe("new-sprite");
  expect(transcript.list()[0]).toMatchObject({ tool: "paid_probe", status: "ok", source: "agent", result: "Created new-sprite" });
});

test("same request and canonical arguments share one execution before and after completion", async () => {
  let calls = 0;
  const pending = deferred();
  const definition = tool(() => { calls += 1; return pending.promise; });
  const jobs = new ToolJobs();
  const args = { prompt: "swing", options: { frames: 4, loop: true } };
  const first = jobs.start(definition, args, "same-request");
  const retry = jobs.start(definition, { options: { loop: true, frames: 4 }, prompt: "swing" }, "same-request");
  expect(retry.job_id).toBe(first.job_id);
  expect(calls).toBe(1);
  expect(() => jobs.start(definition, { prompt: "different" }, "same-request")).toThrow("different");
  expect(() => jobs.start({ ...definition, name: "other_paid" }, args, "same-request")).toThrow("different");
  expect(() => jobs.start(definition, args, "second-request")).toThrow(first.job_id);
  pending.resolve("done");
  await settle();
  expect(jobs.start(definition, args, "same-request").status).toBe("succeeded");
  expect(calls).toBe(1);
});

test("snapshots nested arguments and keeps failure retries idempotent", async () => {
  const pending = deferred();
  const args = { options: { frames: 4 } };
  let received: unknown;
  const definition = tool(async (input) => { await pending.promise; received = input; throw new Error("Model refused the pose"); });
  const jobs = new ToolJobs();
  const job = jobs.start(definition, args, "failed-request");
  args.options.frames = 12;
  pending.resolve("continue");
  await settle();
  await settle();
  expect(received).toEqual({ options: { frames: 4 } });
  expect(jobs.get(job.job_id)).toMatchObject({ status: "failed", error: "Model refused the pose", result: null });
  expect(jobs.start(definition, { options: { frames: 4 } }, "failed-request").job_id).toBe(job.job_id);
  expect(transcript.list()[0]?.status).toBe("error");
});

test("scope restrictions and runTool's visible-target guard still prevent paid execution", async () => {
  let calls = 0;
  const definition = tool(() => { calls += 1; return "unexpected"; }, "character");
  const jobs = new ToolJobs();
  show(null);
  expect(() => jobs.start(definition, {}, "library")).toThrow("current view");
  const tile = session.create({ name: "Tile", type: "tile", preset: "tile-32" });
  show(tile);
  expect(() => jobs.start(definition, {}, "tile")).toThrow("current view");
  const visible = session.create({ name: "Visible", type: "character", preset: "tile-32" });
  session.create({ name: "Hidden", type: "character", preset: "tile-32" });
  show(visible);
  const job = jobs.start(definition, {}, "diverged");
  await settle();
  expect(jobs.get(job.job_id).error).toContain("visible asset");
  expect(calls).toBe(0);
});

test("rejects deterministic tools and invalid identifiers without starting a job", () => {
  const jobs = new ToolJobs();
  const definition = tool(() => "unexpected");
  expect(() => jobs.start({ ...definition, network: false }, {}, "free")).toThrow("paid");
  expect(() => jobs.start({ ...definition, name: "start_tool_job" }, {}, "recursive")).toThrow("job controls");
  expect(() => jobs.start({ ...definition, name: "get_tool_job", network: false }, {}, "polling")).toThrow("paid");
  expect(() => jobs.start(definition, {}, " ")).toThrow("request_id");
  expect(() => jobs.start(definition, { value: undefined }, "invalid-json")).toThrow("JSON");
  expect(() => jobs.get("unknown")).toThrow("Unknown");
});

test("retains all 50 request IDs and refuses new work when session history is full", async () => {
  let calls = 0;
  const definition = tool(() => { calls += 1; return "done"; });
  const jobs = new ToolJobs();
  for (let index = 0; index < 50; index++) {
    jobs.start(definition, {}, `request-${String(index)}`);
    await settle();
  }
  expect(() => jobs.start(definition, {}, "overflow")).toThrow("50");
  expect(jobs.start(definition, {}, "request-0").status).toBe("succeeded");
  expect(calls).toBe(50);
});

test("tool definitions resolve only registered paid names and return JSON job status", async () => {
  const pending = deferred();
  const definition = tool(() => pending.promise);
  const { startToolJob, getToolJob } = createToolJobTools((name) => name === definition.name ? definition : undefined);
  expect(startToolJob.scope).toBe("always");
  expect(startToolJob.network).toBe(true);
  expect(getToolJob.readOnly).toBe(true);
  expect(() => startToolJob.execute({ tool: "unknown", arguments: {}, request_id: "unknown" })).toThrow("Unknown");
  const started = JSON.parse(await startToolJob.execute({ tool: definition.name, arguments: {}, request_id: "factory" })) as { job_id: string; status: string };
  expect(started.status).toBe("running");
  const read = JSON.parse(await getToolJob.execute({ job_id: started.job_id })) as { job_id: string; status: string };
  expect(read.job_id).toBe(started.job_id);
  pending.resolve("finished");
  await settle();
  expect(JSON.parse(await getToolJob.execute({ job_id: started.job_id }))).toMatchObject({ status: "succeeded", result: "finished" });
});
