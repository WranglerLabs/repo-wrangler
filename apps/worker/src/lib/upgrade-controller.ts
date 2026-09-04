import type {
  UpgradeActor,
  UpgradeControllerCapabilities,
  UpgradeControllerReceipt,
  UpgradeControllerRequest,
  UpgradeControllerStatus,
  UpgradeDeploymentController,
  UpgradePreflightResult,
} from '@repo-wrangler/domain';
import {
  AzureDevOpsManagedIdentityTokenProvider,
  AzureDevOpsUpgradeController,
} from '@repo-wrangler/upgrade-controller-azure-devops';
import type { Env } from '../bindings';

export interface ConfiguredUpgradeController {
  controller: UpgradeDeploymentController;
  deploymentTarget: string;
  releaseTarget: string;
  channel: 'stable' | 'preview';
  schemaVersion: number;
}

class ManualUpgradeController implements UpgradeDeploymentController {
  constructor(private readonly target: string, private readonly detail: string) {}

  capabilities(): Promise<UpgradeControllerCapabilities> {
    return Promise.resolve({
      controllerType: 'manual', availability: 'manual',
      operations: { preflight: false, request: false, status: false, cancel: false, rollback: false },
      detail: this.detail,
      manualInstructions: manualUpgradeInstructions(this.target),
    });
  }

  private unsupported(): Error {
    return new Error('This deployment target requires a manual upgrade.');
  }

  preflight(_request: UpgradeControllerRequest): Promise<UpgradePreflightResult> {
    return Promise.reject(this.unsupported());
  }
  request(_request: UpgradeControllerRequest): Promise<UpgradeControllerReceipt> {
    return Promise.reject(this.unsupported());
  }
  status(_controllerCorrelationId: string): Promise<UpgradeControllerStatus> {
    return Promise.reject(this.unsupported());
  }
  cancel(_controllerCorrelationId: string, _actor: UpgradeActor): Promise<UpgradeControllerReceipt> {
    return Promise.reject(this.unsupported());
  }
  rollback(_controllerCorrelationId: string, _actor: UpgradeActor): Promise<UpgradeControllerReceipt> {
    return Promise.reject(this.unsupported());
  }
}

export function manualUpgradeInstructions(target: string): string[] {
  const procedure = (() => {
    switch (target) {
      case 'cloudflare':
        return 'Use the supported Cloudflare Worker and D1 deployment procedure.';
      case 'local-compose':
        return 'Use the supported local Docker Compose deployment procedure.';
      case 'remote-linux-compose':
        return 'Use the supported remote Linux Docker Compose deployment procedure.';
      case 'kubernetes':
        return 'Use the supported Kubernetes deployment procedure for your cluster.';
      default:
        return `Use the supported ${target} deployment procedure.`;
    }
  })();
  return [
    procedure,
    'Select the exact immutable version and artifact checksum shown by RepoWrangler.',
    'Verify the published provenance and container digest when the release supplies them.',
    'Complete backup, restored-database migration validation, deployment, health verification, and rollback recording externally.',
  ];
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function configuredUpgradeController(env: Env): ConfiguredUpgradeController {
  const deploymentTarget = env.UPGRADE_DEPLOYMENT_TARGET?.trim() || 'installation';
  const releaseTarget = env.UPGRADE_RELEASE_TARGET?.trim() || 'local-compose';
  const channel = env.UPGRADE_RELEASE_CHANNEL === 'preview' ? 'preview' : 'stable';
  const schemaVersion = positiveInteger(env.UPGRADE_SCHEMA_VERSION, 9);
  if (env.UPGRADE_CONTROLLER_TYPE === 'azure-devops') {
    const pipelineId = positiveInteger(env.AZURE_DEVOPS_PIPELINE_ID, 0);
    if (env.AZURE_DEVOPS_ORGANIZATION && env.AZURE_DEVOPS_PROJECT && pipelineId > 0) {
      return {
        deploymentTarget, releaseTarget, channel, schemaVersion,
        controller: new AzureDevOpsUpgradeController({
          organization: env.AZURE_DEVOPS_ORGANIZATION,
          project: env.AZURE_DEVOPS_PROJECT,
          pipelineId,
          pipelineRef: env.AZURE_DEVOPS_PIPELINE_REF,
          expectedPipelineName: env.AZURE_DEVOPS_PIPELINE_NAME,
          controllerVersion: env.UPGRADE_CONTROLLER_VERSION?.trim() || '1.0.0',
          tokenProvider: new AzureDevOpsManagedIdentityTokenProvider({
            identityEndpoint: env.IDENTITY_ENDPOINT,
            identityHeader: env.IDENTITY_HEADER,
            clientId: env.AZURE_CLIENT_ID,
          }),
        }),
      };
    }
  }
  return {
    deploymentTarget, releaseTarget, channel, schemaVersion,
    controller: new ManualUpgradeController(
      releaseTarget,
      env.UPGRADE_CONTROLLER_TYPE
        ? 'The configured upgrade controller is incomplete or unsupported.'
        : 'No trusted external upgrade controller is configured.',
    ),
  };
}
