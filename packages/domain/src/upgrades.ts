/**
 * Platform-neutral lifecycle contract for upgrading RepoWrangler.
 *
 * The application requests and observes work through this interface. Concrete
 * deployment controllers own host/cloud credentials, backups, traffic, and
 * rollback; those privileges never enter the RepoWrangler process.
 */

export const UPGRADE_JOB_STATES = [
  'requested',
  'accepted',
  'preflight',
  'backup',
  'validating_artifact',
  'deploying',
  'verifying',
  'completed',
  'cancel_requested',
  'canceled',
  'failed',
  'rollback_requested',
  'rolling_back',
  'rolled_back',
] as const;

export type UpgradeJobState = (typeof UPGRADE_JOB_STATES)[number];

export const TERMINAL_UPGRADE_JOB_STATES: readonly UpgradeJobState[] = [
  'completed', 'canceled', 'failed', 'rolled_back',
];

const ALLOWED_TRANSITIONS: Readonly<Record<UpgradeJobState, readonly UpgradeJobState[]>> = {
  requested: ['accepted', 'cancel_requested', 'failed'],
  accepted: ['preflight', 'cancel_requested', 'failed'],
  preflight: ['backup', 'cancel_requested', 'failed'],
  backup: ['validating_artifact', 'failed'],
  validating_artifact: ['deploying', 'failed'],
  deploying: ['verifying', 'failed', 'rollback_requested'],
  verifying: ['completed', 'failed', 'rollback_requested'],
  completed: ['rollback_requested'],
  cancel_requested: ['canceled', 'accepted', 'failed'],
  canceled: [],
  failed: ['rollback_requested'],
  rollback_requested: ['rolling_back', 'failed'],
  rolling_back: ['rolled_back', 'failed'],
  rolled_back: [],
};

export function canTransitionUpgradeJob(
  from: UpgradeJobState,
  to: UpgradeJobState,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export type UpgradeControllerAvailability = 'available' | 'manual' | 'unavailable';

export interface UpgradeControllerCapabilities {
  controllerType: string;
  controllerVersion?: string;
  availability: UpgradeControllerAvailability;
  operations: {
    preflight: boolean;
    request: boolean;
    status: boolean;
    cancel: boolean;
    rollback: boolean;
  };
  /** Safe operator guidance; never contains credentials. */
  detail?: string;
  manualInstructions?: string[];
}

export interface UpgradeTarget {
  deploymentTarget: string;
  sourceVersion: string;
  sourceDigest?: string;
  targetVersion: string;
  /** Immutable digest is mandatory for an executable request. */
  targetDigest: string;
  rollbackVersion?: string;
  rollbackDigest?: string;
}

export interface UpgradeActor {
  id: string;
  displayName?: string;
  role: 'owner' | 'admin';
}

export interface UpgradePreflightResult {
  ready: boolean;
  checks: Array<{
    id: string;
    status: 'passed' | 'failed' | 'warning' | 'unavailable';
    detail?: string;
  }>;
  irreversibleChanges: string[];
  checkedAt: string;
}

export interface UpgradeControllerReceipt {
  controllerCorrelationId: string;
  acceptedAt: string;
  evidence?: Record<string, unknown>;
}

export interface UpgradeControllerStatus {
  state: UpgradeJobState;
  observedAt: string;
  safeErrorCode?: string;
  safeErrorDetail?: string;
  evidence?: Record<string, unknown>;
}

export interface UpgradeControllerEvidence extends Record<string, unknown> {
  backup?: { verified: boolean; id: string; completedAt: string };
  migrationValidation?: {
    verified: boolean;
    restoredDatabaseId: string;
    sourceSchema: number;
    targetSchema: number;
    completedAt: string;
  };
  artifact?: {
    digest: string;
    checksumVerified: boolean;
    provenanceVerified: boolean;
    signatureVerified: boolean;
    imageAvailable: boolean;
  };
  deployment?: {
    revision: string;
    imageDigest: string;
    trafficPercent: number;
  };
  health?: { application: boolean; schema: boolean; checkedAt: string };
  rollback?: {
    available: boolean;
    revision?: string;
    imageDigest?: string;
    restored?: boolean;
    healthVerified?: boolean;
  };
}

/** Evidence required before crossing each production safety boundary. */
export function missingUpgradeSafetyEvidence(
  nextState: UpgradeJobState,
  evidence: UpgradeControllerEvidence,
  targetDigest: string,
): string[] {
  const missing: string[] = [];
  if (['validating_artifact', 'deploying', 'verifying', 'completed'].includes(nextState)) {
    if (!evidence.backup?.verified || !evidence.backup.id) missing.push('verified_backup');
    if (!evidence.migrationValidation?.verified
      || !evidence.migrationValidation.restoredDatabaseId) missing.push('restored_migration_validation');
  }
  if (['deploying', 'verifying', 'completed'].includes(nextState)) {
    const artifact = evidence.artifact;
    if (!artifact?.checksumVerified || artifact.digest !== targetDigest) missing.push('artifact_checksum');
    if (!artifact?.provenanceVerified) missing.push('artifact_provenance');
    if (!artifact?.signatureVerified) missing.push('artifact_signature');
    if (!artifact?.imageAvailable) missing.push('container_availability');
    if (!evidence.rollback?.available || !evidence.rollback.revision
      || !evidence.rollback.imageDigest) missing.push('rollback_target');
  }
  if (nextState === 'completed') {
    if (!evidence.deployment?.revision || evidence.deployment.imageDigest !== targetDigest
      || evidence.deployment.trafficPercent !== 100) missing.push('healthy_traffic_transition');
    if (!evidence.health?.application) missing.push('application_health');
    if (!evidence.health?.schema) missing.push('schema_health');
  }
  if (nextState === 'rolled_back') {
    if (!evidence.rollback?.restored) missing.push('rollback_restored');
    if (!evidence.rollback?.healthVerified) missing.push('rollback_health');
  }
  return missing;
}

export interface UpgradeControllerRequest extends UpgradeTarget {
  correlationId: string;
  idempotencyKey: string;
  actor: UpgradeActor;
}

export interface UpgradeJobSnapshot extends UpgradeTarget {
  id: string;
  deploymentTarget: string;
  controllerType: string;
  controllerVersion?: string;
  state: UpgradeJobState;
  actorId: string;
  actorDisplayName?: string;
  correlationId: string;
  controllerCorrelationId?: string;
  requestedAt: string;
  acceptedAt?: string;
  startedAt?: string;
  completedAt?: string;
  lastObservedAt?: string;
  safeErrorCode?: string;
  safeErrorDetail?: string;
  preflightResult?: UpgradePreflightResult;
  controllerEvidence: UpgradeControllerEvidence;
}

export interface UpgradeDeploymentController {
  capabilities(): Promise<UpgradeControllerCapabilities>;
  preflight(request: UpgradeControllerRequest): Promise<UpgradePreflightResult>;
  request(request: UpgradeControllerRequest): Promise<UpgradeControllerReceipt>;
  status(controllerCorrelationId: string): Promise<UpgradeControllerStatus>;
  cancel(controllerCorrelationId: string, actor: UpgradeActor): Promise<UpgradeControllerReceipt>;
  rollback(controllerCorrelationId: string, actor: UpgradeActor): Promise<UpgradeControllerReceipt>;
}
