import { describe, expect, it } from 'vitest';
import { BeginningDbClientResolver } from '../../src/beginningdb/clientRegistry';

describe('BeginningDbClientResolver', () => {
  it('resolves bgdbfs URIs into BeginningDB clients and namespaced paths', async () => {
    const resolver = new BeginningDbClientResolver({
      resolveProfile: async () => ({
        id: 'workspace-1',
        label: 'Workspace 1',
        mode: 'beginningdb.direct',
        baseUrl: 'http://127.0.0.1:8080',
        tenantId: 7,
        filesystemId: 'fs-1',
        pathPrefix: '/.bgdb-vfs/filesystems/fs-1',
        auth: {
          kind: 'bearer',
          token: 'secret-token'
        }
      })
    } as any);
    const resolved = await resolver.resolve({
      scheme: 'bgdbfs',
      authority: 'workspace-1',
      path: '/docs/a.txt'
    });

    expect(resolved.remotePath).toBe('/.bgdb-vfs/filesystems/fs-1/docs/a.txt');
    expect(resolved.client).toBeDefined();
  });

  it('rejects unknown workspaces', async () => {
    const resolver = new BeginningDbClientResolver({
      async resolveProfile() {
        throw new Error('unknown BeginningDB workspace: missing');
      }
    } as any);

    await expect(
      resolver.resolve({ scheme: 'bgdbfs', authority: 'missing', path: '/docs/a.txt' })
    ).rejects.toThrow(/unknown BeginningDB workspace/);
  });

  it('resolves gateway profiles to logical remote paths instead of BeginningDB internal paths', async () => {
    const resolver = new BeginningDbClientResolver({
      resolveProfile: async () => ({
        id: 'team-a',
        label: 'Team A',
        mode: 'beginningdb.gateway',
        gatewayUrl: 'http://127.0.0.1:8787',
        workspaceId: 'fs-1',
        filesystemId: 'fs-1',
        pathPrefix: '/',
        auth: {
          kind: 'delegated-vfs',
          token: 'delegated-token'
        }
      })
    } as any);

    const resolved = await resolver.resolve({
      scheme: 'bgdbfs',
      authority: 'team-a',
      path: '/docs/a.txt'
    });

    expect(resolved.remotePath).toBe('/docs/a.txt');
    expect(resolved.client).toBeDefined();
  });

  it('passes the canonical workspace selector to gateway clients', async () => {
    const resolver = new BeginningDbClientResolver({
      resolveProfile: async () => ({
        id: 'fs-docs',
        label: 'Docs',
        mode: 'beginningdb.gateway',
        gatewayUrl: 'http://127.0.0.1:8787',
        workspaceId: 'fs-docs',
        filesystemId: 'fs-docs',
        pathPrefix: '/',
        auth: {
          kind: 'delegated-vfs',
          token: 'delegated-token'
        }
      })
    } as any);

    const resolved = await resolver.resolve({
      scheme: 'bgdbfs',
      authority: 'fs-docs',
      path: '/docs/a.txt'
    });

    expect((resolved.client as any).options.workspaceId).toBe('fs-docs');
    expect((resolved.client as any).options.filesystemId).toBe('fs-docs');
  });
});
