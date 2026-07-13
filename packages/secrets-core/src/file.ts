/**
 * File-mounted secret provider — Docker secrets and Kubernetes secrets (PN-4).
 *
 * Both Docker Swarm and Kubernetes expose secrets as files: Docker mounts them
 * under `/run/secrets/<name>` and Kubernetes mounts a secret volume to a
 * directory of one file per key. A single directory-backed reader covers both.
 *
 * Lookup tries, in order: the exact canonical name (`SESSION_SECRET`), the
 * lower-kebab form (`session-secret`), and the lower-snake form
 * (`session_secret`) — so the same app works whether the operator named the
 * secret file to match the env var or followed the vault-style kebab convention.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SecretProvider } from './provider';
import { keyVaultSecretName } from './provider';

/** Default mount point for Docker secrets; Kubernetes volumes are configurable. */
export const DEFAULT_SECRETS_DIR = '/run/secrets';

export class FileSecretProvider implements SecretProvider {
  readonly label: string;
  constructor(private readonly dir: string = DEFAULT_SECRETS_DIR) {
    this.label = `file(${dir})`;
  }

  private candidates(name: string): string[] {
    const kebab = keyVaultSecretName(name);
    const snake = name.toLowerCase();
    // De-duplicate while preserving order (name may already be lower-case).
    return [...new Set([name, kebab, snake])];
  }

  async get(name: string): Promise<string | undefined> {
    for (const candidate of this.candidates(name)) {
      try {
        const raw = await readFile(join(this.dir, candidate), 'utf8');
        // Secret files conventionally carry a trailing newline; strip one.
        return raw.replace(/\r?\n$/, '');
      } catch {
        // Missing file → try the next naming form.
      }
    }
    return undefined;
  }
}
