import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowURL = new URL(
  "../../.github/workflows/publish-release-artifacts.yml",
  import.meta.url,
);
const ciWorkflowURL = new URL("../../.github/workflows/ci.yml", import.meta.url);

const pinnedOsvScanner =
  "google/osv-scanner-action/osv-scanner-action@06b2ab4348248b456ee06c9e953637f55e03504f";
const pinnedOsvReporter =
  "google/osv-scanner-action/osv-reporter-action@06b2ab4348248b456ee06c9e953637f55e03504f";

test("CI and release publication require the pinned full dependency audit", async () => {
  for (const [name, url] of [
    ["CI", ciWorkflowURL],
    ["release", workflowURL],
  ]) {
    const workflow = await readFile(url, "utf8");
    assert.match(workflow, new RegExp(`uses: ${pinnedOsvScanner}`));
    assert.match(workflow, new RegExp(`uses: ${pinnedOsvReporter}`));
    assert.match(workflow, /--lockfile=pnpm-lock\.yaml/);
    assert.match(workflow, /--fail-on-vuln=true/);
    assert.doesNotMatch(
      workflow,
      /pnpm audit/,
      `${name} still depends on npm's bulk-advisory endpoint`,
    );
  }
});

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
