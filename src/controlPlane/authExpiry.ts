import type { ControlPlaneResolvedAuth } from './types';

const REFRESH_WINDOW_MS = 60_000;

export function shouldProactivelyRefreshGatewayAuth(
  auth: ControlPlaneResolvedAuth,
  now = new Date()
): boolean {
  if (auth.kind !== 'delegated-vfs' || auth.canRefresh !== true) {
    return false;
  }
  const expiresAt = parseExpiry(auth.expiresAt);
  if (!expiresAt) {
    return false;
  }
  return expiresAt.getTime() <= now.getTime() + REFRESH_WINDOW_MS;
}

function parseExpiry(value: string | undefined): Date | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
