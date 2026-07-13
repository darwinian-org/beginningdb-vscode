import * as vscode from 'vscode';
import type { ProfileProvider } from '../controlPlane/profileProvider';

export function registerWebCommands(
  context: vscode.ExtensionContext,
  profiles: Pick<ProfileProvider, 'listProfiles' | 'signOut'>
): void {
  const runSafely =
    (task: () => Promise<void> | void) =>
    async () => {
      try {
        await Promise.resolve(task());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await vscode.window.showErrorMessage(message);
      }
    };

  context.subscriptions.push(
    vscode.commands.registerCommand('beginningdb.addServer', runSafely(configureCredentialsEndpoint)),
    vscode.commands.registerCommand('beginningdb.signIn', runSafely(configureCredentialsEndpoint)),
    vscode.commands.registerCommand('beginningdb.signOut', runSafely(() => signOut(profiles))),
    vscode.commands.registerCommand('beginningdb.openCloudFolder', runSafely(() => openCloudFolder(profiles))),
    vscode.commands.registerCommand('beginningdb.openMirror', runSafely(showMirrorUnavailable)),
    vscode.commands.registerCommand('beginningdb.syncNow', runSafely(showMirrorUnavailable)),
    vscode.commands.registerCommand('beginningdb.showSyncLog', runSafely(showMirrorUnavailable)),
    vscode.commands.registerCommand('beginningdb.uploadToCloud', runSafely(showTransferUnavailable)),
    vscode.commands.registerCommand('beginningdb.downloadToLocal', runSafely(showTransferUnavailable)),
    vscode.commands.registerCommand('beginningdb.copyTo', runSafely(showTransferUnavailable)),
    vscode.commands.registerCommand('beginningdb.moveTo', runSafely(showTransferUnavailable)),
    vscode.commands.registerCommand('beginningdb.cancelTransfer', runSafely(showTransferUnavailable)),
    vscode.commands.registerCommand('beginningdb.showTransfers', runSafely(showTransferUnavailable))
  );
}

async function configureCredentialsEndpoint(): Promise<void> {
  await vscode.window.showInformationMessage(
    'BeginningDB web credentials are provided by the configured HTTP credential endpoint.'
  );
}

async function signOut(profiles: Pick<ProfileProvider, 'listProfiles' | 'signOut'>): Promise<void> {
  const profile = await pickProfile(profiles);
  if (!profile) return;
  await profiles.signOut(profile.id);
  await vscode.window.showInformationMessage(`Signed out of ${profile.label}`);
}

async function openCloudFolder(profiles: Pick<ProfileProvider, 'listProfiles'>): Promise<void> {
  const profile = await pickProfile(profiles);
  if (!profile) return;
  await vscode.commands.executeCommand(
    'vscode.openFolder',
    vscode.Uri.from({ scheme: 'bgdbfs', authority: profile.id, path: '/' }),
    false
  );
}

async function showMirrorUnavailable(): Promise<void> {
  await vscode.window.showWarningMessage(
    'BeginningDB mirror sync is only available in the desktop/server extension host.'
  );
}

async function showTransferUnavailable(): Promise<void> {
  await vscode.window.showWarningMessage(
    'BeginningDB local file transfer is only available in the desktop/server extension host.'
  );
}

async function pickProfile(profiles: Pick<ProfileProvider, 'listProfiles'>) {
  const items = (await profiles.listProfiles()).map(profile => ({
    label: profile.label,
    description: profile.id,
    profile
  }));
  return (await vscode.window.showQuickPick(items, { placeHolder: 'Select BeginningDB workspace' }))?.profile;
}
