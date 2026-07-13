import * as vscode from 'vscode';
import type { BeginningDbClientResolver } from '../beginningdb/clientRegistry';
import type { ProfileProvider } from '../controlPlane/profileProvider';
import type { SyncLog } from '../ui/syncLog';
import { TransferEngine } from './transferEngine';
import { createTransferCommandHandlers } from './transferCommandsCore';
import { VsCodeTransferFileSystem } from './vscodeTransferFileSystem';
import type {
  TransferCancellationToken,
  TransferCapabilities,
  TransferCapabilityProvider,
  TransferConflictPolicy,
  TransferRequest,
  TransferSummary,
  TransferUri
} from './transferTypes';

export function registerTransferCommands(
  context: vscode.ExtensionContext,
  profiles: ProfileProvider,
  resolver: BeginningDbClientResolver,
  syncLog: SyncLog
): void {
  const transferFs = new VsCodeTransferFileSystem();
  const capabilities = new BeginningDbTransferCapabilityProvider(resolver);
  const runTransfer = (request: TransferRequest, token: TransferCancellationToken): Promise<TransferSummary> => {
    const settings = readTransferSettings();
    const engine = new TransferEngine({
      fs: transferFs,
      capabilities,
      maxFileSizeBytes: settings.maxFileSizeBytes,
      conflictResolver: async ({ destination }) => {
        const choice = await vscode.window.showWarningMessage(
          `${destination.toString()} already exists.`,
          'Overwrite',
          'Skip',
          'Rename',
          'Cancel'
        );
        return choice === 'Overwrite'
          ? 'overwrite'
          : choice === 'Skip'
            ? 'skip'
            : choice === 'Rename'
              ? 'rename'
              : 'cancel';
      }
    });
    return engine.run(request, token);
  };

  const handlers = createTransferCommandHandlers({
    profiles,
    transfer: runTransfer,
    settings: readTransferSettings(),
    ui: {
      showOpenDialog: options => Promise.resolve(vscode.window.showOpenDialog(options)),
      showQuickPick: (items, options) => Promise.resolve(vscode.window.showQuickPick(items, options)),
      showInformationMessage: message => Promise.resolve(vscode.window.showInformationMessage(message)),
      showWarningMessage: (message, ...items) => Promise.resolve(vscode.window.showWarningMessage(message, ...items)),
      withProgress: (options, task) =>
        Promise.resolve(
          vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: options.title,
              cancellable: true
            },
            (_progress, token) => task(token)
          )
        )
    },
    workspaceApi: {
      uriFromParts(input) {
        return vscode.Uri.from(input);
      },
      fileUri(path) {
        return vscode.Uri.file(path);
      }
    },
    logger: syncLog
  });

  const runSafely =
    (task: (...args: unknown[]) => Promise<void> | void) =>
    async (...args: unknown[]) => {
      try {
        await Promise.resolve(task(...args));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        syncLog.error(message);
        await vscode.window.showErrorMessage(message);
      }
    };

  context.subscriptions.push(
    vscode.commands.registerCommand('beginningdb.uploadToCloud', runSafely(handlers.uploadToCloud)),
    vscode.commands.registerCommand('beginningdb.downloadToLocal', runSafely(handlers.downloadToLocal)),
    vscode.commands.registerCommand('beginningdb.copyTo', runSafely(handlers.copyTo)),
    vscode.commands.registerCommand('beginningdb.moveTo', runSafely(handlers.moveTo)),
    vscode.commands.registerCommand('beginningdb.showTransfers', runSafely(handlers.showTransfers)),
    vscode.commands.registerCommand('beginningdb.cancelTransfer', runSafely(async () => {
      await vscode.window.showInformationMessage('No cancellable BeginningDB transfer is currently active.');
    }))
  );
}

class BeginningDbTransferCapabilityProvider implements TransferCapabilityProvider {
  constructor(private readonly resolver: BeginningDbClientResolver) {}

  async capabilitiesFor(uri: TransferUri): Promise<TransferCapabilities> {
    if (uri.scheme !== 'bgdbfs') {
      return defaultLocalCapabilities();
    }
    const resolution = await this.resolver.resolve(uri as vscode.Uri);
    return resolution.client.capabilities?.() ?? defaultLocalCapabilities();
  }
}

function defaultLocalCapabilities(): TransferCapabilities {
  return {
    binaryWrite: true,
    rename: true,
    streamingUpload: false,
    streamingDownload: false
  };
}

function readTransferSettings(): {
  defaultConflictPolicy: TransferConflictPolicy;
  maxFileSizeBytes: number;
} {
  const configuration = vscode.workspace.getConfiguration('beginningdb.transfer');
  const defaultConflictPolicy = configuration.get<TransferConflictPolicy>('defaultConflictPolicy', 'ask');
  const maxFileSizeMB = configuration.get<number>('maxFileSizeMB', 100);
  return {
    defaultConflictPolicy,
    maxFileSizeBytes: Math.max(1, maxFileSizeMB) * 1024 * 1024
  };
}
