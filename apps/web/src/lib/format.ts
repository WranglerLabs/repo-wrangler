export function timeAgo(iso: string | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export const CAPABILITY_LABELS: Record<string, string> = {
  available: 'Available',
  not_configured: 'Not configured',
  not_authorized: 'Not authorized',
  unsupported_by_provider: 'Unsupported by provider',
  unsupported_by_plan: 'Unsupported by plan',
  temporarily_unavailable: 'Temporarily unavailable',
  rate_limited: 'Rate limited',
  error: 'Error',
};
