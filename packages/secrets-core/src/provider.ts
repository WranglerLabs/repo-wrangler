/**
 * Provider- and runtime-neutral secret access (ADR-017, PN-4).
 *
 * `SecretProvider` is the seam between the application and wherever secrets
 * actually live: environment variables (the default, and how Cloudflare surfaces
 * `wrangler secret put` values), files mounted by Docker/Kubernetes, or an
 * external vault such as Azure Key Vault. Business logic never reaches for
 * `process.env` directly — the host resolves every secret through a provider at
 * boot, so the same code runs unchanged on Cloudflare, a Node host, a container,
 * or a home lab (design "Deploy Anywhere. Own Your Data. Everything Is a
 * Provider.").
 *
 * This module holds only the interface and the dependency-free implementations
 * (env + composite). File and Key Vault adapters live in sibling modules so a
 * runtime that cannot use `node:fs` never has to bundle it.
 */

/** A source of named secrets. Returns `undefined` when the secret is absent. */
export interface SecretProvider {
  /** Human-readable identifier for logs (never includes secret values). */
  readonly label: string;
  /** Resolve one secret by its canonical (environment-variable) name. */
  get(name: string): Promise<string | undefined>;
}

/**
 * A {@link SecretProvider} that can also be written to at runtime (ADR-021,
 * onboarding design "Credential entry"). The boot-resolved providers above
 * (env, file, vault) are read-only by design — infrastructure secrets exist
 * before the process starts. Provider credentials entered through the wizard
 * need a store the app can write to *after* boot, with no restart: that is
 * this interface. `set`/`delete` are on-demand, at the point of use, never
 * hydrated into a boot-time env bag.
 */
export interface WritableSecretProvider extends SecretProvider {
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

/**
 * Reads secrets from a flat string bag — `process.env` on Node, the `Env`
 * bindings object on Cloudflare (where `wrangler secret put` values and vars
 * both appear as properties). This is the default and the zero-dependency path.
 */
export class EnvSecretProvider implements SecretProvider {
  readonly label = 'env';
  constructor(private readonly bag: Record<string, string | undefined>) {}

  get(name: string): Promise<string | undefined> {
    const value = this.bag[name];
    return Promise.resolve(value === '' ? undefined : value);
  }
}

/**
 * Tries each provider in order and returns the first defined value. Use it to
 * layer sources — e.g. a file/vault provider that supplies most secrets with an
 * env provider as the fall-through for local overrides. Earlier providers win.
 */
export class CompositeSecretProvider implements SecretProvider {
  readonly label: string;
  constructor(private readonly providers: SecretProvider[]) {
    this.label = `composite(${providers.map((p) => p.label).join(',')})`;
  }

  async get(name: string): Promise<string | undefined> {
    for (const provider of this.providers) {
      const value = await provider.get(name);
      if (value !== undefined) return value;
    }
    return undefined;
  }
}

/**
 * Map a canonical environment-variable name to an Azure Key Vault secret name.
 * Key Vault names allow only alphanumerics and dashes, so `GITHUB_CLIENT_SECRET`
 * becomes `github-client-secret`. Deterministic and reversible enough for a
 * documented naming convention.
 */
export function keyVaultSecretName(envName: string): string {
  return envName.toLowerCase().replace(/_/g, '-');
}

/**
 * Resolve a set of secret names through a provider into a plain object,
 * omitting any that are absent. This is what a host calls at boot to hydrate the
 * secret slots of its environment before building the app.
 */
export async function resolveSecrets(
  provider: SecretProvider,
  names: readonly string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    names.map(async (name) => {
      const value = await provider.get(name);
      if (value !== undefined) out[name] = value;
    }),
  );
  return out;
}
