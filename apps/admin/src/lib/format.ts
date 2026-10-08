/** Small formatting helpers shared across admin pages - no date library in this app's deps. */

/** Renders an ISO timestamp as a short "Xs/Xm/Xh/Xd ago" string, or '-' for null. */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '-';
  const deltaMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(deltaMs)) return '-';
  if (deltaMs < 0) return 'just now';

  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Renders an ISO timestamp as a locale date-time string, or '-' for null. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}
