import { describe, expect, it } from 'vitest';
import { ServerRegistry } from '../../src/auth/serverRegistry';

describe('ServerRegistry', () => {
  it('stores server metadata outside secret storage and token in secret storage', async () => {
    const context = fakeContext();
    const registry = new ServerRegistry(context);

    await registry.saveServer({
      id: 'local',
      label: 'Local',
      baseUrl: 'http://127.0.0.1:8080',
      tenantId: 1,
      filesystemId: 'fs-1',
      token: 'secret-token'
    });

    expect(await context.secrets.get('beginningdb.server.local.token')).toBe('secret-token');
    expect(JSON.stringify(context.globalState.values)).not.toContain('secret-token');
    expect(await registry.listServers()).toEqual([
      {
        id: 'local',
        label: 'Local',
        mode: 'beginningdb.direct',
        baseUrl: 'http://127.0.0.1:8080',
        tenantId: 1,
        workspaceId: 'fs-1',
        filesystemId: 'fs-1',
        pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
      }
    ]);
  });

  it('deletes tokens on sign out', async () => {
    const context = fakeContext();
    const registry = new ServerRegistry(context);

    await registry.saveServer({
      id: 'local',
      label: 'Local',
      baseUrl: 'http://127.0.0.1:8080',
      tenantId: 1,
      filesystemId: 'fs-1',
      token: 'secret-token'
    });
    await registry.signOut('local');

    expect(await context.secrets.get('beginningdb.server.local.token')).toBeUndefined();
  });

  it('redacts tokens from diagnostics', async () => {
    const context = fakeContext();
    const registry = new ServerRegistry(context);

    await registry.saveServer({
      id: 'local',
      label: 'Local',
      baseUrl: 'http://127.0.0.1:8080',
      tenantId: 1,
      filesystemId: 'fs-1',
      token: 'secret-token'
    });

    expect(await registry.redactedDiagnostics()).toContain('Local');
    expect(await registry.redactedDiagnostics()).not.toContain('secret-token');
  });
});

function fakeContext() {
  const values = new Map<string, unknown>();
  const secrets = new Map<string, string>();

  return {
    globalState: {
      values,
      get<T>(key: string, defaultValue: T): T {
        return (values.get(key) as T | undefined) ?? defaultValue;
      },
      async update(key: string, value: unknown): Promise<void> {
        values.set(key, value);
      }
    },
    secrets: {
      async get(key: string): Promise<string | undefined> {
        return secrets.get(key);
      },
      async store(key: string, value: string): Promise<void> {
        secrets.set(key, value);
      },
      async delete(key: string): Promise<void> {
        secrets.delete(key);
      }
    }
  };
}
