import { validateVfsBackendProfile, type VfsBackendProfile } from '../backend/backendProfile';
import {
  type ConnectProfileInput,
  type CredentialProvider,
  validateResolvedProfile
} from './credentialProvider';
import { ControlPlaneError, type ControlPlaneResolvedProfile } from './types';

export interface HttpCredentialProviderOptions {
  endpoint: string;
  secret?: string;
  fetch?: typeof fetch;
}

export class HttpCredentialProvider implements CredentialProvider {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpCredentialProviderOptions) {
    this.endpoint = options.endpoint.endsWith('/') ? options.endpoint : `${options.endpoint}/`;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async listProfiles(): Promise<VfsBackendProfile[]> {
    const json = await this.requestJson('/fs/credentials', 'profile-resolution-failed', {
      method: 'GET'
    });
    const record = asRecord(json);
    if (!Array.isArray(record.profiles)) {
      throw malformed('HTTP credential provider returned a malformed profile list');
    }
    return record.profiles.map(profile => validateVfsBackendProfile(profile));
  }

  async resolveProfile(id: string): Promise<ControlPlaneResolvedProfile> {
    const json = await this.requestJson(`/fs/credentials/${encodeURIComponent(id)}`, 'profile-resolution-failed', {
      method: 'GET'
    });
    return validateResolvedProfile(json);
  }

  async refreshAuth(id: string): Promise<ControlPlaneResolvedProfile> {
    const json = await this.requestJson(`/fs/credentials/${encodeURIComponent(id)}/refresh`, 'auth-refresh-failed', {
      method: 'POST'
    });
    return validateResolvedProfile(json);
  }

  async connectDirect(input: ConnectProfileInput): Promise<VfsBackendProfile> {
    const json = await this.requestJson('/fs/credentials/direct', 'profile-resolution-failed', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    return validateVfsBackendProfile(json);
  }

  async signOut(id: string): Promise<void> {
    await this.requestJson(`/fs/credentials/${encodeURIComponent(id)}`, 'auth-refresh-failed', {
      method: 'DELETE'
    });
  }

  private async requestJson(
    route: string,
    kind: 'profile-resolution-failed' | 'auth-refresh-failed',
    init: RequestInit
  ): Promise<unknown> {
    const response = await this.fetchImpl(new URL(route.replace(/^\//, ''), this.endpoint), {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(this.options.secret ? { authorization: `Bearer ${this.options.secret}` } : {}),
        ...init.headers
      }
    });

    if (!response.ok) {
      throw new ControlPlaneError({
        kind,
        message: await response.text().then(text => text || `HTTP credential request failed with ${response.status}`),
        output: String(response.status)
      });
    }
    if (response.status === 204) {
      return undefined;
    }
    return response.json().catch(() => {
      throw malformed('HTTP credential provider returned malformed JSON');
    });
  }
}

function malformed(message: string): ControlPlaneError {
  return new ControlPlaneError({
    kind: 'malformed-response',
    message
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
