import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  evaluateRelease,
  type RepoWranglerReleaseManifest,
  type UpgradeControllerCapabilities,
} from '../src';

const availableController: UpgradeControllerCapabilities = {
  controllerType: 'azure-devops',
  controllerVersion: '1.2.0',
  availability: 'available',
  operations: { preflight: true, request: true, status: true, cancel: true, rollback: true },
};

function manifest(
  overrides: Partial<RepoWranglerReleaseManifest> = {},
): RepoWranglerReleaseManifest {
  return {
    schemaVersion: '1.1',
    product: 'RepoWrangler',
    version: 'v1.1.0',
    releasedAt: '2026-09-05T00:00:00.000Z',
    channel: 'stable',
    releaseNotesUrl: 'https://example.test/releases/v1.1.0',
    manifestAttestationUrl: 'https://example.test/releases/v1.1.0/manifest.sigstore.json',
    artifacts: [{
      target: 'azure-container-apps',
      url: 'https://example.test/release.tar.gz',
      sha256: 'a'.repeat(64),
      size: 1024,
      attestationUrl: 'https://example.test/provenance.sigstore.json',
    }],
    containerImages: [{
      target: 'azure-container-apps',
      image: 'ghcr.io/wranglerlabs/repo-wrangler-server',
      digest: `sha256:${'b'.repeat(64)}`,
    }],
    compatibility: {
      minimumSourceVersion: 'v1.0.20',
      databaseSchema: {
        minimum: 8, maximum: 9, target: 10,
        migrations: [{ id: '0010', reversible: false, detail: 'Adds upgrade metadata.' }],
      },
      controllers: [{ type: 'azure-devops', minimumVersion: '1.1.0' }],
      targets: ['azure-container-apps'],
    },
    ...overrides,
  };
}

function evaluate(overrides: Partial<Parameters<typeof evaluateRelease>[0]> = {}) {
  return evaluateRelease({
    installedVersion: 'v1.0.23',
    installedSchemaVersion: 9,
    deploymentTarget: 'azure-container-apps',
    channel: 'stable',
    sourceSupported: true,
    manifest: manifest(),
    controller: availableController,
    ...overrides,
  });
}

describe('release compatibility evaluation', () => {
  it('compares semantic versions including preview precedence', () => {
    expect(compareVersions('v1.0.24', '1.0.23')).toBe(1);
    expect(compareVersions('v1.0.24-rc.1', 'v1.0.24')).toBe(-1);
    expect(compareVersions('not-a-version', 'v1.0.24')).toBeNull();
  });

  it('returns an executable compatible update with digest and migration disclosure', () => {
    expect(evaluate()).toMatchObject({
      status: 'update_available',
      availableVersion: 'v1.1.0',
      imageDigest: `sha256:${'b'.repeat(64)}`,
      provenanceStatus: 'available_unverified',
      irreversibleMigrations: ['Adds upgrade metadata.'],
    });
  });

  it('distinguishes no update even for a legacy manifest without compatibility metadata', () => {
    const legacy = manifest({
      schemaVersion: '1.0', version: 'v1.0.23',
      compatibility: undefined, containerImages: undefined,
    });
    expect(evaluate({ manifest: legacy })).toMatchObject({ status: 'no_update' });
  });

  it('fails closed for incompatible schema, source version, controller, target, or preview channel', () => {
    expect(evaluate({ installedSchemaVersion: 7 }).status).toBe('incompatible_update');
    expect(evaluate({ installedVersion: 'v1.0.10' }).status).toBe('incompatible_update');
    expect(evaluate({ controller: { ...availableController, controllerVersion: '1.0.0' } }).status)
      .toBe('incompatible_update');
    expect(evaluate({ deploymentTarget: 'unknown' }).status).toBe('incompatible_update');
    expect(evaluate({ manifest: manifest({ version: 'v1.1.0-rc.1' }) }).status)
      .toBe('incompatible_update');
  });

  it('does not collapse source and manifest failures into no update', () => {
    expect(evaluate({ sourceSupported: false }).status).toBe('unsupported_installation_source');
    expect(evaluate({ manifest: undefined }).status).toBe('unavailable_manifest');
  });

  it('reports a compatible manual update without implying controller execution', () => {
    const manualController: UpgradeControllerCapabilities = {
      controllerType: 'manual',
      availability: 'manual',
      operations: { preflight: false, request: false, status: false, cancel: false, rollback: false },
      detail: 'No trusted external controller is configured.',
    };
    const composeManifest = manifest({
      artifacts: [{
        target: 'local-compose',
        url: 'https://example.test/compose.tar.gz',
        sha256: 'c'.repeat(64),
        size: 2048,
      }],
      containerImages: undefined,
      compatibility: {
        minimumSourceVersion: 'v1.0.20',
        databaseSchema: { minimum: 9, maximum: 9, target: 9, migrations: [] },
        targets: ['local-compose'],
      },
    });

    const result = evaluate({
      deploymentTarget: 'local-compose',
      manifest: composeManifest,
      controller: manualController,
    });

    expect(result.status).toBe('update_available');
    expect(result.imageDigest).toBeUndefined();
    expect(result.checks.find((check) => check.id === 'controller')).toMatchObject({
      status: 'warning',
      detail: 'This installation requires a manual upgrade.',
    });
  });
});
