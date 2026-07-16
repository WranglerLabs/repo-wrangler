import { Hono } from 'hono';
import { schedulerMode, type Env } from '../bindings';
import type { AppContext } from '../middleware/auth';
import { runScheduled } from '../scheduled';

/**
 * External-tick scheduler driver (PN-3, ADR-018).
 *
 * The reference deployment uses Cloudflare Cron; the Node host uses an in-process
 * timer. Every other target — Linux `cron`, a Kubernetes `CronJob`, a GitHub
 * Actions schedule, or an Azure Functions timer — drives the exact same
 * `runScheduled` work by making an authenticated HTTP call to this endpoint. That
 * collapses all of those "drivers" into one interface: a POST on a schedule.
 *
 * Auth is a shared bearer token (`CRON_TRIGGER_TOKEN`). The endpoint is only
 * mounted/active when that token is set and the scheduler is in external mode, so
 * a default deployment never exposes a triggerable sync path.
 */
export const internalCronRoutes = new Hono<AppContext>();

const PERIODIC_CRON = '*/5 * * * *';
const DAILY_CRON = '17 3 * * *';

/** Constant-time-ish comparison to avoid leaking the token via timing. */
function tokenMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

internalCronRoutes.post('/cron/run', async (c) => {
  const expected = c.env.CRON_TRIGGER_TOKEN;
  // Only available when an operator has opted into external triggering.
  if (!expected || schedulerMode(c.env) !== 'external') {
    return c.json({ error: 'External cron trigger is not enabled.' }, 404);
  }
  const provided = bearer(c.req.header('authorization'));
  if (!provided || !tokenMatches(provided, expected)) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  // `job=daily` runs maintenance; anything else runs the periodic sync — matching
  // the two Cloudflare cron triggers exactly.
  const job = c.req.query('job') === 'daily' ? 'daily' : 'periodic';
  const cron = job === 'daily' ? DAILY_CRON : PERIODIC_CRON;
  await runScheduled(c.env, cron);
  return c.json({ ok: true, job });
});
