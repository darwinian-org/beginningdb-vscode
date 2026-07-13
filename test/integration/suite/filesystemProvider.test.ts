import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { BeginningDbError } from '../../../src/beginningdb/errors';
import type { VfsBackendClient } from '../../../src/backend/vfsBackendClient';
import type {
  BeginningDbDirEntry,
  BeginningDbStat,
  DeleteOptions,
  RenameOptions,
  WriteOptions
} from '../../../src/beginningdb/types';
import {
  BeginningDbFileSystemProvider,
  type VfsBackendClientRegistry
} from '../../../src/filesystem/beginningDbFileSystemProvider';

suite('BeginningDbFileSystemProvider', () => {
  test('routes VS Code filesystem operations to BeginningDB clients', async () => {
    const client = new FakeClient();
    const provider = new BeginningDbFileSystemProvider(registryFor(client));
    const scheme = `bgdbfstest-${Date.now()}`;
    const registration = vscode.workspace.registerFileSystemProvider(scheme, provider);
    const uri = vscode.Uri.parse(`${scheme}://workspace/docs/a.txt`);

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      assert.equal(stat.type, vscode.FileType.File);
      assert.equal(stat.size, 5);

      const entries = await vscode.workspace.fs.readDirectory(
        vscode.Uri.parse(`${scheme}://workspace/docs`)
      );
      assert.deepEqual(entries, [['a.txt', vscode.FileType.File]]);

      const bytes = await vscode.workspace.fs.readFile(uri);
      assert.equal(new TextDecoder().decode(bytes), 'hello');

      await vscode.workspace.fs.copy(uri, vscode.Uri.parse(`${scheme}://workspace/docs/copied.txt`));
      assert.equal(client.writes.at(-1)?.path, '/docs/copied.txt');
      assert.equal(new TextDecoder().decode(client.writes.at(-1)?.content ?? new Uint8Array()), 'hello');

      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode('updated'));
      assert.equal(client.writes.at(-1)?.path, '/docs/a.txt');

      await vscode.workspace.fs.createDirectory(vscode.Uri.parse(`${scheme}://workspace/new`));
      assert.equal(client.created[0], '/new');

      await vscode.workspace.fs.rename(uri, vscode.Uri.parse(`${scheme}://workspace/docs/b.txt`));
      assert.deepEqual(client.renames[0], {
        source: '/docs/a.txt',
        target: '/docs/b.txt',
        options: { overwrite: false }
      });

      await vscode.workspace.fs.delete(uri);
      assert.equal(client.deletes[0]?.path, '/docs/a.txt');
    } finally {
      registration.dispose();
    }
  });

  test('maps BeginningDB not found errors to VS Code file errors', async () => {
    const client = new FakeClient();
    client.failStat = new BeginningDbError('not_found', 'missing', 404);
    const provider = new BeginningDbFileSystemProvider(registryFor(client));
    const scheme = `bgdbfserr-${Date.now()}`;
    const registration = vscode.workspace.registerFileSystemProvider(scheme, provider);

    try {
      await assert.rejects(
        async () =>
          vscode.workspace.fs.stat(vscode.Uri.parse(`${scheme}://workspace/missing.txt`)),
        /missing/
      );
    } finally {
      registration.dispose();
    }
  });
});

function registryFor(client: VfsBackendClient): VfsBackendClientRegistry {
  return {
    async resolve(uri: vscode.Uri) {
      return {
        client,
        remotePath: uri.path || '/'
      };
    }
  };
}

class FakeClient implements VfsBackendClient {
  writes: Array<{ path: string; content: Uint8Array; options: WriteOptions }> = [];
  created: string[] = [];
  deletes: Array<{ path: string; options: DeleteOptions }> = [];
  renames: Array<{ source: string; target: string; options: RenameOptions }> = [];
  existingFiles = new Set(['/docs/a.txt']);
  existingDirs = new Set(['/', '/docs']);
  failStat?: BeginningDbError;

  async stat(path: string): Promise<BeginningDbStat> {
    if (this.failStat) {
      throw this.failStat;
    }
    if (this.existingDirs.has(path)) {
      return {
        path,
        kind: 'dir',
        size: 0,
        mtimeMs: 123,
        version: 1,
        inodeId: 0,
        etag: 'W/"0:1"'
      };
    }
    if (!this.existingFiles.has(path)) {
      throw new BeginningDbError('not_found', 'missing', 404);
    }
    return {
      path,
      kind: 'file',
      size: 5,
      mtimeMs: 123,
      version: 1,
      inodeId: 2,
      etag: 'W/"2:1"'
    };
  }

  async readDirectory(path: string): Promise<BeginningDbDirEntry[]> {
    return [
      {
        name: 'a.txt',
        path: `${path}/a.txt`,
        kind: 'file',
        size: 5,
        mtimeMs: 123,
        version: 1,
        inodeId: 2,
        etag: 'W/"2:1"'
      }
    ];
  }

  async readFile(): Promise<Uint8Array> {
    return new TextEncoder().encode('hello');
  }

  async writeFile(
    path: string,
    content: Uint8Array,
    options: WriteOptions
  ): Promise<BeginningDbStat | undefined> {
    this.writes.push({ path, content, options });
    this.existingFiles.add(path);
    return undefined;
  }

  async createDirectory(path: string): Promise<void> {
    this.created.push(path);
    this.existingDirs.add(path);
  }

  async delete(path: string, options: DeleteOptions): Promise<void> {
    this.deletes.push({ path, options });
  }

  async rename(source: string, target: string, options: RenameOptions): Promise<void> {
    this.renames.push({ source, target, options });
    this.existingFiles.delete(source);
    this.existingFiles.add(target);
  }

  async search(): Promise<string[]> {
    return [];
  }
}
