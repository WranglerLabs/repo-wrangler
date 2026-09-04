import type { AdministrationUpdatesDto } from '@repo-wrangler/contracts';

export type UpgradeJob = AdministrationUpdatesDto['jobs'][number];

const ACTIVE_STATES = new Set([
  'requested', 'accepted', 'preflight', 'backup', 'validating_artifact',
  'deploying', 'verifying', 'cancel_requested', 'rollback_requested', 'rolling_back',
]);

export function upgradeStateLabel(state: string): string {
  return state.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function upgradeStateBadge(state: string): string {
  if (state === 'completed' || state === 'rolled_back') return 'healthy';
  if (state === 'failed') return 'critical';
  if (state === 'canceled' || state === 'cancel_requested') return 'medium';
  if (ACTIVE_STATES.has(state)) return 'info';
  return 'unknown';
}

export function isActiveUpgradeJob(job: UpgradeJob): boolean {
  return ACTIVE_STATES.has(job.state);
}

export function availableJobActions(job: UpgradeJob): Array<'cancel' | 'rollback'> {
  const actions: Array<'cancel' | 'rollback'> = [];
  if (job.controllerCorrelationId && ['accepted', 'preflight'].includes(job.state)) {
    actions.push('cancel');
  }
  if (
    job.controllerCorrelationId
    && ['deploying', 'verifying', 'completed', 'failed'].includes(job.state)
    && job.controllerEvidence.rollback?.available === true
  ) {
    actions.push('rollback');
  }
  return actions;
}

export interface UpgradeEvidenceFact {
  id: string;
  label: string;
  state: 'verified' | 'pending' | 'failed' | 'unavailable';
  detail: string;
}

export function upgradeEvidenceFacts(job: UpgradeJob): UpgradeEvidenceFact[] {
  const evidence = job.controllerEvidence;
  const failure = evidence.failure;
  return [
    {
      id: 'backup', label: 'Production backup',
      state: evidence.backup?.verified ? 'verified' : isActiveUpgradeJob(job) ? 'pending' : 'unavailable',
      detail: evidence.backup?.id ?? 'No verified backup evidence recorded',
    },
    {
      id: 'migration', label: 'Restored-database migration',
      state: evidence.migrationValidation?.verified ? 'verified' : isActiveUpgradeJob(job) ? 'pending' : 'unavailable',
      detail: evidence.migrationValidation?.verified
        ? `Schema ${evidence.migrationValidation.sourceSchema} → ${evidence.migrationValidation.targetSchema}`
        : 'No successful restored-database validation recorded',
    },
    {
      id: 'artifact', label: 'Artifact and provenance',
      state: evidence.artifact?.checksumVerified
        && evidence.artifact.provenanceVerified
        && evidence.artifact.signatureVerified
        && evidence.artifact.imageAvailable ? 'verified'
        : isActiveUpgradeJob(job) ? 'pending' : 'unavailable',
      detail: evidence.artifact?.digest ?? 'No verified immutable artifact recorded',
    },
    {
      id: 'health', label: 'Production verification',
      state: evidence.health?.application && evidence.health.schema ? 'verified'
        : job.state === 'failed' ? 'failed' : isActiveUpgradeJob(job) ? 'pending' : 'unavailable',
      detail: evidence.health?.checkedAt ?? 'No completed application and schema health check recorded',
    },
    {
      id: 'rollback', label: 'Rollback target',
      state: evidence.rollback?.available ? 'verified' : isActiveUpgradeJob(job) ? 'pending' : 'unavailable',
      detail: evidence.rollback?.revision ?? evidence.rollback?.imageDigest ?? 'No rollback target recorded',
    },
    ...(failure ? [{
      id: 'failure', label: 'Production preserved after failure',
      state: failure.productionPreserved ? 'verified' as const : 'failed' as const,
      detail: failure.productionPreserved
        ? `Verified ${failure.verifiedAt}`
        : 'Production preservation has not been verified; the deployment lock remains held.',
    }] : []),
  ];
}

export function upgradeAvailabilityMessage(data: AdministrationUpdatesDto): string {
  if (data.controller.availability === 'manual') {
    return data.controller.detail ?? 'This installation requires a manual upgrade.';
  }
  if (data.controller.availability === 'unavailable') {
    return data.controller.detail ?? 'No upgrade controller is configured for this installation.';
  }
  switch (data.evaluation.status) {
    case 'update_available': return 'This release passed application, database, controller, and target compatibility checks.';
    case 'no_update': return 'This installation is running the newest compatible release on its selected channel.';
    case 'incompatible_update': return 'A newer release exists, but one or more required compatibility checks failed.';
    case 'unavailable_manifest': return 'Release metadata is temporarily unavailable. No upgrade can be started.';
    case 'unsupported_installation_source': return 'This installation source does not support automatic release discovery.';
  }
}
