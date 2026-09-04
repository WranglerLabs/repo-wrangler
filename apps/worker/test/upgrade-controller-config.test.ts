import { describe, expect, it } from 'vitest';
import type { Env } from '../src/bindings';
import {
  configuredUpgradeController,
  manualUpgradeInstructions,
} from '../src/lib/upgrade-controller';

describe('deployment-target upgrade capability', () => {
  it.each([
    ['cloudflare', 'Cloudflare Worker and D1'],
    ['local-compose', 'local Docker Compose'],
    ['remote-linux-compose', 'remote Linux Docker Compose'],
    ['kubernetes', 'Kubernetes'],
  ])('provides an honest manual procedure for %s', async (target, expected) => {
    const configured = configuredUpgradeController({
      UPGRADE_RELEASE_TARGET: target,
    } as Env);
    const capability = await configured.controller.capabilities();

    expect(capability).toMatchObject({
      controllerType: 'manual',
      availability: 'manual',
      operations: {
        preflight: false,
        request: false,
        status: false,
        cancel: false,
        rollback: false,
      },
    });
    expect(capability.manualInstructions?.join(' ')).toContain(expected);
  });

  it('does not claim support for an unknown configured controller', async () => {
    const configured = configuredUpgradeController({
      UPGRADE_RELEASE_TARGET: 'kubernetes',
      UPGRADE_CONTROLLER_TYPE: 'kubernetes-operator',
    } as Env);
    const capability = await configured.controller.capabilities();

    expect(capability.availability).toBe('manual');
    expect(capability.operations.request).toBe(false);
    expect(capability.detail).toContain('incomplete or unsupported');
  });

  it('requires external safety evidence in every manual procedure', () => {
    expect(manualUpgradeInstructions('custom-platform').join(' ')).toContain(
      'backup, restored-database migration validation, deployment, health verification, and rollback',
    );
  });
});
