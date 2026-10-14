// A static server for the examples site: the repository root on 127.0.0.1, with caching
// off so a rebuilt dist/ is always what the browser gets. No dependencies.
//
//   npm run demo        (builds first)
//   node demo/serve.mjs [port]

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** Starts the server; resolves with it once it's listening (port 0 picks a free port). */
export function serve(port = 8787, host = "127.0.0.1") {
  return new Promise((resolveListening, reject) => {
    const server = createServer(handle);
    server.once("error", reject);
    server.listen(port, host, () => resolveListening(server));
  });
}

function handle(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path = resolve(root, "." + decodeURIComponent(url.pathname));
  if (!path.startsWith(root + sep) && path !== root) return end(res, 403, "forbidden");
  if (existsSync(path) && statSync(path).isDirectory()) {
    if (!url.pathname.endsWith("/")) {
      res.writeHead(301, { location: url.pathname + "/" });
      return res.end();
    }
    path = join(path, "index.html");
  }
  if (!existsSync(path) || !statSync(path).isFile()) return end(res, 404, "not found");
  res.writeHead(200, { "content-type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(path).pipe(res);
}

function end(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);
  const server = await serve(port);
  console.log(`nudg examples: http://localhost:${server.address().port}/demo/`);
  if (!existsSync(join(root, "dist", "dom", "index.js"))) console.log("dist/ is missing: run `npm run build` first, or use `npm run demo`.");
}
