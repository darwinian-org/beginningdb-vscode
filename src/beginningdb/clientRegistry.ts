import type * as vscode from 'vscode';
import { GatewayVfsClient } from '../gateway/gatewayVfsClient';
import { ProfileProvider } from '../controlPlane/profileProvider';
import type { VfsBackendClientResolution } from '../backend/vfsBackendClient';
import { isGatewayProfile } from '../backend/backendProfile';
import { parseBgdbUri, normalizeLogicalPath, toBeginningDbPath } from '../filesystem/uri';
import { HttpBeginningDbClient } from './client';

type ResolvableUri = Pick<vscode.Uri, 'scheme' | 'authority' | 'path'>;

export class BeginningDbClientResolver {
  constructor(private readonly profiles: Pick<ProfileProvider, 'resolveProfile' | 'refreshAuth'>) {}

  async resolve(uri: ResolvableUri): Promise<VfsBackendClientResolution> {
    const resource = parseBgdbUri(`${uri.scheme}://${uri.authority}${uri.path || '/'}`);
    const profile = await this.profiles.resolveProfile(resource.workspaceId);
    const client =
      !isGatewayProfile(profile)
        ? new HttpBeginningDbClient({
            baseUrl: profile.baseUrl,
            tenantId: profile.tenantId,
            ...(profile.auth.kind === 'bearer' && profile.auth.token
              ? { token: profile.auth.token }
              : {})
          })
        : new GatewayVfsClient({
            gatewayUrl: profile.gatewayUrl,
            ...(profile.workspaceId ? { workspaceId: profile.workspaceId } : {}),
            filesystemId: profile.filesystemId,
            getDelegatedAuth: async () => {
              const currentProfile = await this.profiles.resolveProfile(resource.workspaceId);
              if (!isGatewayProfile(currentProfile) || currentProfile.auth.kind !== 'delegated-vfs') {
                throw new Error(`workspace ${resource.workspaceId} no longer resolves to gateway auth`);
              }
              return {
                token: currentProfile.auth.token,
                canRefresh: currentProfile.auth.canRefresh === true
              };
            },
            refreshDelegatedAuth: async () => {
              const refreshedProfile = await this.profiles.refreshAuth(resource.workspaceId);
              if (!isGatewayProfile(refreshedProfile) || refreshedProfile.auth.kind !== 'delegated-vfs') {
                throw new Error(`workspace ${resource.workspaceId} no longer resolves to gateway auth`);
              }
              return {
                token: refreshedProfile.auth.token,
                canRefresh: refreshedProfile.auth.canRefresh === true
              };
            }
          });

    return {
      client,
      remotePath:
        !isGatewayProfile(profile)
          ? toBeginningDbPath(profile, resource.logicalPath)
          : normalizeLogicalPath(resource.logicalPath),
      ...(isGatewayProfile(profile) && profile.auth.kind === 'delegated-vfs'
        ? {
            auth: {
              kind: 'delegated-vfs' as const,
              canRefresh: profile.auth.canRefresh === true,
              ...(profile.auth.strategy ? { strategy: profile.auth.strategy } : {})
            }
          }
        : {})
    };
  }
}
