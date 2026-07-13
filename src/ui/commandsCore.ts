import { BeginningDbClientResolver } from '../beginningdb/clientRegistry';
import { MirrorManager } from '../mirror/mirrorManager';
import { MirrorSyncService } from '../mirror/mirrorSyncService';
import type { SyncLog } from './syncLog';
import type { SyncStatusBar } from './statusBar';
import { ProfileProvider } from '../controlPlane/profileProvider';
import type { VfsBackendProfile } from '../backend/backendProfile';

export interface CommandUri {
  scheme: string;
  authority: string;
  path: string;
  fsPath?: string;
  toString(): string;
}

type UiQuickPickItem<T> = { label: string; description?: string; server?: T };

export interface CommandUi {
  showInputBox(options?: { prompt?: string; value?: string; password?: boolean }): Promise<string | undefined>;
  showInformationMessage(message: string): Promise<string | undefined>;
  showWarningMessage(message: string): Promise<string | undefined>;
  showQuickPick<T extends UiQuickPickItem<unknown>>(
    items: readonly T[],
    options?: { placeHolder?: string }
  ): Promise<T | undefined>;
  showOpenDialog(options?: {
    canSelectFiles?: boolean;
    canSelectFolders?: boolean;
    canSelectMany?: boolean;
    openLabel?: string;
  }): Promise<readonly CommandUri[] | undefined>;
  withProgress<R>(
    options: { location: unknown; title: string },
    task: () => Promise<R>
  ): Promise<R>;
}

export interface WorkspaceApi {
  isTrusted: boolean;
  replaceWorkspace(folder: { uri: CommandUri; name?: string }): void;
  openFolder(uri: CommandUri, forceNewWindow?: boolean): Promise<void>;
  currentFolderPath(): string | undefined;
  uriFromParts(input: { scheme: string; authority: string; path: string }): CommandUri;
  fileUri(fsPath: string): CommandUri;
  progressLocationNotification: unknown;
}

interface CommandHandlersDeps {
  profiles: Pick<ProfileProvider, 'listProfiles' | 'connectDirect' | 'signOut'>;
  resolver: BeginningDbClientResolver;
  syncLog: SyncLog;
  statusBar: SyncStatusBar;
  mirrorSync: MirrorSyncService;
  mirrorManagerFactory?: (client: unknown) => Pick<MirrorManager, 'materialize'>;
  ui: CommandUi;
  workspaceApi: WorkspaceApi;
}

export function createCommandHandlers(deps: CommandHandlersDeps) {
  return {
    addServer: () => addServer(deps),
    signOut: () => signOut(deps),
    openCloudFolder: () => openCloudFolder(deps),
    openMirror: () => openMirror(deps),
    syncNow: () => deps.mirrorSync.syncNow(),
    showSyncLog: () => deps.syncLog.show()
  };
}

async function addServer(deps: CommandHandlersDeps): Promise<void> {
  const label = await deps.ui.showInputBox({ prompt: 'BeginningDB server name' });
  if (!label) return;
  const baseUrl = await deps.ui.showInputBox({
    prompt: 'BeginningDB base URL',
    value: 'http://127.0.0.1:8080'
  });
  if (!baseUrl) return;
  const tenant = await deps.ui.showInputBox({ prompt: 'BeginningDB tenant ID', value: '1' });
  if (!tenant) return;
  const filesystemId = await deps.ui.showInputBox({
    prompt: 'BeginningDB filesystem ID',
    value: 'ide'
  });
  if (!filesystemId) return;
  const token = await deps.ui.showInputBox({
    prompt: 'BeginningDB API token (optional for local development)',
    password: true
  });
  const id = slug(label);
  await deps.profiles.connectDirect({
    id,
    label,
    baseUrl,
    tenantId: Number(tenant),
    filesystemId,
    ...(token ? { token } : {})
  });
  deps.syncLog.info(`Saved BeginningDB profile ${id} via bgng`);
  await deps.ui.showInformationMessage(`BeginningDB server saved: ${label}`);
}

async function signOut(deps: CommandHandlersDeps): Promise<void> {
  const server = await pickServer(deps);
  if (!server) return;
  await deps.profiles.signOut(server.id);
  deps.syncLog.info(`Signed out of ${server.id}`);
  await deps.ui.showInformationMessage(`Signed out of ${server.label}`);
}

async function openCloudFolder(deps: CommandHandlersDeps): Promise<void> {
  const server = await pickServer(deps);
  if (!server) return;
  await deps.workspaceApi.openFolder(
    deps.workspaceApi.uriFromParts({ scheme: 'bgdbfs', authority: server.id, path: '/' }),
    false
  );
  deps.syncLog.info(`Opened cloud folder for ${server.id}`);
}

async function openMirror(deps: CommandHandlersDeps): Promise<void> {
  const server = await pickServer(deps);
  if (!server) return;
  if (!deps.workspaceApi.isTrusted) {
    deps.statusBar.setPaused('Workspace not trusted');
    await deps.ui.showWarningMessage(
      'BeginningDB mirror materialization requires Workspace Trust.'
    );
    return;
  }
  const folder = await deps.ui.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Use as BeginningDB Mirror'
  });
  const target = folder?.[0]?.fsPath;
  if (!target) return;

  await deps.ui.withProgress(
    { location: deps.workspaceApi.progressLocationNotification, title: 'Materializing BeginningDB mirror' },
    async () => {
      deps.statusBar.setSyncing(1);
      const resolved = await deps.resolver.resolve(
        deps.workspaceApi.uriFromParts({ scheme: 'bgdbfs', authority: server.id, path: '/' }) as any
      );
      const manager =
        deps.mirrorManagerFactory?.(resolved.client) ?? new MirrorManager(resolved.client);
      await manager.materialize(resolved.remotePath, target, server.id);
      deps.statusBar.setSynced();
    }
  );

  deps.syncLog.info(`Materialized mirror for ${server.id} at ${target}`);
  await deps.mirrorSync.syncNow();
  await deps.workspaceApi.openFolder(deps.workspaceApi.fileUri(target), false);
}

async function pickServer(deps: CommandHandlersDeps) {
  const items = (await deps.profiles.listProfiles()).map(server => ({
    label: server.label,
    description: server.id,
    server
  }));
  return (await deps.ui.showQuickPick(items, { placeHolder: 'Select BeginningDB server' }))?.server;
}

type PickableServer = VfsBackendProfile;

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'server';
}
