import * as vscode from 'vscode';
import { BeginningDbClientResolver } from '../beginningdb/clientRegistry';
import { MirrorSyncService } from '../mirror/mirrorSyncService';
import type { SyncLog } from './syncLog';
import type { SyncStatusBar } from './statusBar';
import { createCommandHandlers } from './commandsCore';
import { ProfileProvider } from '../controlPlane/profileProvider';

export function registerCommands(
  context: vscode.ExtensionContext,
  profiles: ProfileProvider,
  resolver: BeginningDbClientResolver,
  syncLog: SyncLog,
  statusBar: SyncStatusBar,
  mirrorSync: MirrorSyncService
): void {
  const handlers = createCommandHandlers({
    profiles,
    resolver,
    syncLog,
    statusBar,
    mirrorSync,
    ui: {
      showInputBox: options => Promise.resolve(vscode.window.showInputBox(options)),
      showInformationMessage: message => Promise.resolve(vscode.window.showInformationMessage(message)),
      showWarningMessage: message => Promise.resolve(vscode.window.showWarningMessage(message)),
      showQuickPick: (items, options) => Promise.resolve(vscode.window.showQuickPick(items, options)),
      showOpenDialog: options => Promise.resolve(vscode.window.showOpenDialog(options)),
      withProgress: (options, task) =>
        Promise.resolve(
          vscode.window.withProgress(
            {
              location: options.location as vscode.ProgressLocation | { viewId: string },
              title: options.title
            },
            () => task()
          )
        )
    },
    workspaceApi: {
      get isTrusted() {
        return vscode.workspace.isTrusted;
      },
      replaceWorkspace(folder) {
        const workspaceFolder = folder.name
          ? { uri: folder.uri as vscode.Uri, name: folder.name }
          : { uri: folder.uri as vscode.Uri };
        vscode.workspace.updateWorkspaceFolders(
          vscode.workspace.workspaceFolders?.length ?? 0,
          vscode.workspace.workspaceFolders?.length ? 1 : 0,
          workspaceFolder
        );
      },
      openFolder(uri, forceNewWindow) {
        return Promise.resolve(
          vscode.commands.executeCommand('vscode.openFolder', uri, forceNewWindow)
        ).then(() => undefined);
      },
      currentFolderPath() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        return workspaceFolder?.uri.scheme === 'file' ? workspaceFolder.uri.fsPath : undefined;
      },
      uriFromParts(input) {
        return vscode.Uri.from(input);
      },
      fileUri(fsPath) {
        return vscode.Uri.file(fsPath);
      },
      progressLocationNotification: vscode.ProgressLocation.Notification
    }
  });

  const runSafely =
    (task: () => Promise<void> | void) =>
    async () => {
      try {
        await Promise.resolve(task());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        syncLog.error(message);
        await vscode.window.showErrorMessage(message);
      }
    };

  context.subscriptions.push(
    vscode.commands.registerCommand('beginningdb.addServer', runSafely(handlers.addServer)),
    vscode.commands.registerCommand('beginningdb.signIn', runSafely(handlers.addServer)),
    vscode.commands.registerCommand('beginningdb.signOut', runSafely(handlers.signOut)),
    vscode.commands.registerCommand('beginningdb.openCloudFolder', runSafely(handlers.openCloudFolder)),
    vscode.commands.registerCommand('beginningdb.openMirror', runSafely(handlers.openMirror)),
    vscode.commands.registerCommand('beginningdb.syncNow', runSafely(handlers.syncNow)),
    vscode.commands.registerCommand('beginningdb.showSyncLog', runSafely(handlers.showSyncLog))
  );
}
