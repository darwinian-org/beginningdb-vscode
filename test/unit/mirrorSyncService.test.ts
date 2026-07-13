import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeginningDbError } from '../../src/beginningdb/errors';
import { MirrorSyncService } from '../../src/mirror/mirrorSyncService';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'bgdb-sync-service-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('MirrorSyncService', () => {
  it('skips sync when no mirror manifest exists', async () => {
    const service = new MirrorSyncService({
      resolver: {} as never,
      statusBar: fakeStatusBar(),
      syncLog: fakeLog(),
      workspacePath: () => tmp,
      managerFactory: () => ({
        syncLocalChanges: vi.fn(),
        syncRemoteChanges: vi.fn()
      })
    });

    await service.syncNow();
    expect(service.activeProfileId).toBeUndefined();
  });

  it('syncs local and remote changes for active mirrors', async () => {
    await writeFile(
      path.join(tmp, '.beginningdb', 'mirror.json'),
      JSON.stringify({
        rootRemotePath: '/.bgdb-vfs/filesystems/fs-1',
        profileId: 'profile-1',
        files: {}
      }),
      { flag: 'w' }
    ).catch(async () => {
      await import('node:fs/promises').then(fs => fs.mkdir(path.join(tmp, '.beginningdb'), { recursive: true }));
      await writeFile(
        path.join(tmp, '.beginningdb', 'mirror.json'),
        JSON.stringify({
          rootRemotePath: '/.bgdb-vfs/filesystems/fs-1',
          profileId: 'profile-1',
          files: {}
        })
      );
    });
    const syncLocalChanges = vi.fn();
    const syncRemoteChanges = vi.fn();
    const resolve = vi.fn().mockResolvedValue({ client: {}, remotePath: '/' });
    const service = new MirrorSyncService({
      resolver: {
        resolve
      } as never,
      statusBar: fakeStatusBar(),
      syncLog: fakeLog(),
      workspacePath: () => tmp,
      managerFactory: () => ({
        syncLocalChanges,
        syncRemoteChanges
      })
    });

    await service.syncNow();

    expect(service.activeProfileId).toBe('profile-1');
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        scheme: 'bgdbfs',
        authority: 'profile-1',
        path: '/'
      })
    );
    expect(syncLocalChanges).toHaveBeenCalledWith(tmp);
    expect(syncRemoteChanges).toHaveBeenCalledWith(tmp);
  });

  it('shows auth-required state on unauthorized sync failures', async () => {
    await ensureManifest();
    const statusBar = fakeStatusBar();
    const syncLog = fakeLog();
    const service = new MirrorSyncService({
      resolver: {
        resolve: vi.fn().mockResolvedValue({ client: {}, remotePath: '/' })
      } as never,
      statusBar,
      syncLog,
      workspacePath: () => tmp,
      managerFactory: () => ({
        syncLocalChanges: vi.fn(async () => {
          throw new BeginningDbError('unauthorized', 'expired token', 401);
        }),
        syncRemoteChanges: vi.fn()
      })
    });

    await service.syncNow();

    expect(statusBar.setAuthRequired).toHaveBeenCalled();
    expect(statusBar.setOffline).not.toHaveBeenCalled();
    expect(syncLog.error).toHaveBeenCalledWith('expired token');
  });

  it('shows conflict state when remote sync reports conflicts', async () => {
    await ensureManifest();
    const statusBar = fakeStatusBar();
    const service = new MirrorSyncService({
      resolver: {
        resolve: vi.fn().mockResolvedValue({ client: {}, remotePath: '/' })
      } as never,
      statusBar,
      syncLog: fakeLog(),
      workspacePath: () => tmp,
      managerFactory: () => ({
        syncLocalChanges: vi.fn(async () => ({ uploaded: 1, deleted: 0 })),
        syncRemoteChanges: vi.fn(async () => ({
          downloaded: 0,
          deleted: 0,
          conflicts: 2
        }))
      })
    });

    await service.syncNow();

    expect(statusBar.setConflicts).toHaveBeenCalledWith(2);
    expect(statusBar.setSynced).not.toHaveBeenCalled();
  });

  it('shows an actionable auth-required message when manual gateway auth expires during sync', async () => {
    await ensureManifest();
    const statusBar = fakeStatusBar();
    const syncLog = fakeLog();
    const service = new MirrorSyncService({
      resolver: {
        resolve: vi.fn().mockResolvedValue({
          client: {},
          remotePath: '/',
          auth: { kind: 'delegated-vfs', canRefresh: false, strategy: 'manual-token' }
        })
      } as never,
      statusBar,
      syncLog,
      workspacePath: () => tmp,
      managerFactory: () => ({
        syncLocalChanges: vi.fn(async () => {
          throw new BeginningDbError('unauthorized', 'expired delegated token', 401);
        }),
        syncRemoteChanges: vi.fn()
      })
    });

    await service.syncNow();

    expect(statusBar.setAuthRequired).toHaveBeenCalled();
    expect(syncLog.error).toHaveBeenCalledWith(
      expect.stringContaining('expired delegated token')
    );
  });
});

function fakeStatusBar() {
  return {
    setSyncing: vi.fn(),
    setSynced: vi.fn(),
    setOffline: vi.fn(),
    setAuthRequired: vi.fn(),
    setConflicts: vi.fn(),
    setPaused: vi.fn()
  };
}

function fakeLog() {
  return {
    info: vi.fn(),
    error: vi.fn()
  };
}

async function ensureManifest(): Promise<void> {
  await import('node:fs/promises').then(fs =>
    fs.mkdir(path.join(tmp, '.beginningdb'), { recursive: true })
  );
  await writeFile(
    path.join(tmp, '.beginningdb', 'mirror.json'),
    JSON.stringify({
      rootRemotePath: '/.bgdb-vfs/filesystems/fs-1',
      profileId: 'profile-1',
      files: {}
    })
  );
}
