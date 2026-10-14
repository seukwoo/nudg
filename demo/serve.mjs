// A static server for the examples site: the repository root on 127.0.0.1, with caching
// off so a rebuilt dist/ is always what the browser gets. No dependencies.
//
//   npm run demo        (builds first)
//   node demo/serve.mjs [port]

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);

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

const server = createServer((req, res) => {
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
});

function end(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

server.listen(port, "127.0.0.1", () => {
  const dist = join(root, "dist", "dom", "index.js");
  console.log(`nudg examples: http://localhost:${port}/demo/`);
  if (!existsSync(dist)) console.log("dist/ is missing: run `npm run build` first, or use `npm run demo`.");
});
