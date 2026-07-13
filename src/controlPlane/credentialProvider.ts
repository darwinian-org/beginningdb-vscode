import { validateVfsBackendProfile, type VfsBackendProfile } from '../backend/backendProfile';
import {
  ControlPlaneError,
  type ControlPlaneResolvedAuth,
  type ControlPlaneResolvedProfile
} from './types';

export interface ConnectProfileInput {
  id: string;
  label: string;
  baseUrl: string;
  tenantId: number;
  filesystemId: string;
  token?: string;
}

export interface CredentialProvider {
  listProfiles(): Promise<VfsBackendProfile[]>;
  resolveProfile(id: string): Promise<ControlPlaneResolvedProfile>;
  refreshAuth(id: string): Promise<ControlPlaneResolvedProfile>;
  connectDirect(input: ConnectProfileInput): Promise<VfsBackendProfile>;
  signOut(id: string): Promise<void>;
}

export function validateResolvedProfile(value: unknown): ControlPlaneResolvedProfile {
  const record = asRecord(value);
  const profile = validateVfsBackendProfile(record);
  const auth = asRecord(record.auth);
  const kind = auth.kind;
  const token = auth.token;
  if (
    (kind !== 'bearer' && kind !== 'delegated-vfs' && kind !== 'gateway-token' && kind !== 'gateway-session') ||
    typeof token !== 'string'
  ) {
    throw new ControlPlaneError({
      kind: 'malformed-response',
      message: 'credential provider returned a malformed resolved profile auth payload'
    });
  }

  const resolvedAuth: ControlPlaneResolvedAuth =
    kind === 'delegated-vfs'
      ? {
          kind,
          token,
          ...(typeof auth.expiresAt === 'string' ? { expiresAt: auth.expiresAt } : {}),
          ...(typeof auth.canRefresh === 'boolean' ? { canRefresh: auth.canRefresh } : {}),
          ...(isDelegatedStrategy(auth.strategy)
            ? { strategy: auth.strategy }
            : {})
        }
      : kind === 'gateway-token' || kind === 'gateway-session'
        ? {
            kind: 'delegated-vfs',
            token,
            ...(typeof auth.expiresAt === 'string' ? { expiresAt: auth.expiresAt } : {}),
            canRefresh: kind === 'gateway-session',
            strategy:
              kind === 'gateway-token'
                ? 'manual-token'
                : auth.sessionKind === 'dispatch-session'
                  ? 'dispatch-session'
                  : 'managed-session'
          }
      : {
          kind,
          token
        };

  return {
    ...profile,
    auth: resolvedAuth
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function isDelegatedStrategy(value: unknown): value is 'manual-token' | 'managed-session' | 'dispatch-session' {
  return value === 'manual-token' || value === 'managed-session' || value === 'dispatch-session';
}
