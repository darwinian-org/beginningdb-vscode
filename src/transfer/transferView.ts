import * as vscode from 'vscode';
import type { VfsBackendProfile } from '../backend/backendProfile';
import type { ProfileProvider } from '../controlPlane/profileProvider';
import type { SyncLog } from '../ui/syncLog';
import {
  parseUriList,
  routeTransferDrop,
  TRANSFER_TREE_MIME
} from './transferDnd';

const VIEW_ID = 'beginningdb.transfer';

type TransferTreeNode =
  | { kind: 'cloud-root'; label: string; uri: vscode.Uri; profile: VfsBackendProfile }
  | { kind: 'local-root'; label: string; uri: vscode.Uri };

export function registerTransferView(
  context: vscode.ExtensionContext,
  profiles: Pick<ProfileProvider, 'listProfiles'>,
  syncLog: SyncLog
): void {
  const provider = new TransferTreeDataProvider(profiles);
  const controller = new TransferTreeDragAndDropController(syncLog);
  context.subscriptions.push(
    vscode.window.createTreeView(VIEW_ID, {
      treeDataProvider: provider,
      dragAndDropController: controller
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh())
  );
}

class TransferTreeDataProvider implements vscode.TreeDataProvider<TransferTreeNode> {
  private readonly changeEmitter = new vscode.EventEmitter<TransferTreeNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly profiles: Pick<ProfileProvider, 'listProfiles'>) {}

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: TransferTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = element.uri;
    item.contextValue = element.kind;
    item.tooltip = element.uri.toString();
    return item;
  }

  async getChildren(element?: TransferTreeNode): Promise<TransferTreeNode[]> {
    if (element) {
      return [];
    }
    const localRoots = (vscode.workspace.workspaceFolders ?? [])
      .filter(folder => folder.uri.scheme === 'file')
      .map(folder => ({
        kind: 'local-root' as const,
        label: folder.name,
        uri: folder.uri
      }));
    const cloudRoots = (await this.profiles.listProfiles()).map(profile => ({
      kind: 'cloud-root' as const,
      label: profile.label,
      uri: vscode.Uri.from({ scheme: 'bgdbfs', authority: profile.id, path: '/' }),
      profile
    }));
    return [...localRoots, ...cloudRoots];
  }
}

class TransferTreeDragAndDropController implements vscode.TreeDragAndDropController<TransferTreeNode> {
  readonly dragMimeTypes = [TRANSFER_TREE_MIME, 'text/uri-list'];
  readonly dropMimeTypes = [TRANSFER_TREE_MIME, 'text/uri-list', 'files'];

  constructor(private readonly syncLog: SyncLog) {}

  handleDrag(source: readonly TransferTreeNode[], dataTransfer: vscode.DataTransfer): void {
    const uris = source.map(item => item.uri.toString());
    dataTransfer.set(TRANSFER_TREE_MIME, new vscode.DataTransferItem(uris));
    dataTransfer.set('text/uri-list', new vscode.DataTransferItem(uris.join('\r\n')));
  }

  async handleDrop(
    target: TransferTreeNode | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    if (!target) {
      await vscode.window.showWarningMessage('Drop files onto a local or BeginningDB root.');
      return;
    }
    const sources = await urisFromDataTransfer(dataTransfer);
    const route = routeTransferDrop(target.uri, sources);
    if (route.kind === 'error') {
      await vscode.window.showWarningMessage(route.message);
      return;
    }
    await vscode.commands.executeCommand(route.command, route.sources, route.sources, route.destination);
    this.syncLog.info(`Queued transfer drop with ${sources.length} item(s)`);
  }
}

async function urisFromDataTransfer(dataTransfer: vscode.DataTransfer): Promise<vscode.Uri[]> {
  const treeItem = dataTransfer.get(TRANSFER_TREE_MIME);
  if (treeItem) {
    const value = treeItem.value;
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string').map(value => vscode.Uri.parse(value));
    }
  }

  const uriList = dataTransfer.get('text/uri-list');
  if (uriList) {
    const text = await uriList.asString();
    return parseUriList(text, value => vscode.Uri.parse(value));
  }

  const droppedFiles: vscode.Uri[] = [];
  for (const [, item] of dataTransfer) {
    const file = item.asFile();
    if (file?.uri) {
      droppedFiles.push(file.uri);
    }
  }
  return droppedFiles;
}
