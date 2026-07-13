import { describe, expect, it, vi } from 'vitest';
import { ProfileProvider } from '../../src/controlPlane/profileProvider';

describe('ProfileProvider', () => {
  it('migrates legacy extension profiles into the credential provider when the provider is empty', async () => {
    const listProfiles = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
          {
            id: 'local',
            label: 'Local',
            mode: 'beginningdb.direct',
            baseUrl: 'http://127.0.0.1:18080',
            tenantId: 1,
            filesystemId: 'fs-1',
            pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
          }
        ]);
    const connectDirect = vi.fn().mockResolvedValue({
      id: 'local',
      label: 'Local',
      mode: 'beginningdb.direct',
      baseUrl: 'http://127.0.0.1:18080',
      tenantId: 1,
      filesystemId: 'fs-1',
      pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
    });
    const clearServers = vi.fn().mockResolvedValue(undefined);

    const provider = new ProfileProvider(
      {
        listProfiles,
        connectDirect,
        signOut: vi.fn(),
        resolveProfile: vi.fn(),
        refreshAuth: vi.fn()
      } as any,
      {
        listServers: vi.fn().mockResolvedValue([
          {
            id: 'local',
            label: 'Local',
            mode: 'beginningdb.direct',
            baseUrl: 'http://127.0.0.1:18080',
            tenantId: 1,
            filesystemId: 'fs-1',
            pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
          }
        ]),
        getToken: vi.fn().mockResolvedValue('secret-token'),
        clearServers
      } as any,
      { info: vi.fn(), error: vi.fn() }
    );

    const profiles = await provider.listProfiles();

    expect(connectDirect).toHaveBeenCalledWith({
      id: 'local',
      label: 'Local',
      baseUrl: 'http://127.0.0.1:18080',
      tenantId: 1,
      filesystemId: 'fs-1',
      token: 'secret-token'
    });
    expect(clearServers).toHaveBeenCalled();
    expect(profiles).toHaveLength(1);
  });

  it('delegates sign-out to the credential provider', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    const provider = new ProfileProvider(
      {
        listProfiles: vi.fn().mockResolvedValue([{ id: 'local' }]),
        connectDirect: vi.fn(),
        signOut,
        resolveProfile: vi.fn(),
        refreshAuth: vi.fn()
      } as any
    );

    await provider.signOut('local');

    expect(signOut).toHaveBeenCalledWith('local');
  });

  it('uses the credential provider interface for list, resolve, refresh, connect, and sign-out', async () => {
    const credentialProvider = {
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'team-a',
          label: 'Team A',
          mode: 'beginningdb.gateway',
          gatewayUrl: 'https://gateway.example.com',
          filesystemId: 'fs-1',
          pathPrefix: '/'
        }
      ]),
      resolveProfile: vi.fn().mockResolvedValue({
        id: 'team-a',
        label: 'Team A',
        mode: 'beginningdb.gateway',
        gatewayUrl: 'https://gateway.example.com',
        filesystemId: 'fs-1',
        pathPrefix: '/',
        auth: {
          kind: 'delegated-vfs',
          token: 'delegated-token'
        }
      }),
      refreshAuth: vi.fn().mockResolvedValue({
        id: 'team-a',
        label: 'Team A',
        mode: 'beginningdb.gateway',
        gatewayUrl: 'https://gateway.example.com',
        filesystemId: 'fs-1',
        pathPrefix: '/',
        auth: {
          kind: 'delegated-vfs',
          token: 'fresh-token'
        }
      }),
      connectDirect: vi.fn().mockResolvedValue({
        id: 'local',
        label: 'Local',
        mode: 'beginningdb.direct',
        baseUrl: 'http://127.0.0.1:8080',
        tenantId: 1,
        filesystemId: 'fs-1',
        pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
      }),
      signOut: vi.fn().mockResolvedValue(undefined)
    };
    const provider = new ProfileProvider(credentialProvider);

    await expect(provider.listProfiles()).resolves.toHaveLength(1);
    await expect(provider.resolveProfile('team-a')).resolves.toMatchObject({ id: 'team-a' });
    await expect(provider.refreshAuth('team-a')).resolves.toMatchObject({ auth: { token: 'fresh-token' } });
    await expect(
      provider.connectDirect({
        id: 'local',
        label: 'Local',
        baseUrl: 'http://127.0.0.1:8080',
        tenantId: 1,
        filesystemId: 'fs-1'
      })
    ).resolves.toMatchObject({ id: 'local' });
    await provider.signOut('team-a');

    expect(credentialProvider.listProfiles).toHaveBeenCalled();
    expect(credentialProvider.resolveProfile).toHaveBeenCalledWith('team-a');
    expect(credentialProvider.refreshAuth).toHaveBeenCalledWith('team-a');
    expect(credentialProvider.connectDirect).toHaveBeenCalled();
    expect(credentialProvider.signOut).toHaveBeenCalledWith('team-a');
  });

  it('proactively refreshes refreshable gateway auth when it is near expiry', async () => {
    const resolveProfile = vi.fn().mockResolvedValue({
      id: 'team-a',
      label: 'Team A',
      mode: 'beginningdb.gateway',
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      pathPrefix: '/',
      auth: {
        kind: 'delegated-vfs',
        token: 'stale-token',
        expiresAt: '2026-04-24T06:00:30.000Z',
        canRefresh: true,
        strategy: 'dispatch-session'
      }
    });
    const refreshAuth = vi.fn().mockResolvedValue({
      id: 'team-a',
      label: 'Team A',
      mode: 'beginningdb.gateway',
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      pathPrefix: '/',
      auth: {
        kind: 'delegated-vfs',
        token: 'fresh-token',
        expiresAt: '2026-04-24T06:05:00.000Z',
        canRefresh: true,
        strategy: 'dispatch-session'
      }
    });

    const provider = new ProfileProvider(
      {
        listProfiles: vi.fn().mockResolvedValue([{ id: 'team-a' }]),
        connectDirect: vi.fn(),
        signOut: vi.fn(),
        resolveProfile,
        refreshAuth
      } as any
    );

    await expect(provider.resolveProfile('team-a', new Date('2026-04-24T06:00:00.000Z'))).resolves.toEqual(
      expect.objectContaining({
        auth: expect.objectContaining({
          token: 'fresh-token'
        })
      })
    );
    expect(refreshAuth).toHaveBeenCalledWith('team-a');
  });

  it('does not proactively refresh manual gateway auth near expiry', async () => {
    const resolveProfile = vi.fn().mockResolvedValue({
      id: 'team-a',
      label: 'Team A',
      mode: 'beginningdb.gateway',
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      pathPrefix: '/',
      auth: {
        kind: 'delegated-vfs',
        token: 'manual-token',
        expiresAt: '2026-04-24T06:00:30.000Z',
        canRefresh: false,
        strategy: 'manual-token'
      }
    });
    const refreshAuth = vi.fn();

    const provider = new ProfileProvider(
      {
        listProfiles: vi.fn().mockResolvedValue([{ id: 'team-a' }]),
        connectDirect: vi.fn(),
        signOut: vi.fn(),
        resolveProfile,
        refreshAuth
      } as any
    );

    await provider.resolveProfile('team-a', new Date('2026-04-24T06:00:00.000Z'));
    expect(refreshAuth).not.toHaveBeenCalled();
  });
});
