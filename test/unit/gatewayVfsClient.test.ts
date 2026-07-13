import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayVfsClient } from '../../src/gateway/gatewayVfsClient';
import { BeginningDbError } from '../../src/beginningdb/errors';

function gatewayCapabilitiesResponse(legacyPaths = false): Response {
  return new Response(JSON.stringify({
    version: 1,
    contractVersion: 1,
    features: {
      storage: true,
      binaryWrite: true,
      rename: true,
      changes: true,
      search: true
    },
    compatibility: {
      legacyPaths: { enabled: legacyPaths, deprecated: true, sunsetAfter: null }
    }
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('GatewayVfsClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps read operations to the gateway-worker /v1/storage contract with bearer auth only', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ path: '/docs/a.txt', kind: 'file', size: 5 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ name: 'a.txt', path: '/docs/a.txt', kind: 'file' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(gatewayCapabilitiesResponse(false))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: 'hello' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetch);

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(client.stat('/docs/a.txt')).resolves.toMatchObject({
      path: '/docs/a.txt',
      kind: 'file',
      size: 5
    });
    await expect(client.readDirectory('/docs')).resolves.toEqual([
      expect.objectContaining({ name: 'a.txt', path: '/docs/a.txt', kind: 'file' })
    ]);
    await expect(client.readFile('/docs/a.txt')).resolves.toEqual(new TextEncoder().encode('hello'));

    const firstCall = fetch.mock.calls[0]!;
    expect(String(firstCall[0])).toBe('https://gateway.example.com/v1/storage/stat');
    expect(JSON.parse(String(firstCall[1]?.body))).toEqual({
      workspaceId: 'fs-1',
      filesystemId: 'fs-1',
      path: '/docs/a.txt'
    });
    expect((firstCall[1]?.headers as Record<string, string>)['authorization']).toBe('Bearer delegated-token');
    expect((firstCall[1]?.headers as Record<string, string>)['x-tenant-id']).toBeUndefined();
  });

  it('accepts gateway-worker list responses that wrap entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          entries: [{ name: 'a.txt', path: '/docs/a.txt', kind: 'file' }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    );

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(client.readDirectory('/docs')).resolves.toEqual([
      expect.objectContaining({ name: 'a.txt', path: '/docs/a.txt', kind: 'file' })
    ]);
  });

  it('synthesizes child paths when directory entries only include names', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          entries: [{ name: 'a.txt', kind: 'file' }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    );

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(client.readDirectory('/docs')).resolves.toEqual([
      expect.objectContaining({ name: 'a.txt', path: '/docs/a.txt', kind: 'file' })
    ]);
  });

  it('falls back to bounded legacy routes when the gateway-worker route is unavailable', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'missing' }), { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          version: 1,
          features: {
            binaryWrite: true,
            rename: true,
            changes: true,
            search: true
          }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: 'legacy-ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetch);

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(client.readFile('/docs/a.txt')).resolves.toEqual(new TextEncoder().encode('legacy-ok'));
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://gateway.example.com/v1/capabilities');
    expect(String(fetch.mock.calls[1]?.[0])).toBe('https://gateway.example.com/v1/features');
    expect(String(fetch.mock.calls[2]?.[0])).toBe('https://gateway.example.com/v1/paths/cat');
  });

  it('decodes base64 content when the gateway marks a binary response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(gatewayCapabilitiesResponse(false))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ content: Buffer.from([0, 255, 10]).toString('base64'), contentEncoding: 'base64' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
    );

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(client.readFile('/bin/data.bin')).resolves.toEqual(new Uint8Array([0, 255, 10]));
  });

  it('prefers the legacy base64 read route when the gateway-worker compatibility shim is available', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          version: 1,
          contractVersion: 1,
          features: {
            storage: true,
            binaryWrite: true,
            rename: true,
            changes: true,
            search: true
          },
          compatibility: {
            legacyPaths: { enabled: true, deprecated: true, sunsetAfter: null }
          }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          content: Buffer.from([0, 255, 10]).toString('base64'),
          contentEncoding: 'base64'
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetch);

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(client.readFile('/bin/data.bin')).resolves.toEqual(new Uint8Array([0, 255, 10]));
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://gateway.example.com/v1/capabilities');
    expect(String(fetch.mock.calls[1]?.[0])).toBe('https://gateway.example.com/v1/paths/cat');
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      workspaceId: 'fs-1',
      filesystemId: 'fs-1',
      path: '/bin/data.bin'
    });
  });

  it('writes binary content through the gateway when binary-write capability is advertised', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          version: 1,
          contractVersion: 1,
          features: {
            storage: true,
            binaryWrite: true,
            rename: true,
            changes: false,
            search: false
          }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetch);

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(client.writeFile('/bin/data.bin', new Uint8Array([0, 255, 10]), {
      create: true,
      overwrite: true
    })).resolves.toBeUndefined();

    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://gateway.example.com/v1/capabilities');
    expect(String(fetch.mock.calls[1]?.[0])).toBe('https://gateway.example.com/v1/storage/write');
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      workspaceId: 'fs-1',
      filesystemId: 'fs-1',
      path: '/bin/data.bin',
      content: Buffer.from([0, 255, 10]).toString('base64'),
      contentEncoding: 'base64'
    });
  });

  it('rejects binary writes when the gateway capability is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          version: 1,
          contractVersion: 1,
          features: {
            storage: true,
            binaryWrite: false,
            rename: true,
            changes: false,
            search: false
          }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    );

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(
      client.writeFile('/bin/data.bin', new Uint8Array([0, 255, 10]), {
        create: true,
        overwrite: true
      })
    ).rejects.toBeInstanceOf(BeginningDbError);
  });

  it('renames through the gateway when rename capability is advertised', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          version: 1,
          contractVersion: 1,
          features: {
            storage: true,
            binaryWrite: true,
            rename: true,
            changes: false,
            search: false
          }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetch);

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(
      client.rename('/docs/a.txt', '/docs/b.txt', { overwrite: false })
    ).resolves.toBeUndefined();

    expect(String(fetch.mock.calls[1]?.[0])).toBe('https://gateway.example.com/v1/storage/rename');
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      workspaceId: 'fs-1',
      filesystemId: 'fs-1',
      fromPath: '/docs/a.txt',
      toPath: '/docs/b.txt'
    });
  });

  it('treats rename as unsupported when the gateway capability is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          version: 1,
          contractVersion: 1,
          features: {
            storage: true,
            binaryWrite: true,
            rename: false,
            changes: false,
            search: false
          }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    );

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(
      client.rename('/docs/a.txt', '/docs/b.txt', { overwrite: false })
    ).rejects.toBeInstanceOf(BeginningDbError);
  });

  it('requests logical path changes through the gateway when the capability is advertised', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          version: 1,
          contractVersion: 1,
          features: {
            storage: true,
            binaryWrite: true,
            rename: true,
            changes: true,
            search: true
          }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          cursor: 4,
          changes: [
            {
              seq: 3,
              path: '/.bgdb-vfs/filesystems/fs-1/docs/a.txt',
              kind: 'file',
              type: 'changed'
            }
          ]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetch);

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(client.listChanges?.('/docs', 2)).resolves.toEqual({
      cursor: 4,
      changes: [
        {
          seq: 3,
          path: '/docs/a.txt',
          kind: 'file',
          type: 'changed'
        }
      ]
    });

    expect(String(fetch.mock.calls[1]?.[0])).toBe('https://gateway.example.com/v1/changes/list');
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      workspaceId: 'fs-1',
      filesystemId: 'fs-1',
      pathPrefix: '/docs',
      cursor: 2
    });
  });

  it('searches through the gateway when the capability is advertised', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          version: 1,
          contractVersion: 1,
          features: {
            storage: true,
            binaryWrite: true,
            rename: true,
            changes: true,
            search: true
          }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          results: [
            '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt',
            '/docs/guide.txt'
          ]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetch);

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(client.search('hello', '/docs')).resolves.toEqual([
      '/docs/readme.txt',
      '/docs/guide.txt'
    ]);

    expect(String(fetch.mock.calls[1]?.[0])).toBe('https://gateway.example.com/v1/search/query');
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      workspaceId: 'fs-1',
      filesystemId: 'fs-1',
      pathPrefix: '/docs',
      query: 'hello',
    });
  });

  it('requests and normalizes structured search results through the gateway', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(gatewayCapabilitiesResponse(false))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          results: [
            {
              path: '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt',
              kind: 'file',
              inode_id: 42,
              resource: 'file:7:42',
              placements: [
                '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt',
                '/.bgdb-vfs/filesystems/fs-1/docs/alias.txt'
              ],
              mode: 'hybrid',
              score: 0.25,
              score_kind: 'rrf',
              score_breakdown: { keyword: { rrf_score: 0.1 } },
              snippet: {
                text: 'hello needle',
                match_ranges: [{ start: 6, end: 12 }]
              }
            }
          ],
          index_freshness: {
            ready: true,
            pending_wal_entries: 0,
            indexed_docs: 2
          }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetch);

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(client.searchFiles?.('needle', '/docs', {
      mode: 'hybrid',
      resultShape: 'files',
      limit: 10,
      offset: 0,
      includeSnippets: true
    })).resolves.toEqual({
      results: [
        {
          path: '/docs/readme.txt',
          kind: 'file',
          inodeId: 42,
          resource: 'file:7:42',
          placements: ['/docs/readme.txt', '/docs/alias.txt'],
          mode: 'hybrid',
          score: 0.25,
          scoreKind: 'rrf',
          scoreBreakdown: { keyword: { rrf_score: 0.1 } },
          snippet: {
            text: 'hello needle',
            matchRanges: [{ start: 6, end: 12 }]
          }
        }
      ],
      indexFreshness: {
        ready: true,
        pendingWalEntries: 0,
        indexedDocs: 2
      }
    });

    expect(String(fetch.mock.calls[1]?.[0])).toBe('https://gateway.example.com/v1/search/query');
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      workspaceId: 'fs-1',
      filesystemId: 'fs-1',
      pathPrefix: '/docs',
      query: 'needle',
      mode: 'hybrid',
      resultShape: 'files',
      limit: 10,
      offset: 0,
      includeSnippets: true
    });
  });

  it('returns empty structured search results when search is not advertised', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          version: 1,
          contractVersion: 1,
          features: {
            storage: true,
            binaryWrite: true,
            rename: true,
            changes: true,
            search: false
          }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetch);

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(client.searchFiles?.('needle', '/docs')).resolves.toEqual({ results: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('normalizes legacy path-array responses for structured gateway search', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(gatewayCapabilitiesResponse(false))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          results: [
            '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt',
            '/docs/guide.txt'
          ]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetch);

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(client.searchFiles?.('needle', '/docs')).resolves.toEqual({
      results: [{ path: '/docs/readme.txt' }, { path: '/docs/guide.txt' }]
    });
  });

  it('rejects divergent workspace and filesystem selectors before sending gateway requests', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      workspaceId: 'fs-docs',
      filesystemId: 'fs-code',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });

    await expect(client.stat('/docs/a.txt')).rejects.toThrow(/workspaceId and filesystemId must match/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retries once on 401 with refreshed delegated auth when refresh is available', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(gatewayCapabilitiesResponse(false))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'expired' }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: 'hello' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetch);

    const getDelegatedAuth = vi
      .fn()
      .mockResolvedValueOnce({ token: 'stale-token', canRefresh: true })
      .mockResolvedValueOnce({ token: 'fresh-token', canRefresh: true });
    const refreshDelegatedAuth = vi
      .fn()
      .mockResolvedValue({ token: 'fresh-token', canRefresh: true });

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth,
      refreshDelegatedAuth
    });

    await expect(client.readFile('/docs/a.txt')).resolves.toEqual(new TextEncoder().encode('hello'));
    expect(refreshDelegatedAuth).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[1]?.[1]?.headers as Record<string, string>)['authorization']).toBe('Bearer stale-token');
    expect((fetch.mock.calls[2]?.[1]?.headers as Record<string, string>)['authorization']).toBe('Bearer fresh-token');
  });

  it('does not retry 401s when refresh is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'expired' }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })
      )
    );

    const refreshDelegatedAuth = vi.fn();
    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'stale-token', canRefresh: false }),
      refreshDelegatedAuth
    });

    await expect(client.readFile('/docs/a.txt')).rejects.toBeInstanceOf(BeginningDbError);
    expect(refreshDelegatedAuth).not.toHaveBeenCalled();
  });
});
