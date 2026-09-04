import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowURL = new URL(
  "../../.github/workflows/publish-release-artifacts.yml",
  import.meta.url,
);
const ciWorkflowURL = new URL("../../.github/workflows/ci.yml", import.meta.url);

const pinnedOsvWorkflow =
  "google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@8deb546fdb875b9996d27d4950be7312dac076a1";

test("CI and release publication require the pinned full dependency audit", async () => {
  for (const [name, url, gatedJob] of [
    ["CI", ciWorkflowURL, "verify"],
    ["release", workflowURL, "publish"],
  ]) {
    const workflow = await readFile(url, "utf8");
    assert.match(workflow, new RegExp(`uses: ${pinnedOsvWorkflow}`));
    assert.match(workflow, /--lockfile=pnpm-lock\.yaml/);
    assert.match(workflow, /fail-on-vuln:\s*true/);
    assert.match(
      workflow,
      new RegExp(`\\n  ${gatedJob}:\\n    needs: dependency-audit`),
      `${name} can proceed without the dependency audit`,
    );
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
