import type { UpgradeControllerCapabilities } from './upgrades';

export type ReleaseTarget =
  | 'azure-container-apps'
  | 'cloudflare'
  | 'local-compose'
  | 'remote-linux-compose'
  | string;

export interface ReleaseArtifact {
  target: ReleaseTarget;
  url: string;
  sha256: string;
  size: number;
  mediaType?: string;
  attestationUrl?: string;
  sbomUrl?: string;
}

export interface ReleaseContainerImage {
  target: ReleaseTarget;
  image: string;
  digest: string;
}

export interface ReleaseCompatibility {
  minimumSourceVersion?: string;
  databaseSchema?: {
    minimum: number;
    maximum: number;
    target: number;
    migrations: Array<{ id: string; reversible: boolean; detail?: string }>;
  };
  controllers?: Array<{ type: string; minimumVersion: string }>;
  targets?: string[];
}

export interface RepoWranglerReleaseManifest {
  schemaVersion: '1.0' | '1.1';
  product: 'RepoWrangler';
  version: string;
  releasedAt: string;
  channel?: 'stable' | 'preview';
  releaseNotesUrl?: string;
  manifestAttestationUrl?: string;
  artifacts: ReleaseArtifact[];
  containerImages?: ReleaseContainerImage[];
  compatibility?: ReleaseCompatibility;
}

export type ReleaseCheckStatus =
  | 'no_update'
  | 'update_available'
  | 'incompatible_update'
  | 'unavailable_manifest'
  | 'unsupported_installation_source';

export interface ReleaseCompatibilityCheck {
  id: 'application' | 'database' | 'controller' | 'target' | 'provenance';
  status: 'passed' | 'failed' | 'warning' | 'unavailable';
  detail: string;
}

export interface ReleaseEvaluation {
  status: ReleaseCheckStatus;
  installedVersion: string;
  availableVersion?: string;
  releasedAt?: string;
  releaseNotesUrl?: string;
  image?: string;
  imageDigest?: string;
  artifact?: ReleaseArtifact;
  provenanceStatus: 'verified' | 'available_unverified' | 'missing' | 'unavailable';
  checks: ReleaseCompatibilityCheck[];
  irreversibleMigrations: string[];
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([A-Za-z0-9.-]+))?(?:\+[A-Za-z0-9.-]+)?$/.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]),
    prerelease: match[4],
  };
}

/** Positive when left is newer. Build metadata intentionally has no precedence. */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function versionAtLeast(actual: string | undefined, minimum: string): boolean {
  if (!actual) return false;
  const result = compareVersions(actual, minimum);
  return result !== null && result >= 0;
}

export interface EvaluateReleaseInput {
  installedVersion: string;
  installedSchemaVersion: number;
  deploymentTarget: string;
  channel: 'stable' | 'preview';
  sourceSupported: boolean;
  manifest?: RepoWranglerReleaseManifest;
  controller: UpgradeControllerCapabilities;
}

