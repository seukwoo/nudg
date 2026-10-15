// Finds a local Chrome or Chromium for rasterizing and snapshots. Optional: nudg
// works without it, and says how to point at one.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];
const ON_PATH = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];

export const CHROME_HINT = "Install Chrome or Chromium, or set NUDG_CHROME to its executable.";

/**
 * Opens a file or URL in the person's default browser. Never throws; false when it
 * couldn't, or when NUDG_OPEN=false (CI, a headless box, a person who'd rather not).
 */
export function openInBrowser(target: string): boolean {
  if (/^(false|0|no)$/i.test(process.env.NUDG_OPEN ?? "")) return false;
  try {
    const [cmd, args] = process.platform === "darwin" ? ["open", [target]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", target]] : ["xdg-open", [target]];
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function findChrome(): string | undefined {
  const fromEnv = process.env.NUDG_CHROME;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : undefined;
  const found = CANDIDATES.find((p) => existsSync(p));
  if (found) return found;
  for (const name of ON_PATH) {
    const which = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" });
    const path = which.stdout?.split("\n")[0]?.trim();
    if (which.status === 0 && path) return path;
  }
  return undefined;
}

/** Renders an SVG string to a PNG at 2x, using headless Chrome. */
export function svgToPng(svg: string, width: number, height: number, outPath: string, chrome: string): void {
  const dir = mkdtempSync(join(tmpdir(), "nudg-"));
  try {
    const svgPath = join(dir, "plot.svg");
    writeFileSync(svgPath, svg);
    const result = spawnSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=2",
        `--user-data-dir=${join(dir, "profile")}`,
        `--window-size=${width},${height}`,
        `--screenshot=${outPath}`,
        pathToFileURL(svgPath).href,
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    if (result.status !== 0 || !existsSync(outPath)) {
      throw new Error(`Chrome could not render the PNG: ${result.stderr || result.error?.message || "unknown error"}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
