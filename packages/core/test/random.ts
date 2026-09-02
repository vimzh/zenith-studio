/** Seeded RNG so every fuzz failure is reproducible from the seed in the test name. */

export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

export function randomHex(random: () => number): string {
  const channel = (): string =>
    randomInt(random, 0, 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel()}${channel()}${channel()}`;
}

export function randomPaletteColors(random: () => number, size: number): string[] {
  const colors = new Set<string>();
  while (colors.size < size) colors.add(randomHex(random));
  return [...colors];
}
