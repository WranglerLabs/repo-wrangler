import { describe, expect, it } from 'vitest';
import {
  CompositeSecretProvider,
  EnvSecretProvider,
  keyVaultSecretName,
  resolveSecrets,
  type SecretProvider,
} from '../src/provider';

describe('EnvSecretProvider', () => {
  it('returns a present value', async () => {
    const p = new EnvSecretProvider({ SESSION_SECRET: 's3cr3t' });
    expect(await p.get('SESSION_SECRET')).toBe('s3cr3t');
  });

  it('treats empty string as absent', async () => {
    const p = new EnvSecretProvider({ SESSION_SECRET: '' });
    expect(await p.get('SESSION_SECRET')).toBeUndefined();
  });

  it('returns undefined for a missing key', async () => {
    const p = new EnvSecretProvider({});
    expect(await p.get('NOPE')).toBeUndefined();
  });
});

describe('CompositeSecretProvider', () => {
  const primary: SecretProvider = {
    label: 'primary',
    get: (n) => Promise.resolve(n === 'A' ? 'from-primary' : undefined),
  };
  const fallback: SecretProvider = {
    label: 'fallback',
    get: (n) => Promise.resolve(n === 'A' ? 'from-fallback' : n === 'B' ? 'b-value' : undefined),
  };

  it('prefers the earlier provider', async () => {
    const p = new CompositeSecretProvider([primary, fallback]);
    expect(await p.get('A')).toBe('from-primary');
  });

  it('falls through when the earlier provider is empty', async () => {
    const p = new CompositeSecretProvider([primary, fallback]);
    expect(await p.get('B')).toBe('b-value');
  });

  it('returns undefined when no provider has it', async () => {
    const p = new CompositeSecretProvider([primary, fallback]);
    expect(await p.get('C')).toBeUndefined();
  });

  it('reports a composite label listing its members', () => {
    expect(new CompositeSecretProvider([primary, fallback]).label).toBe('composite(primary,fallback)');
  });
});

describe('keyVaultSecretName', () => {
  it('lower-kebabs an env name', () => {
    expect(keyVaultSecretName('GITHUB_CLIENT_SECRET')).toBe('github-client-secret');
  });
});

describe('resolveSecrets', () => {
  it('collects only defined secrets', async () => {
    const p = new EnvSecretProvider({ A: '1', B: '', C: '3' });
    expect(await resolveSecrets(p, ['A', 'B', 'C', 'D'])).toEqual({ A: '1', C: '3' });
  });
});
