import * as vscode from 'vscode';
import { ServerRegistry } from './auth/serverRegistry';
import { BeginningDbClientResolver } from './beginningdb/clientRegistry';
import { BeginningDbFileSystemProvider } from './filesystem/beginningDbFileSystemProvider';
import { registerCommands } from './ui/commands';
import { SyncLog } from './ui/syncLog';
import { SyncStatusBar } from './ui/statusBar';
import { MirrorSyncService } from './mirror/mirrorSyncService';
import { BgngCli } from './controlPlane/bgngCli';
import { ProfileProvider } from './controlPlane/profileProvider';
import { BgngCredentialProvider } from './controlPlane/bgngCredentialProvider';
import { HttpCredentialProvider } from './controlPlane/httpCredentialProvider';
import { HostBridgeCredentialProvider, isMindspaceHostApi } from './controlPlane/hostBridgeCredentialProvider';
import type { CredentialProvider } from './controlPlane/credentialProvider';
import { registerTransferCommands } from './transfer/transferCommands';
import { registerTransferView } from './transfer/transferView';

export function activate(context: vscode.ExtensionContext) {
  const servers = new ServerRegistry(context);
  const syncLog = new SyncLog(vscode.window.createOutputChannel('BeginningDB Sync'));
  const statusBar = new SyncStatusBar(
    vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  );
  const configuredBgngPath = vscode.workspace
    .getConfiguration('beginningdb')
    .get<string>('bgngPath');
  const configuredCredentialsEndpoint =
    vscode.workspace.getConfiguration('beginningdb').get<string>('credentialsEndpoint') ||
    process.env.MINDSPACE_CREDENTIALS_ENDPOINT;
  const configuredCredentialsSecret =
    vscode.workspace.getConfiguration('beginningdb').get<string>('credentialsSecret') ||
    process.env.MINDSPACE_BROKER_SECRET;
  const cli = new BgngCli({
    ...(configuredBgngPath ? { executablePath: configuredBgngPath } : {})
  });
  const credentials = createCredentialProvider({
    configuredCredentialsEndpoint,
    configuredCredentialsSecret,
    cli
  });
  const profiles = new ProfileProvider(credentials, credentials instanceof BgngCredentialProvider ? servers : undefined, syncLog);
  const resolver = new BeginningDbClientResolver(profiles);
  const provider = new BeginningDbFileSystemProvider(resolver);
  const mirrorSync = new MirrorSyncService({
    resolver,
    statusBar,
    syncLog,
    workspacePath: () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      return workspaceFolder?.uri.scheme === 'file' ? workspaceFolder.uri.fsPath : undefined;
    }
  });

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('bgdbfs', provider, {
      isCaseSensitive: true,
      isReadonly: false
    })
  );
  context.subscriptions.push(syncLog, statusBar, mirrorSync);

  registerCommands(context, profiles, resolver, syncLog, statusBar, mirrorSync);
  registerTransferCommands(context, profiles, resolver, syncLog);
  registerTransferView(context, profiles, syncLog);
  mirrorSync.start(15_000);
  void mirrorSync.syncNow();
  void vscode.commands.executeCommand('setContext', 'beginningdb.runtime', 'node');
  void vscode.commands.executeCommand('setContext', 'beginningdb.mirrorSupported', true);
}

export function deactivate() {}

function createCredentialProvider(input: {
  configuredCredentialsEndpoint: string | undefined;
  configuredCredentialsSecret: string | undefined;
  cli: BgngCli;
}): CredentialProvider {
  if (hasMindspaceHostExtension()) {
    return new HostBridgeCredentialProvider({ extensions: vscode.extensions });
  }
  if (input.configuredCredentialsEndpoint) {
    return new HttpCredentialProvider({
      endpoint: input.configuredCredentialsEndpoint,
      ...(input.configuredCredentialsSecret ? { secret: input.configuredCredentialsSecret } : {})
    });
  }
  return new BgngCredentialProvider(input.cli);
}

function hasMindspaceHostExtension(): boolean {
  const extension = vscode.extensions.getExtension('mindspace.mindspace-host');
  return !!extension && (extension.exports === undefined || isMindspaceHostApi(extension.exports));
}
