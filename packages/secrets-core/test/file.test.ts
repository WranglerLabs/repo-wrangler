import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileSecretProvider } from '../src/file';

describe('FileSecretProvider', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rw-secrets-'));
    await writeFile(join(dir, 'SESSION_SECRET'), 'exact-name\n');
    await writeFile(join(dir, 'github-client-secret'), 'kebab-name\n');
    await writeFile(join(dir, 'gitlab_token'), 'snake-name');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads a file named exactly like the env var and strips the trailing newline', async () => {
    expect(await new FileSecretProvider(dir).get('SESSION_SECRET')).toBe('exact-name');
  });

  it('falls back to the lower-kebab file name (vault convention)', async () => {
    expect(await new FileSecretProvider(dir).get('GITHUB_CLIENT_SECRET')).toBe('kebab-name');
  });

  it('falls back to the lower-snake file name', async () => {
    expect(await new FileSecretProvider(dir).get('GITLAB_TOKEN')).toBe('snake-name');
  });

  it('returns undefined when no file matches', async () => {
    expect(await new FileSecretProvider(dir).get('MISSING')).toBeUndefined();
  });
});
