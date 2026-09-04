import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateManifest } from "./generate-release-manifest.mjs";

test("derives immutable file facts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "repo-wrangler-release-"));
  await writeFile(join(directory, "bundle.zip"), "verified bytes");
  const manifest = await generateManifest({
    version: "v1.2.3",
    releasedAt: "2026-07-16T20:00:00Z",
    artifacts: [{
      target: "local-compose",
      path: "bundle.zip",
      url: "https://github.com/WranglerLabs/repo-wrangler/releases/download/v1.2.3/bundle.zip",
      mediaType: "application/zip",
    }],
    containerImages: [{
      target: "local-compose",
      image: "ghcr.io/wranglerlabs/repo-wrangler-server",
      digest: `sha256:${"b".repeat(64)}`,
    }],
    compatibility: {
      minimumSourceVersion: "v1.0.23",
      databaseSchema: { minimum: 9, maximum: 9, target: 9, migrations: [] },
      targets: ["local-compose"],
    },
  }, directory);

  assert.equal(manifest.product, "RepoWrangler");
  assert.equal(manifest.schemaVersion, "1.1");
  assert.equal(manifest.artifacts[0].size, 14);
  assert.match(manifest.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal("path" in manifest.artifacts[0], false);
  assert.equal(manifest.containerImages[0].digest, `sha256:${"b".repeat(64)}`);
});

test("rejects floating versions and insecure URLs", async () => {
  await assert.rejects(() => generateManifest({ version: "latest", releasedAt: new Date().toISOString(), artifacts: [{}] }), /explicit semantic version/);
  const directory = await mkdtemp(join(tmpdir(), "repo-wrangler-release-"));
  await writeFile(join(directory, "bundle.zip"), "bytes");
  await assert.rejects(() => generateManifest({
    version: "v1.2.3",
    releasedAt: new Date().toISOString(),
    artifacts: [{ target: "cloudflare", path: "bundle.zip", url: "http://example.test/bundle.zip" }],
    containerImages: [{ target: "cloudflare", image: "example.test/repo", digest: `sha256:${"a".repeat(64)}` }],
    compatibility: {
      minimumSourceVersion: "v1.0.23",
      databaseSchema: { minimum: 9, maximum: 9, target: 9, migrations: [] },
    },
  }, directory), /must use HTTPS/);
});
