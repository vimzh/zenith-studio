import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as core from "../src/index";

const SOURCE_DIR = join(import.meta.dir, "..", "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/**
 * Blanks comments and string literals, preserving line structure.
 *
 * Needed because the check below is a word search, and `any` is an ordinary
 * English word: a doc comment reading "any pixel entry recorded after a
 * structural one" is not an `any` type. Rewording the prose would have been a
 * smaller change and the wrong one — it leaves a tripwire for whoever next
 * writes a normal sentence.
 *
 * Line and block comments both, since a block comment's continuation lines are
 * exactly where prose accumulates. Falls back to reporting a false positive
 * rather than a false negative if it ever meets a construct it cannot parse.
 */
function blankCommentsAndStrings(source: string): string {
  type Mode = "code" | "line" | "block" | "'" | '"' | "`";
  let mode: Mode = "code";
  let result = "";
  let index = 0;

  const keepNewline = (char: string): string => (char === "\n" ? "\n" : " ");

  while (index < source.length) {
    const char = source[index] as string;
    const next = source[index + 1];

    if (mode === "code") {
      if (char === "/" && next === "/") {
        mode = "line";
        result += "  ";
        index += 2;
      } else if (char === "/" && next === "*") {
        mode = "block";
        result += "  ";
        index += 2;
      } else if (char === "'" || char === '"' || char === "`") {
        mode = char;
        result += " ";
        index += 1;
      } else {
        result += char;
        index += 1;
      }
      continue;
    }

    if (mode === "line") {
      if (char === "\n") mode = "code";
      result += keepNewline(char);
      index += 1;
      continue;
    }

    if (mode === "block") {
      if (char === "*" && next === "/") {
        mode = "code";
        result += "  ";
        index += 2;
      } else {
        result += keepNewline(char);
        index += 1;
      }
      continue;
    }

    // Inside a string literal.
    if (char === "\\") {
      result += "  ";
      index += 2;
      continue;
    }
    if (char === mode) mode = "code";
    result += keepNewline(char);
    index += 1;
  }

  return result;
}

/** Exit criterion: no `any` in the store's public surface. Enforced across the whole package. */
describe("public surface", () => {
  test("contains no `any`", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SOURCE_DIR)) {
      const source = readFileSync(path, "utf8");
      const original = source.split("\n");
      blankCommentsAndStrings(source)
        .split("\n")
        .forEach((line, index) => {
          if (/\bany\b/.test(line)) {
            offenders.push(`${path}:${String(index + 1)}: ${(original[index] ?? "").trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  test("the `any` check ignores prose and string literals but not types", () => {
    const prose = blankCommentsAndStrings("/**\n * any pixel entry\n */\nconst a = 1;");
    expect(/\bany\b/.test(prose)).toBe(false);

    expect(/\bany\b/.test(blankCommentsAndStrings('const message = "accepts any value";'))).toBe(false);
    expect(/\bany\b/.test(blankCommentsAndStrings("// returns any of them"))).toBe(false);

    // The thing it must still catch.
    expect(/\bany\b/.test(blankCommentsAndStrings("function f(value: any): void {}"))).toBe(true);
    expect(/\bany\b/.test(blankCommentsAndStrings("const x = y as any;"))).toBe(true);
    expect(/\bany\b/.test(blankCommentsAndStrings("type T = Record<string, any>;"))).toBe(true);
  });

  test("exports the phase 01 surface", () => {
    for (const name of [
      "DocumentStore",
      "createStore",
      "createDocument",
      "createGrid",
      "encodeGrid",
      "decodeGrid",
      "createPalette",
      "nearestIndex",
      "quantize",
      "rgbToOklab",
      "serializeDocument",
      "deserializeDocument",
      "PixelError",
      "TRANSPARENT",
      "MAX_PALETTE_SIZE",
    ]) {
      expect(core).toHaveProperty(name);
    }
  });

  test("exposes every mutation named in the phase plan", () => {
    const store = core.createStore(
      core.createDocument({ width: 2, height: 2, palette: core.builtinPalette("gb-dmg") }),
    );
    for (const method of [
      "setPixels",
      "writeRegion",
      "fillRegion",
      "bucketFill",
      "replaceColor",
      "clearRegion",
      "shift",
      "mirror",
      "undo",
      "redo",
      "transaction",
    ]) {
      expect(typeof (store as unknown as Record<string, unknown>)[method]).toBe("function");
    }
  });
});
