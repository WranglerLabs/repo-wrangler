import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const versionPattern = /^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;

export function createReleaseSpec({
  version,
  releasedAt,
  assetBaseURL,
  image,
  imageDigest,
  minimumSourceVersion,
  databaseSchemaMinimum,
  databaseSchemaMaximum,
  databaseSchemaTarget,
}) {
  if (!versionPattern.test(version ?? "")) throw new Error("version must be an explicit semantic version beginning with v");
  if (!releasedAt || Number.isNaN(Date.parse(releasedAt))) throw new Error("released-at must be an ISO-8601 date-time");
  if (!assetBaseURL?.startsWith("https://")) throw new Error("asset-base-url must use HTTPS");
  if (!image || image.includes("@") || image.endsWith(":latest")) throw new Error("image must be an immutable-release repository name without a tag or digest");
  if (!/^sha256:[a-f0-9]{64}$/.test(imageDigest ?? "")) throw new Error("image-digest must be a lowercase SHA-256 OCI digest");
  if (!versionPattern.test(minimumSourceVersion ?? "")) throw new Error("minimum-source-version must be an explicit semantic version beginning with v");
  for (const [name, value] of Object.entries({
    databaseSchemaMinimum,
    databaseSchemaMaximum,
    databaseSchemaTarget,
  })) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  }
  if (databaseSchemaMinimum > databaseSchemaMaximum) throw new Error("database schema minimum cannot exceed maximum");
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
    channel: "stable",
    releaseNotesUrl: assetBaseURL.replace(`/download/${version}`, `/tag/${version}`),
    manifestAttestationUrl: `${assetBaseURL}/${provenance}`,
    artifacts: [
      artifact("azure-container-apps", "aca"),
      artifact("cloudflare", "cloudflare"),
      artifact("local-compose", "compose"),
      artifact("remote-linux-compose", "compose"),
    ],
    containerImages: [
      { target: "azure-container-apps", image, digest: imageDigest },
      { target: "local-compose", image, digest: imageDigest },
      { target: "remote-linux-compose", image, digest: imageDigest },
    ],
    compatibility: {
      minimumSourceVersion,
      databaseSchema: {
        minimum: databaseSchemaMinimum,
        maximum: databaseSchemaMaximum,
        target: databaseSchemaTarget,
        migrations: [],
      },
      controllers: [{ type: "azure-devops", minimumVersion: "1.0.0" }],
      targets: [
        "azure-container-apps",
        "cloudflare",
        "local-compose",
        "remote-linux-compose",
      ],
    },
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
    const spec = createReleaseSpec({
      version: options.version,
      releasedAt: options["released-at"],
      assetBaseURL: options["asset-base-url"],
      image: options.image,
      imageDigest: options["image-digest"],
      minimumSourceVersion: options["minimum-source-version"],
      databaseSchemaMinimum: Number(options["database-schema-minimum"]),
      databaseSchemaMaximum: Number(options["database-schema-maximum"]),
      databaseSchemaTarget: Number(options["database-schema-target"]),
    });
    await writeFile(resolve(options.output), `${JSON.stringify(spec, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
