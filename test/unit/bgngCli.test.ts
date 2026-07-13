import { describe, expect, it, vi } from 'vitest';
import { BgngCli } from '../../src/controlPlane/bgngCli';

describe('BgngCli', () => {
  it('lists validated CLI profiles from JSON output', async () => {
    const cli = new BgngCli({
      exec: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          profiles: [
            {
              id: 'local',
              label: 'Local',
              mode: 'beginningdb.direct',
              baseUrl: 'http://127.0.0.1:18080',
              tenantId: 1,
              filesystemId: 'fs-1',
              pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
            }
          ]
        }),
        stderr: ''
      })
    });

    await expect(cli.listProfiles()).resolves.toEqual({
      profiles: [
        {
          id: 'local',
          label: 'Local',
          mode: 'beginningdb.direct',
          baseUrl: 'http://127.0.0.1:18080',
          tenantId: 1,
          workspaceId: 'fs-1',
          filesystemId: 'fs-1',
          pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
        }
      ]
    });
  });

  it('resolves JavaScript bgng paths through the current node executable', async () => {
    const exec = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ profiles: [] }),
      stderr: ''
    });
    const cli = new BgngCli({
      executablePath: '/tmp/bgng.js',
      exec
    });

    await cli.listProfiles();

    expect(exec).toHaveBeenCalledWith(
      process.execPath,
      ['/tmp/bgng.js', 'ide', 'profiles', 'list', '--json'],
      expect.any(Object)
    );
  });

  it('throws a control-plane incompatibility error when doctor reports another contract version', async () => {
    const cli = new BgngCli({
      exec: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          runtimeMetadata: {
            cliContractVersion: 2
          }
        }),
        stderr: ''
      })
    });

    await expect(cli.doctor()).rejects.toMatchObject({
      details: {
        kind: 'control-plane-incompatible'
      }
    });
  });

  it('throws a malformed-response error when bgng returns invalid JSON', async () => {
    const cli = new BgngCli({
      exec: vi.fn().mockResolvedValue({
        stdout: 'not-json',
        stderr: ''
      })
    });

    await expect(cli.listProfiles()).rejects.toMatchObject({
      details: {
        kind: 'malformed-response'
      }
    });
  });

  it('throws a control-plane-unavailable error when bgng execution fails', async () => {
    const cli = new BgngCli({
      exec: vi.fn().mockRejectedValue(new Error('spawn ENOENT'))
    });

    await expect(cli.doctor()).rejects.toMatchObject({
      details: {
        kind: 'control-plane-unavailable'
      }
    });
  });

  it('parses richer gateway auth metadata from resolved profiles', async () => {
    const cli = new BgngCli({
      exec: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          id: 'team-a',
          label: 'Team A',
          mode: 'iminds.gateway',
          gatewayUrl: 'https://gateway.example.com',
          filesystemId: 'fs-1',
          pathPrefix: '/',
          auth: {
            kind: 'delegated-vfs',
            token: 'delegated-token',
            expiresAt: '2026-04-24T07:00:00.000Z',
            canRefresh: true,
            strategy: 'dispatch-session'
          }
        }),
        stderr: ''
      })
    });

    await expect(cli.resolveProfile('team-a')).resolves.toEqual({
      id: 'team-a',
      label: 'Team A',
      mode: 'beginningdb.gateway',
      gatewayUrl: 'https://gateway.example.com',
      workspaceId: 'fs-1',
      filesystemId: 'fs-1',
      pathPrefix: '/',
      auth: {
        kind: 'delegated-vfs',
        token: 'delegated-token',
        expiresAt: '2026-04-24T07:00:00.000Z',
        canRefresh: true,
        strategy: 'dispatch-session'
      }
    });
  });

  it('normalizes current bgng gateway-session auth into delegated-vfs auth', async () => {
    const cli = new BgngCli({
      exec: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          id: 'team-refresh',
          label: 'Team Refresh',
          mode: 'iminds.gateway',
          gatewayUrl: 'https://gateway.example.com',
          filesystemId: 'fs-1',
          pathPrefix: '/',
          auth: {
            kind: 'gateway-session',
            token: 'managed-token',
            expiresAt: '2026-04-24T07:00:00.000Z',
            sessionKind: 'managed-session'
          }
        }),
        stderr: ''
      })
    });

    await expect(cli.resolveProfile('team-refresh')).resolves.toEqual({
      id: 'team-refresh',
      label: 'Team Refresh',
      mode: 'beginningdb.gateway',
      gatewayUrl: 'https://gateway.example.com',
      workspaceId: 'fs-1',
      filesystemId: 'fs-1',
      pathPrefix: '/',
      auth: {
        kind: 'delegated-vfs',
        token: 'managed-token',
        expiresAt: '2026-04-24T07:00:00.000Z',
        canRefresh: true,
        strategy: 'managed-session'
      }
    });
  });

  it('accepts current bgng delegated-vfs auth with canonical workspace metadata', async () => {
    const cli = new BgngCli({
      exec: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          id: 'fs-docs',
          label: 'Docs',
          mode: 'beginningdb.gateway',
          gatewayUrl: 'https://gateway.example.com',
          workspaceId: 'fs-docs',
          filesystemId: 'fs-docs',
          pathPrefix: '/',
          auth: {
            kind: 'delegated-vfs',
            token: 'child-token-docs',
            expiresAt: '2026-07-07T13:00:00.000Z',
            canRefresh: false,
            strategy: 'manual-token'
          }
        }),
        stderr: ''
      })
    });

    await expect(cli.resolveProfile('fs-docs')).resolves.toEqual({
      id: 'fs-docs',
      label: 'Docs',
      mode: 'beginningdb.gateway',
      gatewayUrl: 'https://gateway.example.com',
      workspaceId: 'fs-docs',
      filesystemId: 'fs-docs',
      pathPrefix: '/',
      auth: {
        kind: 'delegated-vfs',
        token: 'child-token-docs',
        expiresAt: '2026-07-07T13:00:00.000Z',
        canRefresh: false,
        strategy: 'manual-token'
      }
    });
  });
});
