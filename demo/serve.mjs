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
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".webm": "video/webm",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Starts the server; resolves with it once it's listening. Port 0 picks a free port;
 * a busy port falls through to the next ones, up to ten tries.
 */
export function serve(port = 8787, host = "127.0.0.1") {
  return new Promise((resolveListening, reject) => {
    const server = createServer(handle);
    let tries = 0;
    const attempt = (p) => {
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && p !== 0 && ++tries < 10) attempt(p + 1);
        else reject(err);
      });
      server.listen(p, host, () => resolveListening(server));
    };
    attempt(port);
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
  const type = TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  const size = statSync(path).size;
  const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, {
      "accept-ranges": "bytes",
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-type": type,
      "cache-control": "no-store",
    });
    return createReadStream(path, { start, end }).pipe(res);
  }
  res.writeHead(200, { "accept-ranges": "bytes", "content-length": size, "content-type": type, "cache-control": "no-store" });
  createReadStream(path).pipe(res);
}

function end(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);
  const server = await serve(port);
  const actual = server.address().port;
  if (actual !== port) console.log(`Port ${port} is in use (another server, or an earlier \`npm run demo\`?); using ${actual} instead.`);
  console.log(`nudg examples: http://localhost:${actual}/demo/`);
  if (!existsSync(join(root, "dist", "dom", "index.js"))) console.log("dist/ is missing: run `npm run build` first, or use `npm run demo`.");
}