/** Evaluate without downloading or installing an artifact. */
export function evaluateRelease(input: EvaluateReleaseInput): ReleaseEvaluation {
  if (!input.sourceSupported) {
    return {
      status: 'unsupported_installation_source',
      installedVersion: input.installedVersion,
      provenanceStatus: 'unavailable',
      checks: [], irreversibleMigrations: [],
    };
  }
  const manifest = input.manifest;
  if (!manifest) {
    return {
      status: 'unavailable_manifest', installedVersion: input.installedVersion,
      provenanceStatus: 'unavailable', checks: [], irreversibleMigrations: [],
    };
  }

  const checks: ReleaseCompatibilityCheck[] = [];
  const comparison = compareVersions(manifest.version, input.installedVersion);
  const stableRejectsPreview = input.channel === 'stable' && manifest.version.includes('-');
  const minimumSource = manifest.compatibility?.minimumSourceVersion;
  const sourceCompatible = !minimumSource || versionAtLeast(input.installedVersion, minimumSource);
  checks.push({
    id: 'application',
    status: comparison === null || stableRejectsPreview || !sourceCompatible ? 'failed' : 'passed',
    detail: comparison === null
      ? 'The installed or available version is not valid semantic version data.'
      : stableRejectsPreview
        ? 'A preview release cannot be selected on the stable channel.'
        : !sourceCompatible
          ? `The release requires RepoWrangler ${minimumSource} or newer as its upgrade source.`
        : comparison > 0 ? 'A newer application version is available.' : 'The installed version is current.',
  });

  const artifact = manifest.artifacts.find((item) => item.target === input.deploymentTarget);
  const image = manifest.containerImages?.find((item) => item.target === input.deploymentTarget);
  const targetAllowed = manifest.compatibility?.targets?.includes(input.deploymentTarget) ?? Boolean(artifact);
  checks.push({
    id: 'target', status: artifact && targetAllowed ? 'passed' : 'failed',
    detail: artifact && targetAllowed
      ? `The release includes a ${input.deploymentTarget} artifact.`
      : `The release does not support deployment target ${input.deploymentTarget}.`,
  });

  const database = manifest.compatibility?.databaseSchema;
  const databaseCompatible = database
    ? input.installedSchemaVersion >= database.minimum
      && input.installedSchemaVersion <= database.maximum
    : comparison !== null && comparison <= 0;
  checks.push({
    id: 'database',
    status: database ? (databaseCompatible ? 'passed' : 'failed') : 'unavailable',
    detail: database
      ? databaseCompatible
        ? `Schema ${input.installedSchemaVersion} can migrate to schema ${database.target}.`
        : `Schema ${input.installedSchemaVersion} is outside supported range ${database.minimum}-${database.maximum}.`
      : 'The manifest does not declare database-schema compatibility.',
  });

  const requirement = manifest.compatibility?.controllers
    ?.find((item) => item.type === input.controller.controllerType);
  const controllerCompatible = input.controller.availability === 'available'
    && input.controller.operations.preflight && input.controller.operations.request
    && (!requirement || versionAtLeast(input.controller.controllerVersion, requirement.minimumVersion));
  checks.push({
    id: 'controller',
    status: input.controller.availability === 'manual'
      ? 'warning' : controllerCompatible ? 'passed' : 'failed',
    detail: input.controller.availability === 'manual'
      ? 'This installation requires a manual upgrade.'
      : controllerCompatible
        ? 'The configured deployment controller supports this release.'
        : 'The configured deployment controller is missing or incompatible.',
  });

  const provenanceStatus = manifest.manifestAttestationUrl
    ? 'available_unverified' as const
    : artifact?.attestationUrl ? 'available_unverified' as const : 'missing' as const;
  checks.push({
    id: 'provenance',
    status: provenanceStatus === 'missing' ? 'failed' : 'warning',
    detail: provenanceStatus === 'missing'
      ? 'The release does not publish provenance evidence.'
      : 'Signed provenance is published and must be verified by the deployment controller.',
  });

  const noUpdate = comparison !== null && comparison <= 0;
  const requiredChecksPass = checks
    .filter((check) => check.id !== 'provenance')
    .every((check) => check.status === 'passed');
  const executableImagePresent = input.controller.availability !== 'available' || Boolean(image?.digest);
  const status: ReleaseCheckStatus = noUpdate
    ? 'no_update'
    : requiredChecksPass && executableImagePresent
      ? 'update_available' : 'incompatible_update';

  return {
    status,
    installedVersion: input.installedVersion,
    availableVersion: manifest.version,
    releasedAt: manifest.releasedAt,
    releaseNotesUrl: manifest.releaseNotesUrl,
    image: image?.image,
    imageDigest: image?.digest,
    artifact,
    provenanceStatus,
    checks,
    irreversibleMigrations: database?.migrations
      .filter((migration) => !migration.reversible)
      .map((migration) => migration.detail ?? migration.id) ?? [],
  };
}
