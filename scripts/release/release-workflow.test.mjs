import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowURL = new URL(
  "../../.github/workflows/publish-release-artifacts.yml",
  import.meta.url,
);

test("anonymous image verification is a blocking release gate", async () => {
  const workflow = await readFile(workflowURL, "utf8");
  const start = workflow.indexOf("- name: Verify anonymous product image pull");
  assert.notEqual(start, -1, "release workflow omitted anonymous image verification");

  const nextStep = workflow.indexOf("\n      - ", start + 1);
  const verificationStep = workflow.slice(
    start,
    nextStep === -1 ? workflow.length : nextStep,
  );

  assert.match(
    verificationStep,
    /node scripts\/release\/verify-public-image\.mjs/,
    "release workflow does not execute the anonymous image verifier",
  );
  assert.doesNotMatch(
    verificationStep,
    /continue-on-error\s*:\s*true/,
    "a private product image must stop release publication",
  );
});
