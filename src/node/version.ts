// The package's own version, and where a generated page script loads nudg from.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
})();

/**
 * The modules `nudg to-css --script` imports: this version of nudg's DOM player and program
 * reader, from jsDelivr (bundled and minified), or from `base`, a copy of the package's
 * dist folder the site serves itself.
 */
export function scriptSources(base?: string): { player: string; programs: string } {
  if (base) {
    const root = base.replace(/\/+$/, "");
    return { player: `${root}/dom/play.js`, programs: `${root}/core/program-json.js` };
  }
  const cdn = `https://cdn.jsdelivr.net/npm/@nudg/core@${PACKAGE_VERSION}/dist`;
  return { player: `${cdn}/dom/play.js/+esm`, programs: `${cdn}/core/program-json.js/+esm` };
}
