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
  starter: string;
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

export function recipeSource(recipe: Recipe): string {
  return readFileSync(join(ROOT, "examples", `${recipe.starter}.nudg.json`), "utf8");
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
    `Starter: examples/${recipe.starter}.nudg.json`,
    `Examples: ${recipe.examples.join(", ")}`,
    "Motion gaps:",
    gaps,
  ].join("\n");
}
