import { getMeta, setMeta } from '@repo-wrangler/persistence-d1';

const SETUP_COMPLETED_KEY = 'auth.setup_completed';

export async function setupWasCompleted(db: D1Database): Promise<boolean> {
  return (await getMeta(db, SETUP_COMPLETED_KEY)) === 'true';
}

export async function markSetupCompleted(db: D1Database): Promise<void> {
  await setMeta(db, SETUP_COMPLETED_KEY, 'true');
}
