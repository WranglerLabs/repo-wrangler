/**
 * In-process cron for the Node host.
 *
 * On Cloudflare the two triggers in wrangler.jsonc (`*​/15 * * * *` and
 * `17 3 * * *`) call the Worker's `scheduled` handler, which delegates to
 * `runScheduled(env, cron)`. Here a minute-tick timer reproduces exactly those
 * two cron expressions and calls the same `runScheduled` — so reconciliation,
 * enrichment, and daily maintenance run identically off Cloudflare.
 *
 * A single in-flight guard prevents an overlapping invocation from
 * double-claiming sync jobs. Set `ENABLE_SCHEDULER=false` to run a stateless
 * API replica with cron handled elsewhere.
 */
import type { Env } from '@repo-wrangler/worker';
import { runScheduled } from '@repo-wrangler/worker';

const PERIODIC_CRON = '*/15 * * * *';
const DAILY_CRON = '17 3 * * *';

export interface Scheduler {
  stop(): void;
}

type Logger = (message: string, error?: unknown) => void;

/**
 * Start the in-process scheduler. Fires the periodic job at every quarter hour
 * and the daily maintenance job at 03:17 UTC — the exact wrangler triggers.
 */
export function startScheduler(env: Env, log: Logger): Scheduler {
  let running = false;
  let lastDailyKey = '';
  let lastPeriodicKey = '';

  async function fire(cron: string): Promise<void> {
    if (running) {
      log(`scheduler: previous run still in progress, skipping ${cron}`);
      return;
    }
    running = true;
    try {
      await runScheduled(env, cron);
    } catch (error) {
      log(`scheduler: ${cron} failed`, error);
    } finally {
      running = false;
    }
  }

  // Check once a minute; UTC so behaviour matches Cloudflare cron.
  const timer = setInterval(() => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const minuteKey = `${day}T${now.getUTCHours()}:${now.getUTCMinutes()}`;

    if (now.getUTCHours() === 3 && now.getUTCMinutes() === 17 && lastDailyKey !== day) {
      lastDailyKey = day;
      void fire(DAILY_CRON);
      return;
    }
    if (now.getUTCMinutes() % 15 === 0 && lastPeriodicKey !== minuteKey) {
      lastPeriodicKey = minuteKey;
      void fire(PERIODIC_CRON);
    }
  }, 60_000);

  // Don't hold the event loop open on shutdown.
  timer.unref?.();

  // Prime the estate once shortly after boot so a fresh instance starts syncing
  // without waiting up to 15 minutes for the first quarter-hour tick.
  const kickoff = setTimeout(() => void fire(PERIODIC_CRON), 5_000);
  kickoff.unref?.();

  log(`scheduler: started (periodic ${PERIODIC_CRON}, daily ${DAILY_CRON} UTC)`);

  return {
    stop() {
      clearInterval(timer);
      clearTimeout(kickoff);
    },
  };
}
