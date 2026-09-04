import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, openSqliteD1 } from '@repo-wrangler/persistence-sqlite';
import {
  createUpgradeJob,
  getUpgradeJob,
  InvalidUpgradeTransitionError,
  listUpgradeJobEvents,
  transitionUpgradeJob,
  UpgradeInProgressError,
} from '../src/upgrades';

const migrationsDir = join(__dirname, '../../../migrations');
const scratchDir = join(__dirname, '.upgrade-job-test-data');

function input(id: string, key = `${id}-key`) {
  return {
    id,
    idempotencyKey: key,
    deploymentTarget: 'installation',
    controllerType: 'contract-test',
    controllerVersion: '1.0.0',
    sourceVersion: '1.0.23',
    sourceDigest: 'sha256:source',
    targetVersion: '1.0.24',
    targetDigest: 'sha256:target',
    rollbackVersion: '1.0.23',
    rollbackDigest: 'sha256:source',
    actorId: 'owner-1',
    actorDisplayName: 'Owner',
    correlationId: `${id}-correlation`,
  };
}

function database(location = ':memory:') {
  const opened = openSqliteD1(location);
  applyMigrations(opened.raw, migrationsDir);
  return opened;
}

afterEach(() => {
  if (existsSync(scratchDir)) rmSync(scratchDir, { recursive: true, force: true });
});

describe('durable upgrade jobs', () => {
  it('replays an idempotent request and rejects a different concurrent upgrade', async () => {
    const { d1 } = database();
    const db = d1 as unknown as D1Database;

    const first = await createUpgradeJob(db, input('upgrade-1'));
    expect(first.created).toBe(true);
    const replay = await createUpgradeJob(db, input('ignored-new-id', 'upgrade-1-key'));
    expect(replay).toEqual({ created: false, job: first.job });

    await expect(createUpgradeJob(db, input('upgrade-2')))
      .rejects.toEqual(expect.objectContaining<Partial<UpgradeInProgressError>>({
        name: 'UpgradeInProgressError', activeJobId: 'upgrade-1',
      }));
  });

  it('persists valid transitions and immutable ordered evidence', async () => {
    const { d1 } = database();
    const db = d1 as unknown as D1Database;
    await createUpgradeJob(db, input('upgrade'));

    const accepted = await transitionUpgradeJob(db, 'upgrade', 'accepted', {
      eventId: 'event-2', actorId: 'owner-1',
      controllerCorrelationId: 'controller-42',
      evidence: { requestId: 'safe-42' },
    });
    expect(accepted).toMatchObject({
      state: 'accepted', controllerCorrelationId: 'controller-42',
      controllerEvidence: { requestId: 'safe-42' },
    });

    await transitionUpgradeJob(db, 'upgrade', 'preflight', {
      eventId: 'event-3',
      preflightResult: {
        ready: true,
        checks: [{ id: 'controller', status: 'passed' }],
        irreversibleChanges: [],
        checkedAt: '2026-09-04T00:00:00.000Z',
      },
    });
    const events = await listUpgradeJobEvents(db, 'upgrade');
    expect(events.map((event) => [event.sequence, event.from_state, event.to_state]))
      .toEqual([
        [1, null, 'requested'],
        [2, 'requested', 'accepted'],
        [3, 'accepted', 'preflight'],
      ]);
  });

  it('refuses invalid state jumps and releases the lock after a final failure', async () => {
    const { d1 } = database();
    const db = d1 as unknown as D1Database;
    await createUpgradeJob(db, input('upgrade-1'));

    await expect(transitionUpgradeJob(db, 'upgrade-1', 'completed', {
      eventId: 'bad-transition',
    })).rejects.toBeInstanceOf(InvalidUpgradeTransitionError);

    await transitionUpgradeJob(db, 'upgrade-1', 'failed', {
      eventId: 'failed', safeErrorCode: 'controller_unavailable',
      safeErrorDetail: 'The controller did not accept the request.',
    });
    await expect(createUpgradeJob(db, input('upgrade-2'))).resolves.toMatchObject({
      created: true, job: { id: 'upgrade-2' },
    });
  });

  it('survives application restart with controller correlation and final status intact', async () => {
    mkdirSync(scratchDir, { recursive: true });
    const path = join(scratchDir, 'restart.sqlite');
    const first = database(path);
    const firstDb = first.d1 as unknown as D1Database;
    await createUpgradeJob(firstDb, input('restart-upgrade'));
    await transitionUpgradeJob(firstDb, 'restart-upgrade', 'accepted', {
      eventId: 'restart-event-2', controllerCorrelationId: 'external-run-7',
    });
    first.raw.close();

    const restarted = database(path);
    const persisted = await getUpgradeJob(
      restarted.d1 as unknown as D1Database,
      'restart-upgrade',
    );
    expect(persisted).toMatchObject({
      state: 'accepted', controllerCorrelationId: 'external-run-7',
      targetDigest: 'sha256:target', correlationId: 'restart-upgrade-correlation',
    });
    restarted.raw.close();
  });
});
