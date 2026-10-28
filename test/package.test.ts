// The package's listing in the MCP registry (server.json) names the same server and
// version as package.json, so a release can't publish one without the other.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

test("server.json matches package.json", () => {
  const pkg = read("package.json");
  const server = read("server.json");
  assert.equal(server.name, pkg.mcpName);
  assert.equal(server.version, pkg.version);
  assert.deepEqual(server.packages.map((p: { identifier: string; version: string }) => [p.identifier, p.version]), [[pkg.name, pkg.version]]);
  assert.ok(server.description.length <= 100, "the registry allows 100 characters");
});
