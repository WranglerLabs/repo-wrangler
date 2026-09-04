import { Hono, type Context } from 'hono';
import {
  executeUpgradeActionSchema,
  executeUpgradeRequestSchema,
  upgradeActionSchema,
  upgradeTargetSelectionSchema,
} from '@repo-wrangler/contracts';
import {
  canTransitionUpgradeJob,
  evaluateRelease,
  upgradeJobTransitionPath,
  type UpgradeActor,
  type UpgradeJobSnapshot,
} from '@repo-wrangler/domain';
import {
  consumeUpgradeRequestNonce,
  createUpgradeJob,
  getUpgradeJob,
  getUpgradeJobByIdempotencyKey,
  listUpgradeJobEvents,
  listUpgradeJobs,
  recordAuditEvent,
  registerUpgradeRequestNonce,
  transitionUpgradeJob,
  UpgradeInProgressError,
} from '@repo-wrangler/persistence-d1';
import { appVersion, corsAllowedOrigins, type Env } from '../bindings';
import { requireAdmin, type AppContext } from '../middleware/auth';
import {
  DEFAULT_STABLE_RELEASE_MANIFEST_URL,
  fetchReleaseManifest,
} from '../lib/releases';
import { configuredUpgradeController } from '../lib/upgrade-controller';
import {
  createUpgradeActionToken,
  isAllowedUpgradeOrigin,
  redactUpgradeDetail,
  verifyUpgradeActionToken,
  type UpgradeProtectedAction,
} from '../lib/upgrade-security';

export const upgradeRoutes = new Hono<AppContext>();

function actor(c: Context<AppContext>): UpgradeActor {
  const user = c.get('user');
  if (user.role !== 'owner' && user.role !== 'admin') throw new Error('Administrator required.');
  return { id: user.login, displayName: user.login, role: user.role };
}

function mutationOriginAllowed(c: Context<AppContext>): boolean {
  return isAllowedUpgradeOrigin({
    requestUrl: c.req.url,
    origin: c.req.header('origin'),
    publicBaseUrl: c.env.PUBLIC_BASE_URL,
    corsAllowedOrigins: corsAllowedOrigins(c.env),
  });
}

async function readJson(c: Context<AppContext>): Promise<unknown> {
  try { return await c.req.json(); } catch { return null; }
}

async function currentEvaluation(env: Env) {
  const configured = configuredUpgradeController(env);
  const capabilities = await configured.controller.capabilities();
  const manifestUrl = env.UPGRADE_RELEASE_MANIFEST_URL?.trim()
    || DEFAULT_STABLE_RELEASE_MANIFEST_URL;
  const fetched = await fetchReleaseManifest(manifestUrl);
  const evaluation = evaluateRelease({
    installedVersion: appVersion(env),
    installedSchemaVersion: configured.schemaVersion,
    deploymentTarget: configured.releaseTarget,
    channel: configured.channel,
    sourceSupported: fetched.ok || fetched.code !== 'unsupported_source',
    manifest: fetched.ok ? fetched.manifest : undefined,
    controller: capabilities,
  });
  return {
    configured, capabilities, manifestUrl, fetched, evaluation,
    checkedAt: fetched.fetchedAt,
  };
}

function publicJob(job: UpgradeJobSnapshot) {
  return job;
}

upgradeRoutes.get('/', requireAdmin, async (c) => {
  const [release, jobs] = await Promise.all([currentEvaluation(c.env), listUpgradeJobs(c.env.DB)]);
  return c.json({
    installedVersion: appVersion(c.env),
    channel: release.configured.channel,
    deploymentTarget: release.configured.deploymentTarget,
    releaseTarget: release.configured.releaseTarget,
    manifestUrl: release.manifestUrl,
    checkedAt: release.checkedAt,
    evaluation: release.evaluation,
    controller: release.capabilities,
    sourceError: release.fetched.ok ? undefined : {
      code: release.fetched.code, detail: release.fetched.detail,
    },
    jobs: jobs.map(publicJob),
  });
});

