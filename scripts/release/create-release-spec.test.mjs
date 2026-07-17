import assert from "node:assert/strict";
import test from "node:test";
import { createReleaseSpec } from "./create-release-spec.mjs";

test("maps four targets to three immutable release bundles", () => {
  const spec = createReleaseSpec({
    version: "v1.2.3",
    releasedAt: "2026-07-16T20:00:00Z",
    assetBaseURL: "https://github.com/WranglerLabs/repo-wrangler/releases/download/v1.2.3",
  });
  assert.equal(spec.artifacts.length, 4);
  assert.equal(new Set(spec.artifacts.map((artifact) => artifact.path)).size, 3);
  assert.ok(spec.artifacts.every((artifact) => artifact.url.startsWith("https://")));
  assert.ok(spec.artifacts.every((artifact) => artifact.sbomUrl.endsWith(".spdx.json")));
});

test("rejects floating versions and non-HTTPS release locations", () => {
  assert.throws(() => createReleaseSpec({ version: "latest", releasedAt: new Date().toISOString(), assetBaseURL: "https://example.test" }), /explicit semantic version/);
  assert.throws(() => createReleaseSpec({ version: "v1.2.3", releasedAt: new Date().toISOString(), assetBaseURL: "http://example.test" }), /HTTPS/);
});
