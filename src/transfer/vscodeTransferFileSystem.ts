import * as vscode from 'vscode';
import type {
  TransferFileSystem,
  TransferFileType,
  TransferStat,
  TransferUri
} from './transferTypes';

export class VsCodeTransferFileSystem implements TransferFileSystem {
  async stat(uri: TransferUri): Promise<TransferStat> {
    const stat = await vscode.workspace.fs.stat(uri as vscode.Uri);
    return {
      type: fileTypeFromVsCode(stat.type),
      size: stat.size
    };
  }

  async readDirectory(uri: TransferUri): Promise<readonly [string, TransferFileType][]> {
    const entries = await vscode.workspace.fs.readDirectory(uri as vscode.Uri);
    return entries.map(([name, type]) => [name, fileTypeFromVsCode(type)] as const);
  }

  async readFile(uri: TransferUri): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(uri as vscode.Uri);
  }

  async writeFile(uri: TransferUri, bytes: Uint8Array): Promise<void> {
    await vscode.workspace.fs.writeFile(uri as vscode.Uri, bytes);
  }

  async createDirectory(uri: TransferUri): Promise<void> {
    await vscode.workspace.fs.createDirectory(uri as vscode.Uri);
  }

  async delete(uri: TransferUri, options: { recursive: boolean }): Promise<void> {
    await vscode.workspace.fs.delete(uri as vscode.Uri, options);
  }

  async copy(source: TransferUri, destination: TransferUri, options: { overwrite: boolean }): Promise<void> {
    await vscode.workspace.fs.copy(source as vscode.Uri, destination as vscode.Uri, options);
  }

  joinPath(base: TransferUri, ...segments: string[]): TransferUri {
    return vscode.Uri.joinPath(base as vscode.Uri, ...segments);
  }

  basename(uri: TransferUri): string {
    return uri.path.split('/').filter(Boolean).at(-1) ?? '';
  }

  dirname(uri: TransferUri): TransferUri {
    const parts = uri.path.split('/').filter(Boolean);
    const parentPath = parts.length <= 1 ? '/' : `/${parts.slice(0, -1).join('/')}`;
    return vscode.Uri.from({
      scheme: uri.scheme,
      authority: uri.authority,
      path: parentPath
    });
  }
}

function fileTypeFromVsCode(type: vscode.FileType): TransferFileType {
  if (type & vscode.FileType.Directory) return 'directory';
  if (type & vscode.FileType.File) return 'file';
  if (type & vscode.FileType.SymbolicLink) return 'symlink';
  return 'unknown';
}
