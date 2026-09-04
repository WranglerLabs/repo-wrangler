import {
  canTransitionUpgradeJob,
  missingUpgradeSafetyEvidence,
  type UpgradeControllerEvidence,
  type UpgradeJobSnapshot,
  type UpgradeJobState,
  type UpgradePreflightResult,
} from '@repo-wrangler/domain';

export class UpgradeInProgressError extends Error {
  constructor(readonly activeJobId: string) {
    super(`Upgrade job ${activeJobId} already holds the deployment lock.`);
    this.name = 'UpgradeInProgressError';
  }
}

export class InvalidUpgradeTransitionError extends Error {
  constructor(readonly from: UpgradeJobState, readonly to: UpgradeJobState) {
    super(`Upgrade job cannot transition from ${from} to ${to}.`);
    this.name = 'InvalidUpgradeTransitionError';
  }
}

export class MissingUpgradeSafetyEvidenceError extends Error {
  constructor(readonly missing: string[]) {
    super(`Upgrade transition is missing required evidence: ${missing.join(', ')}.`);
    this.name = 'MissingUpgradeSafetyEvidenceError';
  }
}

interface UpgradeJobRow {
  id: string;
  idempotency_key: string;
  deployment_target: string;
  controller_type: string;
  controller_version: string | null;
  source_version: string;
  source_digest: string | null;
  target_version: string;
  target_digest: string;
  rollback_version: string | null;
  rollback_digest: string | null;
  state: UpgradeJobState;
  actor_id: string;
  actor_display_name: string | null;
  correlation_id: string;
  controller_correlation_id: string | null;
  preflight_result: string | null;
  controller_evidence: string;
  safe_error_code: string | null;
  safe_error_detail: string | null;
  requested_at: string;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_observed_at: string | null;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function toSnapshot(row: UpgradeJobRow): UpgradeJobSnapshot {
  const preflight = row.preflight_result
    ? parseJsonObject(row.preflight_result) as unknown as UpgradePreflightResult
    : undefined;
  return {
    id: row.id,
    deploymentTarget: row.deployment_target,
    controllerType: row.controller_type,
    controllerVersion: row.controller_version ?? undefined,
    sourceVersion: row.source_version,
    sourceDigest: row.source_digest ?? undefined,
    targetVersion: row.target_version,
    targetDigest: row.target_digest,
    rollbackVersion: row.rollback_version ?? undefined,
    rollbackDigest: row.rollback_digest ?? undefined,
    state: row.state,
    actorId: row.actor_id,
    actorDisplayName: row.actor_display_name ?? undefined,
    correlationId: row.correlation_id,
    controllerCorrelationId: row.controller_correlation_id ?? undefined,
    requestedAt: row.requested_at,
    acceptedAt: row.accepted_at ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    lastObservedAt: row.last_observed_at ?? undefined,
    safeErrorCode: row.safe_error_code ?? undefined,
    safeErrorDetail: row.safe_error_detail ?? undefined,
    preflightResult: preflight,
    controllerEvidence: parseJsonObject(row.controller_evidence) as UpgradeControllerEvidence,
  };
}

export interface CreateUpgradeJobInput {
  id: string;
  idempotencyKey: string;
  deploymentTarget: string;
  controllerType: string;
  controllerVersion?: string;
  sourceVersion: string;
  sourceDigest?: string;
  targetVersion: string;
  targetDigest: string;
  rollbackVersion?: string;
  rollbackDigest?: string;
  actorId: string;
  actorDisplayName?: string;
  correlationId: string;
}

export interface CreateUpgradeJobResult {
  created: boolean;
  job: UpgradeJobSnapshot;
}

export async function getUpgradeJob(
  db: D1Database,
  id: string,
): Promise<UpgradeJobSnapshot | null> {
  const row = await db.prepare('SELECT * FROM upgrade_jobs WHERE id = ?1')
    .bind(id).first<UpgradeJobRow>();
  return row ? toSnapshot(row) : null;
}

export async function getUpgradeJobByIdempotencyKey(
  db: D1Database,
  key: string,
): Promise<UpgradeJobSnapshot | null> {
  const row = await db.prepare('SELECT * FROM upgrade_jobs WHERE idempotency_key = ?1')
    .bind(key).first<UpgradeJobRow>();
  return row ? toSnapshot(row) : null;
}

export async function listUpgradeJobs(
  db: D1Database,
  limit = 50,
): Promise<UpgradeJobSnapshot[]> {
  const rows = await db.prepare(
    'SELECT * FROM upgrade_jobs ORDER BY requested_at DESC LIMIT ?1',
  ).bind(limit).all<UpgradeJobRow>();
  return rows.results.map(toSnapshot);
}

async function activeUpgradeJobId(db: D1Database): Promise<string | null> {
  const row = await db.prepare(
    `SELECT id FROM upgrade_jobs
     WHERE state NOT IN ('completed', 'canceled', 'failed', 'rolled_back')
     ORDER BY requested_at LIMIT 1`,
  ).first<{ id: string }>();
  return row?.id ?? null;
}

/** Idempotent creation guarded by a database-enforced deployment-wide lock. */
export async function createUpgradeJob(
  db: D1Database,
  input: CreateUpgradeJobInput,
): Promise<CreateUpgradeJobResult> {
  const replay = await getUpgradeJobByIdempotencyKey(db, input.idempotencyKey);
  if (replay) return { created: false, job: replay };

  const activeId = await activeUpgradeJobId(db);
  if (activeId) throw new UpgradeInProgressError(activeId);

  try {
    await db.prepare(
      `INSERT INTO upgrade_jobs (
         id, idempotency_key, deployment_target, controller_type, controller_version,
         source_version, source_digest, target_version, target_digest,
         rollback_version, rollback_digest, actor_id, actor_display_name, correlation_id
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    ).bind(
      input.id, input.idempotencyKey, input.deploymentTarget, input.controllerType,
      input.controllerVersion ?? null, input.sourceVersion, input.sourceDigest ?? null,
      input.targetVersion, input.targetDigest, input.rollbackVersion ?? null,
      input.rollbackDigest ?? null, input.actorId, input.actorDisplayName ?? null,
      input.correlationId,
    ).run();
  } catch (error) {
    const concurrentReplay = await getUpgradeJobByIdempotencyKey(db, input.idempotencyKey);
    if (concurrentReplay) return { created: false, job: concurrentReplay };
    const concurrentActiveId = await activeUpgradeJobId(db);
    if (concurrentActiveId) throw new UpgradeInProgressError(concurrentActiveId);
    throw error;
  }

  await db.prepare(
    `INSERT INTO upgrade_job_events (
       id, upgrade_job_id, sequence, event_type, to_state, actor_id
     ) VALUES (?1, ?2, 1, 'requested', 'requested', ?3)`,
  ).bind(`${input.id}:1`, input.id, input.actorId).run();

  const job = await getUpgradeJob(db, input.id);
  if (!job) throw new Error('Upgrade job was not persisted.');
  return { created: true, job };
}

export interface TransitionUpgradeJobInput {
  eventId: string;
  actorId?: string;
  safeDetail?: string;
  evidence?: Record<string, unknown>;
  preflightResult?: UpgradePreflightResult;
  controllerCorrelationId?: string;
  safeErrorCode?: string;
  safeErrorDetail?: string;
}

export async function transitionUpgradeJob(
  db: D1Database,
  id: string,
  nextState: UpgradeJobState,
  input: TransitionUpgradeJobInput,
): Promise<UpgradeJobSnapshot> {
  const current = await db.prepare('SELECT * FROM upgrade_jobs WHERE id = ?1')
    .bind(id).first<UpgradeJobRow>();
  if (!current) throw new Error(`Upgrade job ${id} was not found.`);
  if (current.state === nextState) return toSnapshot(current);
  if (!canTransitionUpgradeJob(current.state, nextState)) {
    throw new InvalidUpgradeTransitionError(current.state, nextState);
  }

  const mergedEvidence: UpgradeControllerEvidence = {
    ...parseJsonObject(current.controller_evidence),
    ...(input.evidence ?? {}),
  };
  const missingEvidence = missingUpgradeSafetyEvidence(
    nextState, mergedEvidence, current.target_digest,
  );
  if (missingEvidence.length > 0) {
    throw new MissingUpgradeSafetyEvidenceError(missingEvidence);
  }

  const terminal = ['completed', 'canceled', 'failed', 'rolled_back'].includes(nextState);
  const result = await db.prepare(
    `UPDATE upgrade_jobs SET state = ?2,
       controller_correlation_id = COALESCE(?3, controller_correlation_id),
       preflight_result = COALESCE(?4, preflight_result),
       controller_evidence = CASE WHEN ?5 IS NULL THEN controller_evidence ELSE ?5 END,
       safe_error_code = ?6, safe_error_detail = ?7,
       accepted_at = CASE WHEN ?2 = 'accepted' THEN COALESCE(accepted_at, datetime('now')) ELSE accepted_at END,
       started_at = CASE WHEN ?2 = 'preflight' THEN COALESCE(started_at, datetime('now')) ELSE started_at END,
       completed_at = CASE WHEN ?8 = 1 THEN datetime('now') ELSE completed_at END,
       cancel_requested_at = CASE WHEN ?2 = 'cancel_requested' THEN datetime('now') ELSE cancel_requested_at END,
       rollback_requested_at = CASE WHEN ?2 = 'rollback_requested' THEN datetime('now') ELSE rollback_requested_at END,
       last_observed_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?1 AND state = ?9`,
  ).bind(
    id, nextState, input.controllerCorrelationId ?? null,
    input.preflightResult ? JSON.stringify(input.preflightResult) : null,
    input.evidence ? JSON.stringify(mergedEvidence) : null,
    input.safeErrorCode ?? null, input.safeErrorDetail?.slice(0, 500) ?? null,
    terminal ? 1 : 0, current.state,
  ).run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new Error(`Upgrade job ${id} changed concurrently.`);
  }

  const sequence = await db.prepare(
    'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM upgrade_job_events WHERE upgrade_job_id = ?1',
  ).bind(id).first<{ sequence: number }>();
  await db.prepare(
    `INSERT INTO upgrade_job_events (
       id, upgrade_job_id, sequence, event_type, from_state, to_state,
       actor_id, safe_detail, evidence
     ) VALUES (?1, ?2, ?3, 'transition', ?4, ?5, ?6, ?7, ?8)`,
  ).bind(
    input.eventId, id, sequence?.sequence ?? 1, current.state, nextState,
    input.actorId ?? null, input.safeDetail?.slice(0, 500) ?? null,
    JSON.stringify(input.evidence ?? {}),
  ).run();

  const updated = await getUpgradeJob(db, id);
  if (!updated) throw new Error(`Upgrade job ${id} disappeared after transition.`);
  return updated;
}

export interface UpgradeJobEventRow {
  id: string;
  upgrade_job_id: string;
  sequence: number;
  event_type: string;
  from_state: UpgradeJobState | null;
  to_state: UpgradeJobState;
  actor_id: string | null;
  safe_detail: string | null;
  evidence: string;
  created_at: string;
}

export async function listUpgradeJobEvents(
  db: D1Database,
  jobId: string,
): Promise<UpgradeJobEventRow[]> {
  const rows = await db.prepare(
    'SELECT * FROM upgrade_job_events WHERE upgrade_job_id = ?1 ORDER BY sequence',
  ).bind(jobId).all<UpgradeJobEventRow>();
  return rows.results;
}

export interface UpgradeRequestNonceInput {
  nonce: string;
  actorId: string;
  action: string;
  deploymentTarget: string;
  targetVersion: string;
  targetDigest: string;
  expiresAt: string;
}

export async function registerUpgradeRequestNonce(
  db: D1Database,
  input: UpgradeRequestNonceInput,
): Promise<void> {
  await db.prepare(
    `INSERT INTO upgrade_request_nonces (
       nonce, actor_id, action, deployment_target, target_version,
       target_digest, expires_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).bind(
    input.nonce, input.actorId, input.action, input.deploymentTarget,
    input.targetVersion, input.targetDigest, input.expiresAt,
  ).run();
}

/** Atomically consumes an exact target-bound approval at most once. */
export async function consumeUpgradeRequestNonce(
  db: D1Database,
  input: Omit<UpgradeRequestNonceInput, 'expiresAt'>,
  now = new Date().toISOString(),
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE upgrade_request_nonces SET used_at = ?7
     WHERE nonce = ?1 AND actor_id = ?2 AND action = ?3
       AND deployment_target = ?4 AND target_version = ?5 AND target_digest = ?6
       AND used_at IS NULL AND expires_at >= ?7`,
  ).bind(
    input.nonce, input.actorId, input.action, input.deploymentTarget,
    input.targetVersion, input.targetDigest, now,
  ).run();
  return (result.meta.changes ?? 0) === 1;
}
