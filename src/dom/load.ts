import { compile, type CompileResult } from "../core/compile.ts";

/**
 * Fetches a nudg file and everything it imports, then compiles it. The compiler is
 * synchronous, so imports are fetched first and served from memory.
 */
export async function compileUrl(url: string | URL): Promise<CompileResult> {
  const entry = new URL(url, document.baseURI);
  const texts = new Map<string, string>();

  async function fetchTree(u: URL): Promise<void> {
    if (texts.has(u.pathname)) return;
    const response = await fetch(u);
    if (!response.ok) return;
    const text = await response.text();
    texts.set(u.pathname, text);
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      return;
    }
    const imports = (doc as { import?: unknown }).import;
    if (Array.isArray(imports)) {
      await Promise.all(imports.filter((i) => typeof i === "string").map((i) => fetchTree(new URL(i, u))));
    }
  }

  await fetchTree(entry);
  const text = texts.get(entry.pathname);
  if (text === undefined) throw new Error(`Could not load ${entry.href}`);
  return compile({ path: entry.pathname, text }, (path) => texts.get(path));
}
