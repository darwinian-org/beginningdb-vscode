import * as vscode from 'vscode';
import { BeginningDbError } from '../beginningdb/errors';
import type {
  VfsBackendClient,
  VfsBackendClientResolution
} from '../backend/vfsBackendClient';
import { toVsCodeFileType } from './fileType';
import { PollingWatcher } from './pollingWatcher';

export interface VfsBackendClientRegistry {
  resolve(uri: vscode.Uri): Promise<VfsBackendClientResolution>;
}

export class BeginningDbFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

  readonly onDidChangeFile = this.changeEmitter.event;

  constructor(private readonly clients: VfsBackendClientRegistry) {}

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    return this.mapErrors(uri, async () => {
      const { client, remotePath } = await this.clients.resolve(uri);
      const stat = await client.stat(remotePath);
      return {
        type: toVsCodeFileType(stat.kind),
        ctime: stat.mtimeMs,
        mtime: stat.mtimeMs,
        size: stat.size
      };
    });
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    return this.mapErrors(uri, async () => {
      const { client, remotePath } = await this.clients.resolve(uri);
      const entries = await client.readDirectory(remotePath);
      return entries.map(entry => [entry.name, toVsCodeFileType(entry.kind)]);
    });
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return this.mapErrors(uri, async () => {
      const { client, remotePath } = await this.clients.resolve(uri);
      return client.readFile(remotePath);
    });
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    await this.mapErrors(uri, async () => {
      const { client, remotePath } = await this.clients.resolve(uri);
      await client.writeFile(remotePath, content, options);
      this.changeEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    });
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    await this.mapErrors(uri, async () => {
      const { client, remotePath } = await this.clients.resolve(uri);
      await client.createDirectory(remotePath);
      this.changeEmitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
    });
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    await this.mapErrors(uri, async () => {
      const { client, remotePath } = await this.clients.resolve(uri);
      await client.delete(remotePath, options);
      this.changeEmitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    });
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): Promise<void> {
    await this.mapErrors(oldUri, async () => {
      const oldRef = await this.clients.resolve(oldUri);
      const newRef = await this.clients.resolve(newUri);
      await oldRef.client.rename(oldRef.remotePath, newRef.remotePath, options);
      this.changeEmitter.fire([
        { type: vscode.FileChangeType.Deleted, uri: oldUri },
        { type: vscode.FileChangeType.Created, uri: newUri }
      ]);
    });
  }

  async copy(
    source: vscode.Uri,
    destination: vscode.Uri,
    options: { overwrite: boolean }
  ): Promise<void> {
    await this.mapErrors(source, async () => {
      const sourceRef = await this.clients.resolve(source);
      const destinationRef = await this.clients.resolve(destination);
      await copyBackendEntry(sourceRef.client, sourceRef.remotePath, destinationRef.client, destinationRef.remotePath, options);
      this.changeEmitter.fire([{ type: vscode.FileChangeType.Created, uri: destination }]);
    });
  }

  watch(
    uri: vscode.Uri,
    _options: { recursive: boolean; excludes: readonly string[] }
  ): vscode.Disposable {
    const watcher = new PollingWatcher(
      {
        stat: async path => (await this.clients.resolve(uri)).client.stat(path),
        readDirectory: async path => (await this.clients.resolve(uri)).client.readDirectory(path),
        readFile: async path => (await this.clients.resolve(uri)).client.readFile(path),
        writeFile: async (path, content, options) =>
          (await this.clients.resolve(uri)).client.writeFile(path, content, options),
        createDirectory: async path => (await this.clients.resolve(uri)).client.createDirectory(path),
        delete: async (path, options) => (await this.clients.resolve(uri)).client.delete(path, options),
        rename: async (source, target, options) =>
          (await this.clients.resolve(uri)).client.rename(source, target, options),
        search: async (query, pathPrefix) =>
          (await this.clients.resolve(uri)).client.search(query, pathPrefix)
      },
      1000
    );
    return watcher.watch(uri.path, events => {
      this.changeEmitter.fire(
        events.map(event => ({
          uri: uri.with({ path: event.path }),
          type:
            event.type === 'created'
              ? vscode.FileChangeType.Created
              : event.type === 'deleted'
                ? vscode.FileChangeType.Deleted
                : vscode.FileChangeType.Changed
        }))
      );
    });
  }

  private async mapErrors<T>(uri: vscode.Uri, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof BeginningDbError) {
        throw toVsCodeError(uri, error);
      }
      throw error;
    }
  }
}

async function copyBackendEntry(
  sourceClient: VfsBackendClient,
  sourcePath: string,
  destinationClient: VfsBackendClient,
  destinationPath: string,
  options: { overwrite: boolean }
): Promise<void> {
  const stat = await sourceClient.stat(sourcePath);
  if (stat.kind === 'dir') {
    await destinationClient.createDirectory(destinationPath);
    for (const entry of await sourceClient.readDirectory(sourcePath)) {
      const childSource = sourcePath === '/' ? `/${entry.name}` : `${sourcePath}/${entry.name}`;
      const childDestination = destinationPath === '/' ? `/${entry.name}` : `${destinationPath}/${entry.name}`;
      await copyBackendEntry(sourceClient, childSource, destinationClient, childDestination, options);
    }
    return;
  }
  if (stat.kind !== 'file') {
    throw new BeginningDbError('bad_request', `Cannot copy unsupported BeginningDB entry type: ${stat.kind}`);
  }
  const bytes = await sourceClient.readFile(sourcePath);
  await destinationClient.writeFile(destinationPath, bytes, { create: true, overwrite: options.overwrite });
}

function toVsCodeError(uri: vscode.Uri, error: BeginningDbError): vscode.FileSystemError {
  switch (error.kind) {
    case 'not_found':
      return vscode.FileSystemError.FileNotFound(uri);
    case 'already_exists':
      return vscode.FileSystemError.FileExists(uri);
    case 'permission_denied':
    case 'unauthorized':
      return vscode.FileSystemError.NoPermissions(uri);
    case 'rate_limited':
    case 'unavailable':
      return vscode.FileSystemError.Unavailable(uri);
    default:
      return new vscode.FileSystemError(error.message);
  }
}
