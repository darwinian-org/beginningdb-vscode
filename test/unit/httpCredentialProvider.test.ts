import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpCredentialProvider } from '../../src/controlPlane/httpCredentialProvider';

describe('HttpCredentialProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves credentials through the broker/cloud fs credential endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(
      json({
        id: 'team-a',
        label: 'Team A',
        mode: 'beginningdb.gateway',
        gatewayUrl: 'https://gateway.example.com',
        filesystemId: 'fs-1',
        pathPrefix: '/',
        auth: {
          kind: 'delegated-vfs',
          token: 'delegated-token',
          canRefresh: true
        }
      })
    );
    vi.stubGlobal('fetch', fetch);

    const provider = new HttpCredentialProvider({
      endpoint: 'http://127.0.0.1:4567',
      secret: 'loopback-secret'
    });

    await expect(provider.resolveProfile('team-a')).resolves.toMatchObject({
      id: 'team-a',
      auth: {
        kind: 'delegated-vfs',
        token: 'delegated-token'
      }
    });

    expect(String(fetch.mock.calls[0]?.[0])).toBe('http://127.0.0.1:4567/fs/credentials/team-a');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: {
        authorization: 'Bearer loopback-secret'
      }
    });
  });

  it('lists profiles, refreshes, connects, and signs out through the shared HTTP contract', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          profiles: [
            {
              id: 'team-a',
              label: 'Team A',
              mode: 'beginningdb.gateway',
              gatewayUrl: 'https://gateway.example.com',
              filesystemId: 'fs-1',
              pathPrefix: '/'
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        json({
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
        })
      )
      .mockResolvedValueOnce(
        json({
          id: 'local',
          label: 'Local',
          mode: 'beginningdb.direct',
          baseUrl: 'http://127.0.0.1:8080',
          tenantId: 1,
          filesystemId: 'fs-1',
          pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
        })
      )
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal('fetch', fetch);

    const provider = new HttpCredentialProvider({ endpoint: 'https://broker.example.com/api/' });

    await expect(provider.listProfiles()).resolves.toHaveLength(1);
    await expect(provider.refreshAuth('team-a')).resolves.toMatchObject({
      auth: { token: 'fresh-token' }
    });
    await expect(
      provider.connectDirect({
        id: 'local',
        label: 'Local',
        baseUrl: 'http://127.0.0.1:8080',
        tenantId: 1,
        filesystemId: 'fs-1',
        token: 'manual-token'
      })
    ).resolves.toMatchObject({ id: 'local' });
    await expect(provider.signOut('team-a')).resolves.toBeUndefined();

    expect(fetch.mock.calls.map(call => [String(call[0]), call[1]?.method])).toEqual([
      ['https://broker.example.com/api/fs/credentials', 'GET'],
      ['https://broker.example.com/api/fs/credentials/team-a/refresh', 'POST'],
      ['https://broker.example.com/api/fs/credentials/direct', 'POST'],
      ['https://broker.example.com/api/fs/credentials/team-a', 'DELETE']
    ]);
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