upgradeRoutes.post('/prepare', requireAdmin, async (c) => {
  if (!mutationOriginAllowed(c)) return c.json({ error: 'untrusted_origin' }, 403);
  const parsed = upgradeTargetSelectionSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: 'invalid_target' }, 400);
  const release = await currentEvaluation(c.env);
  const evaluation = release.evaluation;
  if (evaluation.status !== 'update_available'
    || evaluation.availableVersion !== parsed.data.targetVersion
    || evaluation.imageDigest !== parsed.data.targetDigest) {
    await recordAuditEvent(c.env.DB, c.get('user').login, 'upgrade.preflight.rejected',
      `target=${parsed.data.targetVersion} reason=release_not_ready`);
    return c.json({ error: 'release_not_ready', evaluation }, 409);
  }
  if (!c.env.SESSION_SECRET || !c.env.UPGRADE_CURRENT_IMAGE_DIGEST) {
    return c.json({ error: 'upgrade_safety_not_configured' }, 409);
  }

  const upgradeActor = actor(c);
  const correlationId = crypto.randomUUID();
  const idempotencyKey = `preflight:${crypto.randomUUID()}`;
  const request = {
    correlationId, idempotencyKey,
    deploymentTarget: release.configured.deploymentTarget,
    sourceVersion: appVersion(c.env),
    sourceDigest: c.env.UPGRADE_CURRENT_IMAGE_DIGEST,
    targetVersion: parsed.data.targetVersion,
    targetDigest: parsed.data.targetDigest,
    rollbackVersion: appVersion(c.env),
    rollbackDigest: c.env.UPGRADE_CURRENT_IMAGE_DIGEST,
    actor: upgradeActor,
  };
  const controllerPreflight = await release.configured.controller.preflight(request);
  const preflight = {
    ...controllerPreflight,
    ready: controllerPreflight.ready,
    irreversibleChanges: evaluation.irreversibleMigrations,
  };
  const issued = await createUpgradeActionToken(c.env.SESSION_SECRET, {
    actor: upgradeActor, action: 'request',
    deploymentTarget: request.deploymentTarget,
    targetVersion: request.targetVersion, targetDigest: request.targetDigest,
  });
  await registerUpgradeRequestNonce(c.env.DB, {
    nonce: issued.payload.nonce, actorId: upgradeActor.id, action: 'request',
    deploymentTarget: request.deploymentTarget, targetVersion: request.targetVersion,
    targetDigest: request.targetDigest,
    expiresAt: new Date(issued.payload.expiresAt * 1000).toISOString(),
  });
  await recordAuditEvent(c.env.DB, upgradeActor.id, 'upgrade.preflight.completed',
    `correlation=${correlationId} target=${request.targetVersion} ready=${preflight.ready}`);
  return c.json({
    correlationId, preflight, approvalToken: issued.token,
    approvalExpiresAt: new Date(issued.payload.expiresAt * 1000).toISOString(),
    target: parsed.data,
    rollback: { version: request.rollbackVersion, digest: request.rollbackDigest },
  });
});

