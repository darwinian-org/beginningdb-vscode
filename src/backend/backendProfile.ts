export type VfsBackendMode = 'beginningdb.direct' | 'beginningdb.gateway';
export type LegacyGatewayModeInput = 'iminds.gateway' | 'darwinian.gateway';

export interface BaseVfsBackendProfile {
  id: string;
  label: string;
  mode: VfsBackendMode;
  workspaceId?: string;
  filesystemId: string;
  pathPrefix: string;
}

export interface DirectBeginningDbProfile extends BaseVfsBackendProfile {
  mode: 'beginningdb.direct';
  baseUrl: string;
  tenantId: number;
}

export interface GatewayVfsProfile extends BaseVfsBackendProfile {
  mode: 'beginningdb.gateway';
  gatewayUrl: string;
}

export type VfsBackendProfile = DirectBeginningDbProfile | GatewayVfsProfile;

export function directProfilePathPrefix(filesystemId: string): string {
  return `/.bgdb-vfs/filesystems/${filesystemId}`;
}

export function validateVfsBackendProfile(input: unknown): VfsBackendProfile {
  const value = asRecord(input);
  const mode = requiredString(value.mode, 'mode');
  const selector = resolveWorkspaceSelector(value);
  const base = {
    id: requiredString(value.id, 'id'),
    label: requiredString(value.label, 'label'),
    workspaceId: selector.workspaceId,
    filesystemId: selector.filesystemId,
    pathPrefix: stringValue(value.pathPrefix) ?? directProfilePathPrefix(selector.filesystemId)
  };

  if (mode === 'beginningdb.direct') {
    const baseUrl = requiredSafeUrl(value.baseUrl, 'baseUrl');
    const tenantId = requiredNumber(value.tenantId, 'tenantId');
    return { ...base, mode, baseUrl, tenantId };
  }
  if (isGatewayMode(mode)) {
    const gatewayUrl = requiredSafeUrl(value.gatewayUrl, 'gatewayUrl');
    return { ...base, mode: 'beginningdb.gateway', gatewayUrl, pathPrefix: stringValue(value.pathPrefix) ?? '/' };
  }
  throw new Error(`unsupported backend mode: ${mode}`);
}

function resolveWorkspaceSelector(value: Record<string, unknown>): {
  workspaceId: string;
  filesystemId: string;
} {
  const workspaceId = stringValue(value.workspaceId);
  const filesystemId = stringValue(value.filesystemId);
  const canonical = workspaceId ?? filesystemId;
  if (!canonical) {
    throw new Error('missing string field: workspaceId or filesystemId');
  }
  if (workspaceId && filesystemId && workspaceId !== filesystemId) {
    throw new Error('workspaceId and filesystemId must match');
  }
  return { workspaceId: canonical, filesystemId: canonical };
}

export function isGatewayProfile(profile: VfsBackendProfile): profile is GatewayVfsProfile {
  return profile.mode === 'beginningdb.gateway';
}

export function isGatewayMode(value: string): value is 'beginningdb.gateway' | LegacyGatewayModeInput {
  // Legacy inputs are accepted only for one-way normalization to beginningdb.gateway.
  return value === 'beginningdb.gateway' || value === 'darwinian.gateway' || value === 'iminds.gateway';
}

function requiredSafeUrl(value: unknown, field: string): string {
  const url = new URL(requiredString(value, field));
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${field} must not contain credentials, query tokens, or fragments`);
  }
  return url.toString().replace(/\/$/, '');
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing string field: ${field}`);
  }
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`missing number field: ${field}`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
