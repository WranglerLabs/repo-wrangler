import assert from "node:assert/strict";
import test from "node:test";
import { createReleaseSpec } from "./create-release-spec.mjs";

test("maps four targets to three immutable release bundles", () => {
  const spec = createReleaseSpec({
    version: "v1.2.3",
    releasedAt: "2026-07-16T20:00:00Z",
    assetBaseURL: "https://github.com/WranglerLabs/repo-wrangler/releases/download/v1.2.3",
    image: "ghcr.io/wranglerlabs/repo-wrangler-server",
    imageDigest: `sha256:${"a".repeat(64)}`,
    minimumSourceVersion: "v1.0.23",
    databaseSchemaMinimum: 9,
    databaseSchemaMaximum: 9,
    databaseSchemaTarget: 9,
  });
  assert.equal(spec.artifacts.length, 4);
  assert.equal(new Set(spec.artifacts.map((artifact) => artifact.path)).size, 3);
  assert.ok(spec.artifacts.every((artifact) => artifact.url.startsWith("https://")));
  assert.ok(spec.artifacts.every((artifact) => artifact.sbomUrl.endsWith(".spdx.json")));
  assert.ok(spec.artifacts.every((artifact) => artifact.attestationUrl.endsWith(".provenance.sigstore.json")));
  assert.equal(spec.containerImages.length, 3);
  assert.ok(spec.containerImages.every((entry) => entry.digest === `sha256:${"a".repeat(64)}`));
  assert.equal(spec.compatibility.databaseSchema.target, 9);
  assert.deepEqual(spec.compatibility.targets, [
    "azure-container-apps", "cloudflare", "local-compose", "remote-linux-compose",
  ]);
});

test("rejects floating versions and non-HTTPS release locations", () => {
  const otherwiseValid = {
    version: "v1.2.3", releasedAt: new Date().toISOString(),
    assetBaseURL: "https://example.test/releases/download/v1.2.3",
    image: "ghcr.io/wranglerlabs/repo-wrangler-server",
    imageDigest: `sha256:${"a".repeat(64)}`,
    minimumSourceVersion: "v1.0.23",
    databaseSchemaMinimum: 9, databaseSchemaMaximum: 9, databaseSchemaTarget: 9,
  };
  assert.throws(() => createReleaseSpec({ ...otherwiseValid, version: "latest" }), /explicit semantic version/);
  assert.throws(() => createReleaseSpec({ ...otherwiseValid, assetBaseURL: "http://example.test" }), /HTTPS/);
  assert.throws(() => createReleaseSpec({ ...otherwiseValid, imageDigest: "sha256:not-a-digest" }), /image-digest/);
});