upgradeRoutes.post('/request', requireAdmin, async (c) => {
  if (!mutationOriginAllowed(c)) return c.json({ error: 'untrusted_origin' }, 403);
  const parsed = executeUpgradeRequestSchema.safeParse(await readJson(c));
  if (!parsed.success || !c.env.SESSION_SECRET) return c.json({ error: 'invalid_request' }, 400);
  const release = await currentEvaluation(c.env);
  if (release.evaluation.status !== 'update_available'
    || release.evaluation.availableVersion !== parsed.data.targetVersion
    || release.evaluation.imageDigest !== parsed.data.targetDigest
    || !c.env.UPGRADE_CURRENT_IMAGE_DIGEST) {
    return c.json({ error: 'release_not_ready' }, 409);
  }
  const upgradeActor = actor(c);
  const binding = {
    actor: upgradeActor, action: 'request' as const,
    deploymentTarget: release.configured.deploymentTarget,
    targetVersion: parsed.data.targetVersion, targetDigest: parsed.data.targetDigest,
  };
  const existing = await getUpgradeJobByIdempotencyKey(c.env.DB, parsed.data.idempotencyKey);
  if (existing) {
    if (existing.actorId !== upgradeActor.id
      || existing.deploymentTarget !== binding.deploymentTarget
      || existing.targetVersion !== binding.targetVersion
      || existing.targetDigest !== binding.targetDigest) {
      return c.json({ error: 'idempotency_key_conflict' }, 409);
    }
    return c.json({ replayed: true, job: publicJob(existing) });
  }
  const approval = await verifyUpgradeActionToken(
    c.env.SESSION_SECRET, parsed.data.approvalToken, binding,
  );
  if (!approval || !await consumeUpgradeRequestNonce(c.env.DB, {
    nonce: approval.nonce, actorId: upgradeActor.id, action: 'request',
    deploymentTarget: binding.deploymentTarget, targetVersion: binding.targetVersion,
    targetDigest: binding.targetDigest,
  })) {
    await recordAuditEvent(c.env.DB, upgradeActor.id, 'upgrade.request.rejected',
      `target=${binding.targetVersion} reason=invalid_or_replayed_approval`);
    return c.json({ error: 'invalid_or_replayed_approval' }, 409);
  }

  const id = crypto.randomUUID();
  let created;
  try {
    created = await createUpgradeJob(c.env.DB, {
      id, idempotencyKey: parsed.data.idempotencyKey,
      deploymentTarget: binding.deploymentTarget,
      controllerType: release.capabilities.controllerType,
      controllerVersion: release.capabilities.controllerVersion,
      sourceVersion: appVersion(c.env), sourceDigest: c.env.UPGRADE_CURRENT_IMAGE_DIGEST,
      targetVersion: binding.targetVersion, targetDigest: binding.targetDigest,
      rollbackVersion: appVersion(c.env), rollbackDigest: c.env.UPGRADE_CURRENT_IMAGE_DIGEST,
      actorId: upgradeActor.id, actorDisplayName: upgradeActor.displayName,
      correlationId: crypto.randomUUID(),
    });
  } catch (error) {
    if (error instanceof UpgradeInProgressError) {
      return c.json({ error: 'upgrade_in_progress', activeJobId: error.activeJobId }, 409);
    }
    throw error;
  }
  if (!created.created) return c.json({ replayed: true, job: publicJob(created.job) });

  const request = {
    correlationId: created.job.correlationId,
    idempotencyKey: parsed.data.idempotencyKey,
    deploymentTarget: created.job.deploymentTarget,
    sourceVersion: created.job.sourceVersion,
    sourceDigest: created.job.sourceDigest,
    targetVersion: created.job.targetVersion,
    targetDigest: created.job.targetDigest,
    rollbackVersion: created.job.rollbackVersion,
    rollbackDigest: created.job.rollbackDigest,
    actor: upgradeActor,
  };
  try {
    const receipt = await release.configured.controller.request(request);
    const job = await transitionUpgradeJob(c.env.DB, created.job.id, 'accepted', {
      eventId: crypto.randomUUID(), actorId: upgradeActor.id,
      controllerCorrelationId: receipt.controllerCorrelationId,
      evidence: receipt.evidence,
      safeDetail: 'The external deployment controller accepted the request.',
    });
    await recordAuditEvent(c.env.DB, upgradeActor.id, 'upgrade.request.accepted',
      `job=${job.id} correlation=${job.correlationId} target=${job.targetVersion}`);
    return c.json({ replayed: false, job: publicJob(job) }, 202);
  } catch (error) {
    const detail = redactUpgradeDetail(error instanceof Error ? error.message : 'Controller request failed.');
    const failed = await transitionUpgradeJob(c.env.DB, created.job.id, 'failed', {
      eventId: crypto.randomUUID(), actorId: upgradeActor.id,
      safeErrorCode: 'controller_request_failed', safeErrorDetail: detail,
      safeDetail: detail,
    });
    await recordAuditEvent(c.env.DB, upgradeActor.id, 'upgrade.request.failed',
      `job=${failed.id} code=controller_request_failed`);
    return c.json({ error: 'controller_request_failed', job: publicJob(failed) }, 502);
  }
});

upgradeRoutes.get('/jobs/:id', requireAdmin, async (c) => {
  let job = await getUpgradeJob(c.env.DB, c.req.param('id'));
  if (!job) return c.json({ error: 'not_found' }, 404);
  if (job.controllerCorrelationId
    && !['completed', 'canceled', 'failed', 'rolled_back'].includes(job.state)) {
    try {
      const configured = configuredUpgradeController(c.env);
      const observed = await configured.controller.status(job.controllerCorrelationId);
      if (observed.state !== job.state) {
        const path = canTransitionUpgradeJob(job.state, observed.state)
          ? [observed.state]
          : upgradeJobTransitionPath(job.state, observed.state);
        for (const state of path) {
          job = await transitionUpgradeJob(c.env.DB, job.id, state, {
            eventId: crypto.randomUUID(), evidence: observed.evidence,
            safeErrorCode: state === observed.state ? observed.safeErrorCode : undefined,
            safeErrorDetail: state === observed.state && observed.safeErrorDetail
              ? redactUpgradeDetail(observed.safeErrorDetail) : undefined,
            safeDetail: state === observed.state
              ? `Controller reported ${observed.state}.`
              : `Reconciled skipped controller checkpoint ${state}.`,
          });
        }
      }
    } catch {
      // Preserve the last durable state; a transient poll failure is not a job failure.
    }
  }
  return c.json({ job: publicJob(job), events: await listUpgradeJobEvents(c.env.DB, job.id) });
});

