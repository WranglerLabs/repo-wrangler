import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const versionPattern = /^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;

export function createReleaseSpec({ version, releasedAt, assetBaseURL }) {
  if (!versionPattern.test(version ?? "")) throw new Error("version must be an explicit semantic version beginning with v");
  if (!releasedAt || Number.isNaN(Date.parse(releasedAt))) throw new Error("released-at must be an ISO-8601 date-time");
  if (!assetBaseURL?.startsWith("https://")) throw new Error("asset-base-url must use HTTPS");
  const file = (family) => `repo-wrangler-${family}-${version}.tar.gz`;
  const sbom = `repo-wrangler-${version}.spdx.json`;
  const provenance = `repo-wrangler-${version}.provenance.sigstore.json`;
  const artifact = (target, family) => ({
    target,
    path: file(family),
    url: `${assetBaseURL}/${file(family)}`,
    mediaType: "application/gzip",
    sbomUrl: `${assetBaseURL}/${sbom}`,
    attestationUrl: `${assetBaseURL}/${provenance}`,
  });
  return {
    version,
    releasedAt: new Date(releasedAt).toISOString(),
    artifacts: [
      artifact("azure-container-apps", "aca"),
      artifact("cloudflare", "cloudflare"),
      artifact("local-compose", "compose"),
      artifact("remote-linux-compose", "compose"),
    ],
  };
}

function parseOptions(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || !argv[index + 1]) throw new Error(`invalid option near ${argv[index] ?? "end of input"}`);
    result[argv[index].slice(2)] = argv[index + 1];
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (!options.output) throw new Error("output is required");
    const spec = createReleaseSpec({ version: options.version, releasedAt: options["released-at"], assetBaseURL: options["asset-base-url"] });
    await writeFile(resolve(options.output), `${JSON.stringify(spec, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
