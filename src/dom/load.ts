import { compile, type CompileResult } from "../core/compile.ts";

/**
 * Fetches a nudg file and everything it imports, then compiles it. The compiler is
 * synchronous, so imports are fetched first and served from memory.
 */
export async function compileUrl(url: string | URL): Promise<CompileResult> {
  const entry = new URL(url, document.baseURI);
  const texts = new Map<string, string>();
  await fetchImports(entry, texts);
  const text = texts.get(entry.pathname);
  if (text === undefined) throw new Error(`Could not load ${entry.href}`);
  return compile({ path: entry.pathname, text }, (path) => texts.get(path));
}

/**
 * Compiles nudg text that isn't on the server (an editor, a paste), fetching its
 * imports relative to `url`: the address the text would have if it were a file.
 */
export async function compileText(text: string, url: string | URL): Promise<CompileResult> {
  const entry = new URL(url, document.baseURI);
  const texts = new Map<string, string>([[entry.pathname, text]]);
  await fetchImports(entry, texts);
  return compile({ path: entry.pathname, text }, (path) => texts.get(path));
}

/** Loads every file `u` imports (transitively) into `texts`; `u` itself is fetched unless already present. */
async function fetchImports(u: URL, texts: Map<string, string>): Promise<void> {
  async function fetchTree(u: URL): Promise<void> {
    let text = texts.get(u.pathname);
    if (text === undefined) {
      const response = await fetch(u);
      if (!response.ok) return;
      text = await response.text();
      texts.set(u.pathname, text);
    } else if (u.pathname !== entryPath) {
      return;
    }
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
  const entryPath = u.pathname;
  await fetchTree(u);
}
