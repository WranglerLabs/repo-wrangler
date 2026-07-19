export interface GitHubAppManifest {
  name: string;
  url: string;
  redirect_url: string;
  callback_urls: string[];
  public: boolean;
  default_permissions: Record<string, 'read'>;
  hook_attributes?: { url: string; active: boolean };
  default_events?: string[];
}

function originParts(origin: string): { protocol: 'http:' | 'https:'; hostname: string } | null {
  const match = /^(https?):\/\/([^/?#]+)(?:[/?#]|$)/i.exec(origin);
  const protocol = match?.[1]?.toLowerCase();
  const authority = match?.[2];
  if ((protocol !== 'http' && protocol !== 'https') || !authority || authority.includes('@')) return null;
  let hostname: string;
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    if (close < 0 || !/^(?::\d+)?$/.test(authority.slice(close + 1))) return null;
    hostname = authority.slice(1, close);
  } else {
    const hostAndPort = /^([^:]+)(?::\d+)?$/.exec(authority);
    if (!hostAndPort?.[1]) return null;
    hostname = hostAndPort[1];
  }
  return { protocol: `${protocol}:` as 'http:' | 'https:', hostname: hostname.toLowerCase() };
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.endsWith('.local') || !host.includes('.')) return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) return true;
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}

/** GitHub can deliver webhooks only to a publicly reachable HTTPS origin. */
export function supportsGitHubWebhooks(origin: string): boolean {
  const parsed = originParts(origin);
  return parsed?.protocol === 'https:' && !isPrivateHostname(parsed.hostname);
}

/** Entra permits HTTP only for loopback redirect URIs; every other web redirect requires HTTPS. */
export function supportsEntraWebRedirect(origin: string): boolean {
  const parsed = originParts(origin);
  if (!parsed) return false;
  if (parsed.protocol === 'https:') return true;
  return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
}

export function createGitHubAppManifest(origin: string, suffix: string): GitHubAppManifest {
  const manifest: GitHubAppManifest = {
    name: `repo-wrangler-${suffix}`,
    url: 'https://github.com/WranglerLabs/repo-wrangler',
    redirect_url: `${origin}/setup/github-app/callback`,
    callback_urls: [`${origin}/auth/github/callback`],
    public: true,
    default_permissions: {
      metadata: 'read', contents: 'read', actions: 'read', checks: 'read',
      statuses: 'read', pull_requests: 'read', administration: 'read',
      security_events: 'read', vulnerability_alerts: 'read',
      secret_scanning_alerts: 'read', organization_administration: 'read', members: 'read',
    },
  };
  if (supportsGitHubWebhooks(origin)) {
    manifest.hook_attributes = { url: `${origin}/webhooks/github`, active: true };
    manifest.default_events = [
      'repository', 'push', 'create', 'delete', 'pull_request', 'pull_request_review',
      'workflow_run', 'workflow_job', 'check_run', 'check_suite', 'branch_protection_rule',
      'repository_ruleset', 'code_scanning_alert', 'dependabot_alert', 'secret_scanning_alert',
    ];
  }
  return manifest;
}
