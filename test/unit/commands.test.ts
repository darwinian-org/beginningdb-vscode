import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createCommandHandlers,
  type CommandUri,
  type WorkspaceApi
} from '../../src/ui/commandsCore';

describe('command handlers', () => {
  it('adds a direct BeginningDB profile from prompted values', async () => {
    const connectDirect = vi.fn();
    const inputs = ['Local', 'http://127.0.0.1:8080', '1', 'fs-1', 'token'];
    const handlers = createCommandHandlers({
      profiles: {
        connectDirect,
        listProfiles: vi.fn().mockResolvedValue([]),
        signOut: vi.fn()
      } as any,
      resolver: {} as never,
      syncLog: { info: vi.fn(), error: vi.fn(), show: vi.fn() } as any,
      statusBar: {
        setPaused: vi.fn(),
        setSyncing: vi.fn(),
        setSynced: vi.fn(),
        setOffline: vi.fn(),
        setAuthRequired: vi.fn(),
        setConflicts: vi.fn()
      } as any,
      mirrorSync: { syncNow: vi.fn() } as any,
      ui: {
        showInputBox: vi.fn(async () => inputs.shift()),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showQuickPick: vi.fn(),
        showOpenDialog: vi.fn(),
        withProgress: vi.fn(async (_opts, task) => task())
      },
      workspaceApi: {
        isTrusted: true,
        replaceWorkspace: vi.fn(),
        openFolder: vi.fn(),
        currentFolderPath: vi.fn(),
        uriFromParts: createUri,
        fileUri: createFileUri,
        progressLocationNotification: 15
      }
    });

    await handlers.addServer();

    expect(connectDirect).toHaveBeenCalledWith({
      id: 'local',
      label: 'Local',
      baseUrl: 'http://127.0.0.1:8080',
      tenantId: 1,
      filesystemId: 'fs-1',
      token: 'token'
    });
  });

  it('opens a bgdbfs workspace for the chosen server', async () => {
    const replaceWorkspace = vi.fn();
    const openFolder = vi.fn();
    const handlers = createCommandHandlers({
      profiles: {
        listProfiles: vi.fn().mockResolvedValue([
          {
            id: 'local',
            label: 'Local',
            mode: 'beginningdb.direct',
            baseUrl: 'http://127.0.0.1:8080',
            tenantId: 1,
            filesystemId: 'fs-1',
            pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
          }
        ]),
        connectDirect: vi.fn(),
        signOut: vi.fn()
      } as any,
      resolver: {} as never,
      syncLog: { info: vi.fn(), error: vi.fn(), show: vi.fn() } as any,
      statusBar: {
        setPaused: vi.fn(),
        setSyncing: vi.fn(),
        setSynced: vi.fn(),
        setOffline: vi.fn(),
        setAuthRequired: vi.fn(),
        setConflicts: vi.fn()
      } as any,
      mirrorSync: { syncNow: vi.fn() } as any,
      ui: {
        showInputBox: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showQuickPick: vi.fn(async items => items[0]),
        showOpenDialog: vi.fn(),
        withProgress: vi.fn(async (_opts, task) => task())
      },
      workspaceApi: {
        isTrusted: true,
        replaceWorkspace,
        openFolder,
        currentFolderPath: vi.fn(),
        uriFromParts: createUri,
        fileUri: createFileUri,
        progressLocationNotification: 15
      }
    });

    await handlers.openCloudFolder();

    expect(openFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        scheme: 'bgdbfs',
        authority: 'local',
        path: '/'
      }),
      false
    );
    expect(replaceWorkspace).not.toHaveBeenCalled();
  });

  it('refuses mirror materialization in untrusted workspaces', async () => {
    const showWarningMessage = vi.fn();
    const handlers = createCommandHandlers({
      profiles: {
        listProfiles: vi.fn().mockResolvedValue([
          {
            id: 'local',
            label: 'Local',
            mode: 'beginningdb.direct',
            baseUrl: 'http://127.0.0.1:8080',
            tenantId: 1,
            filesystemId: 'fs-1',
            pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
          }
        ]),
        connectDirect: vi.fn(),
        signOut: vi.fn()
      } as any,
      resolver: {} as never,
      syncLog: { info: vi.fn(), error: vi.fn(), show: vi.fn() } as any,
      statusBar: {
        setPaused: vi.fn(),
        setSyncing: vi.fn(),
        setSynced: vi.fn(),
        setOffline: vi.fn(),
        setAuthRequired: vi.fn(),
        setConflicts: vi.fn()
      } as any,
      mirrorSync: { syncNow: vi.fn() } as any,
      ui: {
        showInputBox: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage,
        showQuickPick: vi.fn(async items => items[0]),
        showOpenDialog: vi.fn(),
        withProgress: vi.fn(async (_opts, task) => task())
      },
      workspaceApi: {
        isTrusted: false,
        replaceWorkspace: vi.fn(),
        openFolder: vi.fn(),
        currentFolderPath: vi.fn(),
        uriFromParts: createUri,
        fileUri: createFileUri,
        progressLocationNotification: 15
      }
    });

    await handlers.openMirror();

    expect(showWarningMessage).toHaveBeenCalled();
  });

  it('materializes the resolved remote filesystem root when opening a mirror', async () => {
    const materialize = vi.fn();
    const syncNow = vi.fn();
    const openFolder = vi.fn();
    const handlers = createCommandHandlers({
      profiles: {
        listProfiles: vi.fn().mockResolvedValue([
          {
            id: 'local',
            label: 'Local',
            mode: 'beginningdb.direct',
            baseUrl: 'http://127.0.0.1:8080',
            tenantId: 1,
            filesystemId: 'fs-1',
            pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
          }
        ]),
        connectDirect: vi.fn(),
        signOut: vi.fn()
      } as any,
      resolver: {
        resolve: vi.fn().mockResolvedValue({
          client: {},
          remotePath: '/.bgdb-vfs/filesystems/fs-1'
        })
      } as any,
      syncLog: { info: vi.fn(), error: vi.fn(), show: vi.fn() } as any,
      statusBar: {
        setPaused: vi.fn(),
        setSyncing: vi.fn(),
        setSynced: vi.fn(),
        setOffline: vi.fn(),
        setAuthRequired: vi.fn(),
        setConflicts: vi.fn()
      } as any,
      mirrorSync: { syncNow } as any,
      mirrorManagerFactory: () => ({ materialize } as any),
      ui: {
        showInputBox: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showQuickPick: vi.fn(async items => items[0]),
        showOpenDialog: vi.fn(async () => [
          {
            scheme: 'file',
            authority: '',
            path: '/tmp/bgdb-mirror',
            fsPath: '/tmp/bgdb-mirror',
            toString: () => 'file:///tmp/bgdb-mirror'
          }
        ]),
        withProgress: vi.fn(async (_opts, task) => task())
      },
      workspaceApi: {
        isTrusted: true,
        replaceWorkspace: vi.fn(),
        openFolder,
        currentFolderPath: vi.fn(),
        uriFromParts: createUri,
        fileUri: createFileUri,
        progressLocationNotification: 15
      }
    } as any);

    await handlers.openMirror();

    expect(materialize).toHaveBeenCalledWith(
      '/.bgdb-vfs/filesystems/fs-1',
      '/tmp/bgdb-mirror',
      'local'
    );
    expect(syncNow).toHaveBeenCalled();
    expect(openFolder).toHaveBeenCalled();
  });

  it('syncs the current mirror when requested', async () => {
    const syncNow = vi.fn();
    const handlers = createCommandHandlers({
      profiles: {
        listProfiles: vi.fn().mockResolvedValue([]),
        connectDirect: vi.fn(),
        signOut: vi.fn()
      } as any,
      resolver: {} as never,
      syncLog: { info: vi.fn(), error: vi.fn(), show: vi.fn() } as any,
      statusBar: {
        setPaused: vi.fn(),
        setSyncing: vi.fn(),
        setSynced: vi.fn(),
        setOffline: vi.fn(),
        setAuthRequired: vi.fn(),
        setConflicts: vi.fn()
      } as any,
      mirrorSync: { syncNow } as any,
      ui: {
        showInputBox: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showQuickPick: vi.fn(),
        showOpenDialog: vi.fn(),
        withProgress: vi.fn(async (_opts, task) => task())
      },
      workspaceApi: {
        isTrusted: true,
        replaceWorkspace: vi.fn(),
        openFolder: vi.fn(),
        currentFolderPath: vi.fn(() => path.join('/tmp', 'mirror')),
        uriFromParts: createUri,
        fileUri: createFileUri,
        progressLocationNotification: 15
      }
    });

    await handlers.syncNow();

    expect(syncNow).toHaveBeenCalled();
  });
});

function createUri({
  scheme,
  authority,
  path
}: Parameters<WorkspaceApi['uriFromParts']>[0]): CommandUri {
  return {
    scheme,
    authority,
    path,
    toString: () => `${scheme}://${authority}${path}`
  };
}

function createFileUri(fsPath: string): CommandUri {
  return {
    scheme: 'file',
    authority: '',
    path: fsPath,
    fsPath,
    toString: () => `file://${fsPath}`
  };
}
