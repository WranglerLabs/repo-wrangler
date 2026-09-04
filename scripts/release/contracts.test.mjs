import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

async function readJSON(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("release schemas compile and the example plan validates", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const manifestSchema = await readJSON("../../release/release-manifest.schema.json");
  const planSchema = await readJSON("../../release/deployment-plan.schema.json");
  const example = await readJSON("../../release/deployment-plan.example.json");

  assert.doesNotThrow(() => ajv.compile(manifestSchema));
  const validateManifest = ajv.compile(manifestSchema);
  const digest = `sha256:${"a".repeat(64)}`;
  const v11 = {
    schemaVersion: "1.1",
    product: "RepoWrangler",
    version: "v1.0.24",
    releasedAt: "2026-09-05T00:00:00Z",
    channel: "stable",
    releaseNotesUrl: "https://example.test/releases/v1.0.24",
    manifestAttestationUrl: "https://example.test/releases/v1.0.24/provenance.json",
    artifacts: [{
      target: "azure-container-apps",
      url: "https://example.test/releases/v1.0.24/aca.tar.gz",
      sha256: "b".repeat(64),
      size: 1024,
    }],
    containerImages: [{
      target: "azure-container-apps",
      image: "ghcr.io/wranglerlabs/repo-wrangler-server",
      digest,
    }],
    compatibility: {
      minimumSourceVersion: "v1.0.23",
      databaseSchema: { minimum: 9, maximum: 9, target: 9, migrations: [] },
      controllers: [{ type: "azure-devops", minimumVersion: "1.0.0" }],
      targets: ["azure-container-apps"],
    },
  };
  assert.equal(validateManifest(v11), true, JSON.stringify(validateManifest.errors));
  const validatePlan = ajv.compile(planSchema);
  assert.equal(validatePlan(example), true, JSON.stringify(validatePlan.errors));
});

test("deployment plan schema rejects secret-shaped configuration keys", async () => {
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  const validate = ajv.compile(await readJSON("../../release/deployment-plan.schema.json"));
  const example = await readJSON("../../release/deployment-plan.example.json");

  example.configuration.GITHUB_CLIENT_SECRET = "must-not-be-stored";
  assert.equal(validate(example), false);
});
