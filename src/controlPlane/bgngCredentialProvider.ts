import type { VfsBackendProfile } from '../backend/backendProfile';
import { BgngCli } from './bgngCli';
import type { ConnectProfileInput, CredentialProvider } from './credentialProvider';
import type { ControlPlaneResolvedProfile } from './types';

export class BgngCredentialProvider implements CredentialProvider {
  private verifiedControlPlane = false;

  constructor(private readonly cli: BgngCli) {}

  async listProfiles(): Promise<VfsBackendProfile[]> {
    await this.verifyControlPlane();
    return (await this.cli.listProfiles()).profiles;
  }

  async resolveProfile(id: string): Promise<ControlPlaneResolvedProfile> {
    await this.verifyControlPlane();
    return this.cli.resolveProfile(id);
  }

  async refreshAuth(id: string): Promise<ControlPlaneResolvedProfile> {
    await this.verifyControlPlane();
    return this.cli.refreshAuth(id);
  }

  async connectDirect(input: ConnectProfileInput): Promise<VfsBackendProfile> {
    await this.verifyControlPlane();
    const profile = await this.cli.connectDirect(input);
    if (typeof input.token === 'string' && input.token.length > 0) {
      await this.cli.login(profile.id, input.token);
    }
    return profile;
  }

  async signOut(id: string): Promise<void> {
    await this.verifyControlPlane();
    await this.cli.clearAuth(id);
  }

  private async verifyControlPlane(): Promise<void> {
    if (this.verifiedControlPlane) {
      return;
    }
    await this.cli.doctor();
    this.verifiedControlPlane = true;
  }
}
