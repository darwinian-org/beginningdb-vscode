import type { VfsBackendProfile } from '../backend/backendProfile';
import type {
  TransferCancellationToken,
  TransferConflictPolicy,
  TransferRequest,
  TransferSummary,
  TransferUri
} from './transferTypes';

type QuickPickItem<T> = { label: string; description?: string; value: T };

export interface TransferCommandUi {
  showOpenDialog(options?: {
    canSelectFiles?: boolean;
    canSelectFolders?: boolean;
    canSelectMany?: boolean;
    openLabel?: string;
  }): Promise<readonly TransferUri[] | undefined>;
  showQuickPick<T extends QuickPickItem<unknown>>(
    items: readonly T[],
    options?: { placeHolder?: string }
  ): Promise<T | undefined>;
  showInformationMessage(message: string): Promise<string | undefined>;
  showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>;
  withProgress<R>(
    options: { title: string },
    task: (token: TransferCancellationToken) => Promise<R>
  ): Promise<R>;
}

export interface TransferWorkspaceApi {
  uriFromParts(input: { scheme: string; authority: string; path: string }): TransferUri;
  fileUri(path: string): TransferUri;
}

export interface TransferSettings {
  defaultConflictPolicy: TransferConflictPolicy;
  maxFileSizeBytes: number;
}

export interface TransferCommandDeps {
  profiles: Pick<{ listProfiles(): Promise<VfsBackendProfile[]> }, 'listProfiles'>;
  transfer(request: TransferRequest, token: TransferCancellationToken): Promise<TransferSummary>;
  settings: TransferSettings;
  ui: TransferCommandUi;
  workspaceApi: TransferWorkspaceApi;
  logger: { info(message: string): void; error(message: string): void };
}

export function createTransferCommandHandlers(deps: TransferCommandDeps) {
  return {
    uploadToCloud: (...args: unknown[]) => uploadToCloud(deps, args),
    downloadToLocal: (...args: unknown[]) => downloadToLocal(deps, args),
    copyTo: (...args: unknown[]) => copyTo(deps, args),
    moveTo: (...args: unknown[]) => moveTo(deps, args),
    showTransfers: () => deps.logger.info('Transfer view requested')
  };
}

async function uploadToCloud(deps: TransferCommandDeps, args: unknown[]): Promise<void> {
  const sources = await sourcesFromArgsOrDialog(deps, args, {
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: true,
    openLabel: 'Upload to BeginningDB'
  });
  if (sources.length === 0) return;
  const destination = destinationFromArgs(args) ?? await pickCloudDestination(deps);
  if (!destination) return;
  await runTransfer(deps, {
    sources,
    destination,
    mode: 'copy',
    conflictPolicy: deps.settings.defaultConflictPolicy,
    preserveTree: true
  }, 'Uploading to BeginningDB');
}

async function downloadToLocal(deps: TransferCommandDeps, args: unknown[]): Promise<void> {
  const sources = urisFromCommandArgs(args);
  if (sources.length === 0) return;
  const folder = destinationFromArgs(args)
    ? undefined
    : await deps.ui.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Download from BeginningDB'
      });
  const destination = destinationFromArgs(args) ?? folder?.[0];
  if (!destination) return;
  await runTransfer(deps, {
    sources,
    destination,
    mode: 'copy',
    conflictPolicy: deps.settings.defaultConflictPolicy,
    preserveTree: true
  }, 'Downloading from BeginningDB');
}

async function copyTo(deps: TransferCommandDeps, args: unknown[]): Promise<void> {
  const sources = urisFromCommandArgs(args);
  if (sources.length === 0) return;
  if (sources.every(source => source.scheme === 'file')) {
    await uploadToCloud(deps, sources);
    return;
  }
  if (sources.every(source => source.scheme === 'bgdbfs')) {
    await downloadToLocal(deps, sources);
    return;
  }
  await deps.ui.showWarningMessage('Copy to... supports either local files or BeginningDB files, not a mixed selection.');
}

async function moveTo(deps: TransferCommandDeps, args: unknown[]): Promise<void> {
  const sources = urisFromCommandArgs(args);
  if (sources.length === 0) return;
  const confirmed = await deps.ui.showWarningMessage(
    'Move copies files first and then deletes the original after each successful copy.',
    'Move'
  );
  if (confirmed !== 'Move') return;
  const destination = sources.every(source => source.scheme === 'file')
    ? await pickCloudDestination(deps)
    : (await deps.ui.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Move BeginningDB files to local folder'
      }))?.[0];
  if (!destination) return;
  await runTransfer(deps, {
    sources,
    destination,
    mode: 'move',
    conflictPolicy: deps.settings.defaultConflictPolicy,
    preserveTree: true
  }, 'Moving files');
}

async function sourcesFromArgsOrDialog(
  deps: TransferCommandDeps,
  args: unknown[],
  dialogOptions: Parameters<TransferCommandUi['showOpenDialog']>[0]
): Promise<TransferUri[]> {
  const sources = urisFromCommandArgs(args);
  if (sources.length > 0) {
    return sources;
  }
  return [...(await deps.ui.showOpenDialog(dialogOptions) ?? [])];
}

function urisFromCommandArgs(args: unknown[]): TransferUri[] {
  const primary = args[0];
  const selected = args[1];
  if (Array.isArray(selected) && selected.every(isTransferUri)) {
    return selected;
  }
  if (Array.isArray(primary) && primary.every(isTransferUri)) {
    return primary;
  }
  return isTransferUri(primary) ? [primary] : [];
}

function destinationFromArgs(args: unknown[]): TransferUri | undefined {
  const candidate = args[2];
  return isTransferUri(candidate) ? candidate : undefined;
}

async function pickCloudDestination(deps: TransferCommandDeps): Promise<TransferUri | undefined> {
  const profiles = await deps.profiles.listProfiles();
  const items = profiles.map(profile => ({
    label: profile.label,
    description: profile.id,
    value: profile
  }));
  const selected = await deps.ui.showQuickPick(items, { placeHolder: 'Select BeginningDB destination' });
  if (!selected) return undefined;
  return deps.workspaceApi.uriFromParts({
    scheme: 'bgdbfs',
    authority: selected.value.id,
    path: '/'
  });
}

async function runTransfer(
  deps: TransferCommandDeps,
  request: TransferRequest,
  title: string
): Promise<void> {
  const summary = await deps.ui.withProgress({ title }, token => deps.transfer(request, token));
  const message = transferSummaryMessage(summary);
  if (summary.status === 'completed') {
    deps.logger.info(message);
    await deps.ui.showInformationMessage(message);
  } else {
    deps.logger.error(message);
    await deps.ui.showWarningMessage(message);
  }
}

function transferSummaryMessage(summary: TransferSummary): string {
  const action = summary.status === 'completed' ? 'completed' : summary.status;
  return `Transfer ${action}: ${summary.copied} copied, ${summary.moved} moved, ${summary.skipped} skipped, ${summary.failed} failed`;
}

function isTransferUri(value: unknown): value is TransferUri {
  const candidate = value as Partial<TransferUri>;
  return Boolean(
    candidate &&
      typeof candidate === 'object' &&
      typeof candidate.scheme === 'string' &&
      typeof candidate.path === 'string' &&
      typeof candidate.toString === 'function'
  );
}
