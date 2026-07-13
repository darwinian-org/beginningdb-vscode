import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import { TransferEngine } from '../../../src/transfer/transferEngine';
import { VsCodeTransferFileSystem } from '../../../src/transfer/vscodeTransferFileSystem';

suite('TransferEngine VS Code integration', () => {
  test('copies a local file to a contributed filesystem through workspace.fs', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'bgdb-transfer-'));
    const sourcePath = path.join(tempDir, 'a.txt');
    await writeFile(sourcePath, 'hello transfer');
    const scheme = `bgdbfstransfer-${Date.now()}`;
    const provider = new MemoryProvider();
    const registration = vscode.workspace.registerFileSystemProvider(scheme, provider);
    const destination = vscode.Uri.parse(`${scheme}://workspace/uploads`);

    try {
      await vscode.workspace.fs.createDirectory(destination);
      const engine = new TransferEngine({
        fs: new VsCodeTransferFileSystem(),
        maxFileSizeBytes: 10_000
      });

      const summary = await engine.run({
        sources: [vscode.Uri.file(sourcePath)],
        destination,
        mode: 'copy',
        conflictPolicy: 'overwrite',
        preserveTree: true
      });

      assert.equal(summary.status, 'completed');
      assert.equal(summary.copied, 1);
      const copied = await vscode.workspace.fs.readFile(
        vscode.Uri.parse(`${scheme}://workspace/uploads/a.txt`)
      );
      assert.equal(new TextDecoder().decode(copied), 'hello transfer');
    } finally {
      registration.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

type Node =
  | { type: vscode.FileType.Directory; children: Set<string>; bytes?: never }
  | { type: vscode.FileType.File; bytes: Uint8Array; children?: never };

class MemoryProvider implements vscode.FileSystemProvider {
  private readonly nodes = new Map<string, Node>([
    ['bgdbfstransfer-root', { type: vscode.FileType.Directory, children: new Set() }]
  ]);
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changeEmitter.event;

  stat(uri: vscode.Uri): vscode.FileStat {
    const node = this.node(uri);
    return {
      type: node.type,
      ctime: 0,
      mtime: 0,
      size: node.type === vscode.FileType.File ? node.bytes.byteLength : 0
    };
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    const node = this.node(uri);
    if (node.type !== vscode.FileType.Directory) {
      throw vscode.FileSystemError.FileNotADirectory(uri);
    }
    return [...node.children].map(name => [name, this.node(vscode.Uri.joinPath(uri, name)).type]);
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const node = this.node(uri);
    if (node.type !== vscode.FileType.File) {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }
    return node.bytes;
  }

  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    const parent = this.parentUri(uri);
    const parentNode = this.node(parent);
    if (parentNode.type !== vscode.FileType.Directory) {
      throw vscode.FileSystemError.FileNotADirectory(parent);
    }
    this.nodes.set(this.key(uri), { type: vscode.FileType.File, bytes: content });
    parentNode.children.add(this.basename(uri));
    this.changeEmitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
  }

  createDirectory(uri: vscode.Uri): void {
    if (this.nodes.has(this.key(uri))) {
      return;
    }
    const parent = this.parentUri(uri);
    const parentNode = this.node(parent);
    if (parentNode.type !== vscode.FileType.Directory) {
      throw vscode.FileSystemError.FileNotADirectory(parent);
    }
    this.nodes.set(this.key(uri), { type: vscode.FileType.Directory, children: new Set() });
    parentNode.children.add(this.basename(uri));
    this.changeEmitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
  }

  delete(uri: vscode.Uri): void {
    this.nodes.delete(this.key(uri));
    this.changeEmitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    const oldNode = this.node(oldUri);
    this.nodes.set(this.key(newUri), oldNode);
    this.nodes.delete(this.key(oldUri));
    this.changeEmitter.fire([
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri }
    ]);
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  private node(uri: vscode.Uri): Node {
    const node = this.nodes.get(this.key(uri));
    if (!node) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return node;
  }

  private parentUri(uri: vscode.Uri): vscode.Uri {
    const parts = uri.path.split('/').filter(Boolean);
    const parentPath = parts.length <= 1 ? '/' : `/${parts.slice(0, -1).join('/')}`;
    return uri.with({ path: parentPath });
  }

  private basename(uri: vscode.Uri): string {
    return uri.path.split('/').filter(Boolean).at(-1) ?? '';
  }

  private key(uri: vscode.Uri): string {
    return uri.path === '/' ? 'bgdbfstransfer-root' : uri.toString();
  }
}
