import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const versionPattern = /^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const targets = new Set([
  "azure-container-apps",
  "cloudflare",
  "local-compose",
  "remote-linux-compose",
]);

export async function generateManifest(spec, baseDirectory = process.cwd()) {
  if (!versionPattern.test(spec.version ?? "")) {
    throw new Error("version must be an explicit semantic version beginning with v");
  }
  if (!spec.releasedAt || Number.isNaN(Date.parse(spec.releasedAt))) {
    throw new Error("releasedAt must be an ISO-8601 date-time");
  }
  if (!Array.isArray(spec.artifacts) || spec.artifacts.length === 0) {
    throw new Error("at least one artifact is required");
  }
  if (!Array.isArray(spec.containerImages) || spec.containerImages.length === 0) {
    throw new Error("at least one immutable container image is required");
  }
  for (const image of spec.containerImages) {
    if (!targets.has(image.target)) throw new Error(`unsupported image target: ${image.target}`);
    if (!image.image || image.image.includes("@") || image.image.endsWith(":latest")) {
      throw new Error(`container image repository is invalid for ${image.target}`);
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(image.digest ?? "")) {
      throw new Error(`container image digest is invalid for ${image.target}`);
    }
  }
  const compatibility = spec.compatibility;
  if (!compatibility || !versionPattern.test(compatibility.minimumSourceVersion ?? "")) {
    throw new Error("minimum source compatibility is required");
  }
  const database = compatibility.databaseSchema;
  if (!database
    || !Number.isInteger(database.minimum)
    || !Number.isInteger(database.maximum)
    || !Number.isInteger(database.target)
    || !Array.isArray(database.migrations)) {
    throw new Error("database schema compatibility is required");
  }

  const artifacts = [];
  for (const candidate of spec.artifacts) {
    if (!targets.has(candidate.target)) throw new Error(`unsupported target: ${candidate.target}`);
    if (!candidate.path) throw new Error(`artifact path is required for ${candidate.target}`);
    if (!candidate.url?.startsWith("https://")) throw new Error(`artifact URL must use HTTPS for ${candidate.target}`);
    for (const optionalURL of ["attestationUrl", "sbomUrl"]) {
      if (candidate[optionalURL] && !candidate[optionalURL].startsWith("https://")) {
        throw new Error(`${optionalURL} must use HTTPS for ${candidate.target}`);
      }
    }

    const filePath = resolve(baseDirectory, candidate.path);
    const [contents, details] = await Promise.all([readFile(filePath), stat(filePath)]);
    if (!details.isFile() || details.size < 1) throw new Error(`artifact must be a non-empty file: ${candidate.path}`);

    const artifact = {
      target: candidate.target,
      url: candidate.url,
      sha256: createHash("sha256").update(contents).digest("hex"),
      size: details.size,
    };
    for (const optional of ["mediaType", "attestationUrl", "sbomUrl"]) {
      if (candidate[optional]) artifact[optional] = candidate[optional];
    }
    artifacts.push(artifact);
  }

  return {
    schemaVersion: "1.1",
    product: "RepoWrangler",
    version: spec.version,
    releasedAt: new Date(spec.releasedAt).toISOString(),
    channel: spec.channel ?? "stable",
    ...(spec.releaseNotesUrl ? { releaseNotesUrl: spec.releaseNotesUrl } : {}),
    ...(spec.manifestAttestationUrl ? { manifestAttestationUrl: spec.manifestAttestationUrl } : {}),
    artifacts,
    containerImages: spec.containerImages,
    compatibility,
  };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const specPath = option("--spec");
  const outputPath = option("--output");
  if (!specPath || !outputPath) {
    console.error("Usage: node generate-release-manifest.mjs --spec <file> --output <file>");
    process.exitCode = 2;
  } else {
    const absoluteSpec = resolve(specPath);
    const spec = JSON.parse(await readFile(absoluteSpec, "utf8"));
    const manifest = await generateManifest(spec, dirname(absoluteSpec));
    await writeFile(resolve(outputPath), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
}
