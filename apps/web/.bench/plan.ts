import { DIRECTION_SETS, generationCount, mirrorableFrom, planDirectionSet } from "../src/lib/directions";
for (const set of ["side2", "cardinal4", "ordinal8"] as const) {
  const base = DIRECTION_SETS[set][0];
  const plan = planDirectionSet([base], set);
  console.log(set, "| base:", base,
    "| free mirrors from base alone:", mirrorableFrom([base], set).length,
    "| paid calls for the whole set:", generationCount(plan),
    "| total:", DIRECTION_SETS[set].length);
}
