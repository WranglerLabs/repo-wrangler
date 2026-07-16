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
