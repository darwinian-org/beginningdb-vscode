import { describe, expect, it, vi } from 'vitest';
import {
  HostBridgeCredentialProvider,
  isMindspaceHostApi,
  type HostBridgeExtensionRegistry,
  type MindspaceHostApi
} from '../../src/controlPlane/hostBridgeCredentialProvider';
import { ControlPlaneError } from '../../src/controlPlane/types';

describe('HostBridgeCredentialProvider', () => {
  it('resolves a profile through mindspace-host.getCredential', async () => {
    const host = {
      getCredential: vi.fn().mockResolvedValue(gatewayProfile('delegated-token'))
    };
    const provider = new HostBridgeCredentialProvider({ extensions: registry(host) });

    await expect(provider.resolveProfile('team-a')).resolves.toMatchObject({
      id: 'team-a',
      mode: 'beginningdb.gateway',
      auth: {
        kind: 'delegated-vfs',
        token: 'delegated-token'
      }
    });
    expect(host.getCredential).toHaveBeenCalledWith('team-a');
  });

  it('refreshes auth through the same host bridge credential API', async () => {
    const host = {
      getCredential: vi.fn().mockResolvedValue(gatewayProfile('fresh-token'))
    };
    const provider = new HostBridgeCredentialProvider({ extensions: registry(host) });

    await expect(provider.refreshAuth('team-a')).resolves.toMatchObject({
      auth: { token: 'fresh-token' }
    });
    expect(host.getCredential).toHaveBeenCalledWith('team-a');
  });

  it.each([
    ['bridge unavailable', 'CREDENTIAL_UNAVAILABLE'],
    ['timeout', 'CREDENTIAL_TIMEOUT'],
    ['unopened workspace', 'WORKSPACE_NOT_OPEN'],
    ['invalid id', 'INVALID_WORKSPACE_ID']
  ])('surfaces %s as an actionable control-plane error', async (_label, code) => {
    const host = {
      getCredential: vi.fn().mockRejectedValue(Object.assign(new Error('host failed'), { code }))
    };
    const provider = new HostBridgeCredentialProvider({ extensions: registry(host) });

    await expect(provider.resolveProfile('team-a')).rejects.toMatchObject({
      details: {
        kind: 'profile-resolution-failed',
        output: code,
        message: expect.stringContaining(code)
      }
    });
  });

  it('reports the host bridge as unavailable when the host extension is missing', async () => {
    const provider = new HostBridgeCredentialProvider({
      extensions: { getExtension: vi.fn().mockReturnValue(undefined) }
    });

    await expect(provider.resolveProfile('team-a')).rejects.toMatchObject({
      details: { kind: 'control-plane-unavailable' }
    });
  });

  it('activates the host extension when exports are not already populated', async () => {
    const host = {
      getCredential: vi.fn().mockResolvedValue(gatewayProfile('delegated-token'))
    };
    const activate = vi.fn().mockResolvedValue(host);
    const provider = new HostBridgeCredentialProvider({
      extensions: {
        getExtension: vi.fn().mockReturnValue({ activate })
      }
    });

    await expect(provider.resolveProfile('team-a')).resolves.toMatchObject({
      auth: { token: 'delegated-token' }
    });
    expect(activate).toHaveBeenCalled();
  });

  it('normalizes gateway-token responses through the shared validator', async () => {
    const provider = new HostBridgeCredentialProvider({
      extensions: registry(gatewayProfile('manual-token', { kind: 'gateway-token' }))
    });

    await expect(provider.resolveProfile('team-a')).resolves.toMatchObject({
      auth: {
        kind: 'delegated-vfs',
        token: 'manual-token',
        canRefresh: false,
        strategy: 'manual-token'
      }
    });
  });

  it('rejects malformed host responses as malformed control-plane responses', async () => {
    const provider = new HostBridgeCredentialProvider({
      extensions: registry({ id: 'team-a', auth: { token: 'missing-kind' } })
    });

    await expect(provider.resolveProfile('team-a')).rejects.toBeInstanceOf(ControlPlaneError);
    await expect(provider.resolveProfile('team-a')).rejects.toMatchObject({
      details: { kind: 'malformed-response' }
    });
  });

  it('does not support direct profile management through the host bridge', async () => {
    const provider = new HostBridgeCredentialProvider({ extensions: registry(gatewayProfile('delegated-token')) });

    await expect(
      provider.connectDirect({
        id: 'local',
        label: 'Local',
        baseUrl: 'http://127.0.0.1:8080',
        tenantId: 1,
        filesystemId: 'fs-1'
      })
    ).rejects.toMatchObject({
      details: { kind: 'control-plane-unavailable' }
    });
    await expect(provider.listProfiles()).resolves.toEqual([]);
    await expect(provider.signOut('team-a')).resolves.toBeUndefined();
  });

  it('detects only host APIs with getCredential', () => {
    expect(isMindspaceHostApi({ getCredential: vi.fn() })).toBe(true);
    expect(isMindspaceHostApi({})).toBe(false);
  });
});

function registry(hostOrProfile: MindspaceHostApi | Record<string, unknown>): HostBridgeExtensionRegistry {
  const host = isMindspaceHostApi(hostOrProfile)
    ? hostOrProfile
    : { getCredential: vi.fn().mockResolvedValue(hostOrProfile) };
  return {
    getExtension: vi.fn().mockReturnValue({
      exports: host,
      activate: vi.fn()
    })
  };
}

function gatewayProfile(token: string, authOverride: Record<string, unknown> = {}) {
  return {
    id: 'team-a',
    label: 'Team A',
    mode: 'beginningdb.gateway',
    gatewayUrl: 'https://gateway.example.com',
    filesystemId: 'fs-1',
    pathPrefix: '/',
    auth: {
      kind: 'delegated-vfs',
      token,
      canRefresh: true,
      ...authOverride
    }
  };
}
