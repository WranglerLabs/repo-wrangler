import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assembleReleaseBundles } from "./assemble-release-bundles.mjs";

const digest = "sha256:" + "a".repeat(64);
const postgresDigest = "sha256:" + "b".repeat(64);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "repo-wrangler-bundles-"));
  await Promise.all([
    mkdir(join(root, "assets")),
    mkdir(join(root, "migrations")),
  ]);
  await Promise.all([
    writeFile(join(root, "compose.yaml"), "image: __REPO_WRANGLER_IMAGE__\npostgres: __POSTGRES_IMAGE__\n"),
    writeFile(join(root, "compose.env"), "DEMO_MODE=true\n"),
    writeFile(join(root, "main.json"), "{}\n"),
    writeFile(join(root, "worker.js"), "export default {};\n"),
    writeFile(join(root, "assets", "index.html"), "<h1>RepoWrangler</h1>\n"),
    writeFile(join(root, "migrations", "0001.sql"), "select 1;\n"),
  ]);
  return root;
}

function options() {
  return {
    version: "v1.2.3",
    image: `ghcr.io/wranglerlabs/repo-wrangler-server@${digest}`,
    "postgres-image": `docker.io/library/postgres:16@${postgresDigest}`,
    output: "output",
    "compose-template": "compose.yaml",
    "compose-env": "compose.env",
    "aca-template": "main.json",
    "cloudflare-worker": "worker.js",
    "web-assets": "assets",
    migrations: "migrations",
  };
}

test("assembles clone-free target directories with digest-pinned images", async () => {
  const root = await fixture();
  const result = await assembleReleaseBundles(options(), root);
  const compose = await readFile(join(result.composeDirectory, "compose.yaml"), "utf8");
  const metadata = JSON.parse(await readFile(join(result.composeDirectory, "bundle.json"), "utf8"));
  assert.match(compose, /ghcr\.io\/wranglerlabs\/repo-wrangler-server@sha256:[a-f0-9]{64}/);
  assert.equal(compose.includes("__"), false);
  assert.equal(metadata.version, "v1.2.3");
  assert.equal(metadata.publicHttps, "operator-provided");
});

test("rejects floating product and database images", async () => {
  const root = await fixture();
  const floatingProduct = { ...options(), image: "ghcr.io/wranglerlabs/repo-wrangler-server:latest" };
  await assert.rejects(() => assembleReleaseBundles(floatingProduct, root), /pinned by sha256/);
  const floatingDatabase = { ...options(), "postgres-image": "postgres:16" };
  await assert.rejects(() => assembleReleaseBundles(floatingDatabase, root), /pinned by sha256/);
});
