import { describe, expect, it } from 'vitest';
import {
  directProfilePathPrefix,
  validateVfsBackendProfile
} from '../../src/backend/backendProfile';

describe('backend profiles', () => {
  it('accepts direct BeginningDB profiles with tenant and server metadata', () => {
    expect(
      validateVfsBackendProfile({
        id: 'local',
        label: 'Local',
        mode: 'beginningdb.direct',
        baseUrl: 'http://127.0.0.1:8080',
        tenantId: 1,
        filesystemId: 'fs-1',
        pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
      })
    ).toMatchObject({
      mode: 'beginningdb.direct',
      tenantId: 1,
      workspaceId: 'fs-1',
      filesystemId: 'fs-1'
    });
  });

  it('accepts workspaceId as the canonical selector and derives filesystemId', () => {
    expect(
      validateVfsBackendProfile({
        id: 'fs-docs',
        label: 'Docs',
        mode: 'beginningdb.gateway',
        gatewayUrl: 'https://gateway.example.com',
        workspaceId: 'fs_docs'
      })
    ).toMatchObject({
      id: 'fs-docs',
      mode: 'beginningdb.gateway',
      workspaceId: 'fs_docs',
      filesystemId: 'fs_docs',
      pathPrefix: '/'
    });
  });

  it('rejects mismatched workspace and filesystem selectors', () => {
    expect(() =>
      validateVfsBackendProfile({
        id: 'bad',
        label: 'Bad',
        mode: 'beginningdb.gateway',
        gatewayUrl: 'https://gateway.example.com',
        workspaceId: 'fs_docs',
        filesystemId: 'fs_code'
      })
    ).toThrow(/workspaceId and filesystemId must match/);
  });

  it('accepts gateway profiles without BeginningDB tenant ids', () => {
    const profile = validateVfsBackendProfile({
      id: 'platform',
      label: 'Platform',
      mode: 'beginningdb.gateway',
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
    });

    expect(profile).toMatchObject({ mode: 'beginningdb.gateway' });
    expect('tenantId' in profile).toBe(false);
  });

  it('normalizes legacy iminds gateway profile mode to BeginningDB gateway mode', () => {
    expect(
      validateVfsBackendProfile({
        id: 'platform',
        label: 'Platform',
        mode: 'iminds.gateway',
        gatewayUrl: 'https://gateway.example.com',
        filesystemId: 'fs-1'
      })
    ).toMatchObject({ mode: 'beginningdb.gateway' });
  });

  it('should normalize legacy CLI-written Darwinian gateway profile mode to BeginningDB gateway mode', () => {
    expect(
      validateVfsBackendProfile({
        id: 'platform',
        label: 'Platform',
        mode: 'darwinian.gateway',
        gatewayUrl: 'https://gateway.example.com',
        filesystemId: 'fs-1'
      })
    ).toMatchObject({ mode: 'beginningdb.gateway' });
  });

  it('rejects credentials in backend URLs', () => {
    expect(() =>
      validateVfsBackendProfile({
        id: 'bad',
        label: 'Bad',
        mode: 'beginningdb.gateway',
        gatewayUrl: 'https://token@example.com?access_token=secret',
        filesystemId: 'fs-1',
        pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
      })
    ).toThrow(/credentials/);
  });

  it('derives direct BeginningDB path prefixes from filesystem ids', () => {
    expect(directProfilePathPrefix('fs-1')).toBe('/.bgdb-vfs/filesystems/fs-1');
  });
});
