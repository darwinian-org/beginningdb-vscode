import type { VfsBackendProfile } from '../backend/backendProfile';
import {
  type ConnectProfileInput,
  type CredentialProvider,
  validateResolvedProfile
} from './credentialProvider';
import { ControlPlaneError, type ControlPlaneResolvedProfile } from './types';

export interface MindspaceHostApi {
  getCredential(workspaceId: string): Promise<unknown>;
}

export interface HostBridgeExtensionRegistry {
  getExtension(id: string): HostBridgeExtension | undefined;
}

export interface HostBridgeExtension {
  exports?: unknown;
  activate(): PromiseLike<unknown>;
}

export interface HostBridgeCredentialProviderOptions {
  extensions: HostBridgeExtensionRegistry;
  extensionId?: string;
}

const DEFAULT_HOST_EXTENSION_ID = 'mindspace.mindspace-host';

export class HostBridgeCredentialProvider implements CredentialProvider {
  constructor(private readonly options: HostBridgeCredentialProviderOptions) {}

  async listProfiles(): Promise<VfsBackendProfile[]> {
    return [];
  }

  async resolveProfile(id: string): Promise<ControlPlaneResolvedProfile> {
    return this.resolveFromHost(id, 'profile-resolution-failed');
  }

  async refreshAuth(id: string): Promise<ControlPlaneResolvedProfile> {
    return this.resolveFromHost(id, 'auth-refresh-failed');
  }

  async connectDirect(_input: ConnectProfileInput): Promise<VfsBackendProfile> {
    throw new ControlPlaneError({
      kind: 'control-plane-unavailable',
      message: 'MindSpace host bridge does not support direct profile creation'
    });
  }

  signOut(_id: string): Promise<void> {
    return Promise.resolve();
  }

  private async resolveFromHost(
    id: string,
    kind: 'profile-resolution-failed' | 'auth-refresh-failed'
  ): Promise<ControlPlaneResolvedProfile> {
    const host = await this.hostApi(kind);
    let credential: unknown;
    try {
      credential = await host.getCredential(id);
    } catch (error) {
      throw hostBridgeError(kind, error);
    }
    try {
      return validateResolvedProfile(credential);
    } catch (error) {
      if (error instanceof ControlPlaneError) {
        throw error;
      }
      throw new ControlPlaneError({
        kind: 'malformed-response',
        message: error instanceof Error ? error.message : 'host bridge returned a malformed credential profile'
      });
    }
  }

  private async hostApi(kind: 'profile-resolution-failed' | 'auth-refresh-failed'): Promise<MindspaceHostApi> {
    const extensionId = this.options.extensionId ?? DEFAULT_HOST_EXTENSION_ID;
    const extension = this.options.extensions.getExtension(extensionId);
    if (!extension) {
      throw new ControlPlaneError({
        kind: 'control-plane-unavailable',
        message: `MindSpace host extension ${extensionId} is not available`
      });
    }

    const api = extension.exports ?? await extension.activate();
    if (!isMindspaceHostApi(api)) {
      throw new ControlPlaneError({
        kind,
        message: `MindSpace host extension ${extensionId} did not expose getCredential`
      });
    }
    return api;
  }
}

export function isMindspaceHostApi(value: unknown): value is MindspaceHostApi {
  return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).getCredential === 'function';
}

function hostBridgeError(
  kind: 'profile-resolution-failed' | 'auth-refresh-failed',
  error: unknown
): ControlPlaneError {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : 'MindSpace host bridge credential request failed';
  return new ControlPlaneError({
    kind,
    message: code ? `${code}: ${message}` : message,
    ...(code ? { output: code } : {})
  });
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'string' ? code : undefined;
}
