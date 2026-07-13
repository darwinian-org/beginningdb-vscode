import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VfsBackendClient } from '../../src/backend/vfsBackendClient';
import { MirrorManager } from '../../src/mirror/mirrorManager';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'bgdb-mirror-test-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('MirrorManager', () => {
  it('materializes remote files into a local mirror', async () => {
    const client = new MemoryBackend({
      '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt': 'hello mirror'
    });
    const manager = new MirrorManager(client);

    await manager.materialize('/.bgdb-vfs/filesystems/fs-1', tmp);

    await expect(readFile(path.join(tmp, 'docs/readme.txt'), 'utf8')).resolves.toBe(
      'hello mirror'
    );
    await expect(stat(path.join(tmp, '.beginningdb/mirror.json'))).resolves.toBeDefined();
  });

  it('uploads changed local files on sync', async () => {
    const client = new MemoryBackend({
      '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt': 'hello mirror'
    });
    const manager = new MirrorManager(client);
    await manager.materialize('/.bgdb-vfs/filesystems/fs-1', tmp);

    await writeFile(path.join(tmp, 'docs/readme.txt'), 'changed locally');
    await manager.syncLocalChanges(tmp);

    expect(client.files.get('/.bgdb-vfs/filesystems/fs-1/docs/readme.txt')).toBe('changed locally');
  });

  it('deletes remote files that were removed locally', async () => {
    const client = new MemoryBackend({
      '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt': 'hello mirror'
    });
    const manager = new MirrorManager(client);
    await manager.materialize('/.bgdb-vfs/filesystems/fs-1', tmp);

    await rm(path.join(tmp, 'docs/readme.txt'));
    await manager.syncLocalChanges(tmp);

    expect(client.files.has('/.bgdb-vfs/filesystems/fs-1/docs/readme.txt')).toBe(false);
  });

  it('ignores editor temp files during local sync', async () => {
    const client = new MemoryBackend({
      '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt': 'hello mirror'
    });
    const manager = new MirrorManager(client);
    await manager.materialize('/.bgdb-vfs/filesystems/fs-1', tmp);

    await writeFile(path.join(tmp, 'docs/.readme.txt.swp'), 'temp');
    await writeFile(path.join(tmp, 'docs/readme.txt~'), 'backup');
    await manager.syncLocalChanges(tmp);

    expect(client.files.has('/.bgdb-vfs/filesystems/fs-1/docs/.readme.txt.swp')).toBe(false);
    expect(client.files.has('/.bgdb-vfs/filesystems/fs-1/docs/readme.txt~')).toBe(false);
  });

  it('pulls remote changes into clean local files', async () => {
    const client = new MemoryBackend({
      '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt': 'hello mirror'
    });
    const manager = new MirrorManager(client);
    await manager.materialize('/.bgdb-vfs/filesystems/fs-1', tmp);

    client.files.set('/.bgdb-vfs/filesystems/fs-1/docs/readme.txt', 'changed remotely');
    await manager.syncRemoteChanges(tmp);

    await expect(readFile(path.join(tmp, 'docs/readme.txt'), 'utf8')).resolves.toBe(
      'changed remotely'
    );
  });

  it('creates a conflict copy when local and remote both changed', async () => {
    const client = new MemoryBackend({
      '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt': 'hello mirror'
    });
    const manager = new MirrorManager(client);
    await manager.materialize('/.bgdb-vfs/filesystems/fs-1', tmp);

    await writeFile(path.join(tmp, 'docs/readme.txt'), 'changed locally');
    client.files.set('/.bgdb-vfs/filesystems/fs-1/docs/readme.txt', 'changed remotely');

    await manager.syncRemoteChanges(tmp);

    const files = await readdir(path.join(tmp, 'docs'));
    expect(files.some(file => file.startsWith('readme.beginningdb-remote-conflict-'))).toBe(true);
    await expect(readFile(path.join(tmp, 'docs/readme.txt'), 'utf8')).resolves.toBe(
      'changed locally'
    );
  });

  it('removes clean local files that were deleted remotely', async () => {
    const client = new MemoryBackend({
      '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt': 'hello mirror'
    });
    const manager = new MirrorManager(client);
    await manager.materialize('/.bgdb-vfs/filesystems/fs-1', tmp);

    client.files.delete('/.bgdb-vfs/filesystems/fs-1/docs/readme.txt');
    await manager.syncRemoteChanges(tmp);

    await expect(stat(path.join(tmp, 'docs/readme.txt'))).rejects.toBeDefined();
  });

  it('ignores directory change events when consuming remote cursors', async () => {
    const client = new ChangeBackend({
      '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt': 'hello mirror'
    });
    const manager = new MirrorManager(client);
    await manager.materialize('/.bgdb-vfs/filesystems/fs-1', tmp);

    client.files.set('/.bgdb-vfs/filesystems/fs-1/docs/readme.txt', 'changed remotely');
    client.cursorChanges = {
      cursor: 2,
      changes: [
        {
          seq: 1,
          path: '/.bgdb-vfs/filesystems/fs-1',
          kind: 'dir',
          type: 'changed'
        },
        {
          seq: 2,
          path: '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt',
          kind: 'file',
          type: 'changed'
        }
      ]
    };

    await expect(manager.syncRemoteChanges(tmp)).resolves.toMatchObject({
      downloaded: 1,
      conflicts: 0
    });
    await expect(readFile(path.join(tmp, 'docs/readme.txt'), 'utf8')).resolves.toBe(
      'changed remotely'
    );
  });

  it('uses the latest cursor event per file before reading changed remote files', async () => {
    const client = new StrictChangeBackend({
      '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt': 'hello mirror'
    });
    const manager = new MirrorManager(client);
    await manager.materialize('/.bgdb-vfs/filesystems/fs-1', tmp);

    client.files.delete('/.bgdb-vfs/filesystems/fs-1/docs/readme.txt');
    client.cursorChanges = {
      cursor: 3,
      changes: [
        {
          seq: 2,
          path: '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt',
          kind: 'file',
          type: 'changed'
        },
        {
          seq: 3,
          path: '/.bgdb-vfs/filesystems/fs-1/docs/readme.txt',
          kind: 'file',
          type: 'deleted'
        }
      ]
    };

    await expect(manager.syncRemoteChanges(tmp)).resolves.toMatchObject({
      deleted: 1,
      downloaded: 0
    });
    await expect(stat(path.join(tmp, 'docs/readme.txt'))).rejects.toBeDefined();
  });

  it('rejects unsafe remote paths', async () => {
    const client = new MemoryBackend({
      '/../escape.txt': 'bad'
    });
    const manager = new MirrorManager(client);

    await expect(manager.materialize('/', tmp)).rejects.toThrow(/unsafe/);
  });
});

