// `nudg upgrade`: a file's format version raised to the current one. Every format is a
// superset of the one before (1.0 freezes 0.18; 1.1 only keeps opacity loops under reduced
// motion), so a file that validates only needs its version string changed; the rest of the
// text is kept as written.

import { VERSION } from "./vocabulary.ts";

export interface Upgrade {
  /** The version the file declared. */
  from: string;
  /** The file's text with "nudg" (and a "$schema" link to a nudg schema) set to the current version, or the text unchanged when it already is. */
  text: string;
}

/** Raises a file's "nudg" version to the current one, keeping its formatting. Undefined if it declares none. */
export function upgradeText(text: string): Upgrade | undefined {
  let from: unknown;
  try {
    from = (JSON.parse(text) as { nudg?: unknown })?.nudg;
  } catch {
    return undefined;
  }
  if (typeof from !== "string") return undefined;
  if (from === VERSION) return { from, text };
  // Replace the first "nudg" key, once it is known to hold the declared version.
  const match = /("nudg"\s*:\s*)"([^"\\]*)"/.exec(text);
  if (!match || match[2] !== from) return undefined;
  const raised = text.slice(0, match.index) + `${match[1]}"${VERSION}"` + text.slice(match.index + match[0].length);
  // A "$schema" link to the old version's schema follows the file to the new one.
  return { from, text: raised.replace(/("\$schema"\s*:\s*"[^"]*\/nudg-)[0-9.]+(\.schema\.json")/, (_, head, tail) => head + VERSION + tail) };
}
