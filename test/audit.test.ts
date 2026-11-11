// nudg audit: motion outside nudg, what in nudg does it, and gaps nudg can't cover yet.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { audit, formatAudit } from "../src/node/audit.ts";

test("audit finds motion outside nudg and names what does it", () => {
  const a = audit([
    { path: "styles.css", text: ".btn { transition: transform .1s ease; }\n.link { transition: color .2s; }\n@keyframes popIn { from { opacity: 0; transform: scale(.8) } to { opacity: 1 } }\n@keyframes spin { to { transform: rotate(360deg) } }\n@keyframes glow {\n  from { box-shadow: 0 0 0 0 red }\n  to { box-shadow: 0 0 8px red }\n}\n@keyframes nope { 50% { transform: translateX(-8px) } }" },
    { path: "app.tsx", text: 'import { motion } from "framer-motion";\nel.animate([{ opacity: 0 }, { opacity: 1 }], 200);\nel.style.transform = `scale(${s})`;\nel.style.transform = "";\n<div style={{ transition: `opacity ${ms}ms ease` }} />' },
  ]);
  const kinds = a.findings.map((f) => `${f.file}:${f.line} ${f.kind}${f.gap ? " gap" : ""}`);
  assert.deepEqual(kinds, [
    "styles.css:1 css-transition",
    "styles.css:3 css-keyframes",
    "styles.css:4 css-keyframes",
    "styles.css:5 css-keyframes gap",
    "styles.css:9 css-keyframes",
    "app.tsx:1 motion-library",
    "app.tsx:2 web-animation",
    "app.tsx:3 style-write",
    "app.tsx:5 css-transition",
  ]);
  const use = (line: number, file = "styles.css") => a.findings.find((f) => f.file === file && f.line === line)!.use;
  assert.match(use(3), /useNudgOnce\(presets\.pop/);
  assert.match(use(4), /loop in a state/);
  assert.match(use(5), /box-shadow, which no nudg property moves yet/);
  assert.match(use(9), /presets\.shake/);
  assert.equal(a.onNudg, 0);
  assert.equal(a.coverage, 0);
});

test("audit counts nudg uses, the app's own helpers around nudg, and leaves out what is marked or built", () => {
  const a = audit([
    { path: "press.nudg.json", text: "{}" },
    { path: "motion/sheet.ts", text: 'import { useNudg } from "@nudg/core/react";\nexport function useSheet() { return useNudg(sheet); }\nexport const shake = (el) => playDoc(doc, el);' },
    { path: "Sheet.tsx", text: "const s = useSheet();\nshake(field);\nshake(other);" },
    { path: "glue.ts", text: 'import { playDoc } from "@nudg/core/dom";\nsetTimeout(() => p.destroy(), 900);\nsetTimeout(() => setCount(1), 900);\nrequestAnimationFrame(tick);\n// nudg-audit-ignore: a clock\nrequestAnimationFrame(clock);' },
    { path: "meter.ts", text: 'const tick = () => {\n  p.input("host.level", level());\n  requestAnimationFrame(tick);\n};' },
    { path: "bundle.js", text: "x".repeat(4000) + "@keyframes a{}" },
  ]);
  // 1 file, useNudg + playDoc in the helper file, useSheet + shake twice, playDoc import line isn't a call.
  assert.equal(a.onNudg, 1 + 2 + 3);
  assert.deepEqual(a.findings.map((f) => `${f.line} ${f.kind}`), ["2 timer-glue", "4 frame-loop"]);
  assert.equal(a.coverage, 75);
  assert.match(formatAudit(a), /^Motion on nudg: 75% \(6 on nudg, 2 outside, in 6 files\)/);
});

test("the messenger example has all its motion on nudg", () => {
  const out = execFileSync(process.execPath, ["src/cli.ts", "audit", "examples/apps/messenger"], { encoding: "utf8" });
  assert.match(out, /^Motion on nudg: 100% \(\d+ on nudg, 0 outside/);
});
