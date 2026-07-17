import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const versionPattern = /^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const digestImagePattern = /^[a-z0-9.-]+(?:\/[a-z0-9._-]+)+(?::[a-zA-Z0-9._-]+)?@sha256:[a-f0-9]{64}$/;

function requireOption(options, name) {
  const value = options[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseOptions(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!name?.startsWith("--") || !argv[index + 1]) throw new Error(`invalid option near ${name ?? "end of input"}`);
    result[name.slice(2)] = argv[index + 1];
  }
  return result;
}

async function writeJSON(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validateImage(name, value) {
  if (!digestImagePattern.test(value)) throw new Error(`${name} must be an OCI image pinned by sha256 digest`);
}

export async function assembleReleaseBundles(options, baseDirectory = process.cwd()) {
  const version = requireOption(options, "version");
  const image = requireOption(options, "image");
  const postgresImage = requireOption(options, "postgres-image");
  if (!versionPattern.test(version)) throw new Error("version must be an explicit semantic version beginning with v");
  validateImage("image", image);
  validateImage("postgres-image", postgresImage);

  const output = resolve(baseDirectory, requireOption(options, "output"));
  if (output === resolve(baseDirectory) || output === parse(output).root) throw new Error("output must be a dedicated child directory");
  const input = (name) => resolve(baseDirectory, requireOption(options, name));

  await rm(output, { recursive: true, force: true });
  const composeDirectory = resolve(output, "compose");
  const acaDirectory = resolve(output, "azure-container-apps");
  const cloudflareDirectory = resolve(output, "cloudflare");
  await Promise.all([mkdir(composeDirectory, { recursive: true }), mkdir(acaDirectory, { recursive: true }), mkdir(cloudflareDirectory, { recursive: true })]);

  const composeTemplate = await readFile(input("compose-template"), "utf8");
  const compose = composeTemplate
    .replaceAll("__REPO_WRANGLER_IMAGE__", image)
    .replaceAll("__POSTGRES_IMAGE__", postgresImage);
  if (compose.includes("__")) throw new Error("compose template contains an unresolved placeholder");
  await Promise.all([
    writeFile(resolve(composeDirectory, "compose.yaml"), compose, "utf8"),
    cp(input("compose-env"), resolve(composeDirectory, ".env.example")),
    writeJSON(resolve(composeDirectory, "bundle.json"), {
      schemaVersion: "1.0", product: "RepoWrangler", version, targetFamily: "compose", image, postgresImage,
      publicHttps: "operator-provided", defaultBindAddress: "127.0.0.1",
    }),
    cp(input("aca-template"), resolve(acaDirectory, "main.json")),
    writeJSON(resolve(acaDirectory, "bundle.json"), {
      schemaVersion: "1.0", product: "RepoWrangler", version, targetFamily: "azure-container-apps", image,
      publicHttps: "azure-managed-ingress", registryAuthentication: "none-for-public-ghcr",
    }),
    cp(input("cloudflare-worker"), resolve(cloudflareDirectory, "worker.js")),
    cp(input("web-assets"), resolve(cloudflareDirectory, "assets"), { recursive: true }),
    cp(input("migrations"), resolve(cloudflareDirectory, "migrations"), { recursive: true }),
    writeJSON(resolve(cloudflareDirectory, "bundle.json"), {
      schemaVersion: "1.0", product: "RepoWrangler", version, targetFamily: "cloudflare",
      worker: "worker.js", assetsDirectory: "assets", migrationsDirectory: "migrations",
      compatibilityDate: "2026-07-01", publicHttps: "cloudflare-managed",
      assetsBinding: "ASSETS", d1Binding: "DB",
      assetsNotFoundHandling: "single-page-application",
      assetsRunWorkerFirst: ["/api/*", "/auth/*", "/webhooks/*", "/health/*", "/setup/*"],
      crons: ["*/5 * * * *", "17 3 * * *"],
      vars: {
        ALLOWED_GITHUB_USERS: "", APP_VERSION: version, AUTH_MODE: "github_app", DEMO_MODE: "true",
      },
      observabilityEnabled: true,
    }),
  ]);

  return { output, composeDirectory, acaDirectory, cloudflareDirectory };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await assembleReleaseBundles(parseOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
