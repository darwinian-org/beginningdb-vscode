import { ServerRegistry } from '../auth/serverRegistry';
import type { VfsBackendProfile } from '../backend/backendProfile';
import { shouldProactivelyRefreshGatewayAuth } from './authExpiry';
import type { ConnectProfileInput, CredentialProvider } from './credentialProvider';
import type { ControlPlaneResolvedProfile } from './types';

export class ProfileProvider {
  private migrated = false;

  constructor(
    private readonly credentials: CredentialProvider,
    private readonly legacyRegistry?: ServerRegistry,
    private readonly logger?: { info(message: string): void; error(message: string): void }
  ) {}

  async listProfiles(): Promise<VfsBackendProfile[]> {
    await this.migrateLegacyProfilesIfNeeded();
    return this.credentials.listProfiles();
  }

  async resolveProfile(id: string, now = new Date()): Promise<ControlPlaneResolvedProfile> {
    await this.migrateLegacyProfilesIfNeeded();
    const profile = await this.credentials.resolveProfile(id);
    if (shouldProactivelyRefreshGatewayAuth(profile.auth, now)) {
      return this.credentials.refreshAuth(id);
    }
    return profile;
  }

  async refreshAuth(id: string): Promise<ControlPlaneResolvedProfile> {
    await this.migrateLegacyProfilesIfNeeded();
    return this.credentials.refreshAuth(id);
  }

  async connectDirect(input: ConnectProfileInput): Promise<VfsBackendProfile> {
    return this.credentials.connectDirect(input);
  }

  async signOut(id: string): Promise<void> {
    await this.migrateLegacyProfilesIfNeeded();
    await this.credentials.signOut(id);
  }

  private async migrateLegacyProfilesIfNeeded(): Promise<void> {
    if (this.migrated || !this.legacyRegistry) {
      return;
    }

    const controlPlaneProfiles = await this.credentials.listProfiles();
    if (controlPlaneProfiles.length > 0) {
      this.migrated = true;
      return;
    }

    const legacyProfiles = await this.legacyRegistry.listServers();
    if (legacyProfiles.length === 0) {
      this.migrated = true;
      return;
    }

    for (const legacy of legacyProfiles) {
      const token = await this.legacyRegistry.getToken(legacy.id);
      await this.credentials.connectDirect({
        id: legacy.id,
        label: legacy.label,
        baseUrl: legacy.baseUrl,
        tenantId: legacy.tenantId,
        filesystemId: legacy.filesystemId,
        ...(token ? { token } : {})
      });
      this.logger?.info(`Migrated legacy BeginningDB profile ${legacy.id} to bgng control plane`);
    }

    await this.legacyRegistry.clearServers();
    this.migrated = true;
  }
}