upgradeRoutes.post('/jobs/:id/prepare-action', requireAdmin, async (c) => {
  if (!mutationOriginAllowed(c)) return c.json({ error: 'untrusted_origin' }, 403);
  const parsed = upgradeActionSchema.safeParse(await readJson(c));
  const job = await getUpgradeJob(c.env.DB, c.req.param('id'));
  if (!parsed.success || !job || !c.env.SESSION_SECRET) return c.json({ error: 'invalid_request' }, 400);
  const upgradeActor = actor(c);
  const issued = await createUpgradeActionToken(c.env.SESSION_SECRET, {
    actor: upgradeActor, action: parsed.data.action,
    deploymentTarget: job.deploymentTarget,
    targetVersion: job.targetVersion, targetDigest: job.targetDigest,
  });
  await registerUpgradeRequestNonce(c.env.DB, {
    nonce: issued.payload.nonce, actorId: upgradeActor.id, action: parsed.data.action,
    deploymentTarget: job.deploymentTarget, targetVersion: job.targetVersion,
    targetDigest: job.targetDigest,
    expiresAt: new Date(issued.payload.expiresAt * 1000).toISOString(),
  });
  await recordAuditEvent(c.env.DB, upgradeActor.id, `upgrade.${parsed.data.action}.prepared`,
    `job=${job.id}`);
  return c.json({ approvalToken: issued.token, action: parsed.data.action, job: publicJob(job) });
});

async function executeAction(
  c: Context<AppContext, '/jobs/:id'>,
  expectedAction: UpgradeProtectedAction,
) {
  if (!mutationOriginAllowed(c)) return c.json({ error: 'untrusted_origin' }, 403);
  const parsed = executeUpgradeActionSchema.safeParse(await readJson(c));
  const job = await getUpgradeJob(c.env.DB, c.req.param('id'));
  if (!parsed.success || parsed.data.action !== expectedAction || !job || !c.env.SESSION_SECRET
    || !job.controllerCorrelationId) return c.json({ error: 'invalid_request' }, 400);
  const upgradeActor = actor(c);
  const binding = {
    actor: upgradeActor, action: expectedAction,
    deploymentTarget: job.deploymentTarget,
    targetVersion: job.targetVersion, targetDigest: job.targetDigest,
  };
  const approval = await verifyUpgradeActionToken(
    c.env.SESSION_SECRET, parsed.data.approvalToken, binding,
  );
  if (!approval || !await consumeUpgradeRequestNonce(c.env.DB, {
    nonce: approval.nonce, actorId: upgradeActor.id, action: expectedAction,
    deploymentTarget: job.deploymentTarget, targetVersion: job.targetVersion,
    targetDigest: job.targetDigest,
  })) return c.json({ error: 'invalid_or_replayed_approval' }, 409);

  const configured = configuredUpgradeController(c.env);
  const receipt = expectedAction === 'cancel'
    ? await configured.controller.cancel(job.controllerCorrelationId, upgradeActor)
    : await configured.controller.rollback(job.controllerCorrelationId, upgradeActor);
  const next = expectedAction === 'cancel' ? 'cancel_requested' : 'rollback_requested';
  const updated = await transitionUpgradeJob(c.env.DB, job.id, next, {
    eventId: crypto.randomUUID(), actorId: upgradeActor.id,
    controllerCorrelationId: receipt.controllerCorrelationId,
    evidence: receipt.evidence, safeDetail: `${expectedAction} accepted by controller.`,
  });
  await recordAuditEvent(c.env.DB, upgradeActor.id, `upgrade.${expectedAction}.requested`,
    `job=${job.id}`);
  return c.json({ job: publicJob(updated) }, 202);
}

upgradeRoutes.post('/jobs/:id/cancel', requireAdmin,
  (c) => executeAction(c, 'cancel'));
upgradeRoutes.post('/jobs/:id/rollback', requireAdmin,
  (c) => executeAction(c, 'rollback'));
