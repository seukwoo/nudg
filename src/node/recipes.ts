import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface RecipeGap {
  capability: string;
  status: "missing" | "workaround";
  need: string;
}

export interface Recipe {
  id: string;
  aliases: string[];
  summary: string;
  /** null when the format can't express the pattern yet; `gaps` then say what the host does. */
  starter: string | null;
  examples: string[];
  parts: { required: string[]; optional: string[] };
  states: string[];
  events: string[];
  inputs: string[];
  hostResponsibilities: string[];
  motion: string[];
  gaps: RecipeGap[];
}

interface RecipeCatalog {
  version: number;
  recipes: Recipe[];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let cached: RecipeCatalog | undefined;

export function recipeCatalog(): RecipeCatalog {
  cached ??= JSON.parse(readFileSync(join(ROOT, "recipes/index.json"), "utf8")) as RecipeCatalog;
  return cached;
}

const normalized = (name: string) => name.trim().toLowerCase().replace(/[_\s]+/g, "-");

export function findRecipe(name: string): Recipe | undefined {
  const wanted = normalized(name);
  return recipeCatalog().recipes.find((recipe) => recipe.id === wanted || recipe.aliases.some((alias) => normalized(alias) === wanted));
}

/** The starter file, or undefined for a gap-only recipe. */
export function recipeSource(recipe: Recipe): string | undefined {
  return recipe.starter ? readFileSync(join(ROOT, "examples", `${recipe.starter}.nudg.json`), "utf8") : undefined;
}

export const noStarter = (recipe: Recipe) =>
  `${recipe.id} has no starter: the format can't express its essential motion yet (${recipe.gaps.filter((gap) => gap.status === "missing").map((gap) => gap.capability).join(", ")}). Build what the contract allows and leave the gaps to the host.`;

export interface GapCount {
  capability: RecipeGap["capability"];
  missing: string[];
  workaround: string[];
}

/** Gaps across the catalog, most needed first: the evidence for the next motion primitive. */
export function recipeGaps(): GapCount[] {
  const counts = new Map<string, GapCount>();
  for (const recipe of recipeCatalog().recipes) {
    for (const gap of recipe.gaps) {
      const count = counts.get(gap.capability) ?? { capability: gap.capability, missing: [], workaround: [] };
      count[gap.status].push(recipe.id);
      counts.set(gap.capability, count);
    }
  }
  const size = (count: GapCount) => count.missing.length + count.workaround.length;
  return [...counts.values()].sort((a, b) => size(b) - size(a) || b.missing.length - a.missing.length || a.capability.localeCompare(b.capability));
}

export function formatGaps(gaps: GapCount[]): string {
  return gaps
    .map(({ capability, missing, workaround }) => `${capability.padEnd(24)} ${String(missing.length + workaround.length).padStart(2)}  ${[...missing, ...workaround.map((id) => `${id} (workaround)`)].join(", ")}`)
    .join("\n");
}

export function formatRecipe(recipe: Recipe): string {
  const line = (label: string, values: string[]) => `${label}: ${values.length ? values.join(", ") : "none"}`;
  const gaps = recipe.gaps.length ? recipe.gaps.map((gap) => `- ${gap.capability} (${gap.status}): ${gap.need}`).join("\n") : "- none";
  return [
    `${recipe.id} (${recipe.aliases.join(", ")})`,
    recipe.summary,
    "",
    line("Required parts", recipe.parts.required),
    line("Optional parts", recipe.parts.optional),
    line("States", recipe.states),
    line("Events", recipe.events),
    line("Inputs", recipe.inputs),
    line("Host", recipe.hostResponsibilities),
    line("Motion", recipe.motion),
    recipe.starter ? `Starter: examples/${recipe.starter}.nudg.json` : "Starter: none; the format can't express this pattern yet, so the host does what the gaps describe",
    line("Examples", recipe.examples),
    "Motion gaps:",
    gaps,
  ].join("\n");
}