class MemoryBackend implements VfsBackendClient {
  files: Map<string, string>;

  constructor(files: Record<string, string>) {
    this.files = new Map(Object.entries(files));
  }

  async stat(pathName: string) {
    if (this.files.has(pathName)) {
      return fileStat(pathName, this.files.get(pathName)!.length);
    }
    return dirStat(pathName);
  }

  async readDirectory(pathName: string) {
    const prefix = pathName === '/' ? '/' : `${pathName}/`;
    const names = new Set<string>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) {
        continue;
      }
      const suffix = file.slice(prefix.length);
      if (!suffix) {
        continue;
      }
      names.add(suffix.split('/')[0]!);
    }
    return [...names].sort().map(name => {
      const childPath = `${prefix}${name}`.replaceAll('//', '/');
      const isFile = this.files.has(childPath);
      return isFile ? { name, ...fileStat(childPath, this.files.get(childPath)!.length) } : { name, ...dirStat(childPath) };
    });
  }

  async readFile(pathName: string) {
    return new TextEncoder().encode(this.files.get(pathName) ?? '');
  }

  async writeFile(pathName: string, content: Uint8Array) {
    this.files.set(pathName, new TextDecoder().decode(content));
    return fileStat(pathName, content.byteLength);
  }

  async createDirectory() {}
  async delete(pathName: string) {
    this.files.delete(pathName);
  }
  async rename() {}
  async search() {
    return [];
  }
}

class ChangeBackend extends MemoryBackend {
  cursorChanges = { cursor: 0, changes: [] as any[] };

  async listChanges() {
    return this.cursorChanges;
  }
}

class StrictChangeBackend extends ChangeBackend {
  async stat(pathName: string) {
    if (!this.files.has(pathName)) {
      throw new Error(`missing stat target: ${pathName}`);
    }
    return fileStat(pathName, this.files.get(pathName)!.length);
  }
}

function fileStat(pathName: string, size: number) {
  return {
    path: pathName,
    kind: 'file' as const,
    size,
    mtimeMs: 1,
    version: 1,
    inodeId: 1
  };
}

function dirStat(pathName: string) {
  return {
    path: pathName,
    kind: 'dir' as const,
    size: 0,
    mtimeMs: 1,
    version: 1,
    inodeId: 1
  };
}
