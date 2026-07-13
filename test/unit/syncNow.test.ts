import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VfsBackendClient } from '../../src/backend/vfsBackendClient';
import { MirrorManager, readMirrorManifest } from '../../src/mirror/mirrorManager';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'bgdb-sync-now-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('mirror manifest', () => {
  it('stores the profile id used for the mirror', async () => {
    const manager = new MirrorManager(new MemoryBackend({ '/docs/a.txt': 'hello' }));
    await manager.materialize('/', tmp, 'profile-1');

    await expect(readMirrorManifest(tmp)).resolves.toMatchObject({
      profileId: 'profile-1',
      rootRemotePath: '/'
    });
  });

  it('updates both local and remote state during a sync cycle', async () => {
    const backend = new MemoryBackend({ '/docs/a.txt': 'hello' });
    const manager = new MirrorManager(backend);
    await manager.materialize('/', tmp, 'profile-1');

    await writeFile(path.join(tmp, 'docs/a.txt'), 'local');
    backend.files.set('/docs/b.txt', 'remote');

    await manager.syncLocalChanges(tmp);
    await manager.syncRemoteChanges(tmp);

    expect(backend.files.get('/docs/a.txt')).toBe('local');
    await expect(readFile(path.join(tmp, 'docs/b.txt'), 'utf8')).resolves.toBe('remote');
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
      if (!file.startsWith(prefix)) continue;
      const suffix = file.slice(prefix.length);
      if (!suffix) continue;
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
  async delete() {}
  async rename() {}
  async search() { return []; }
}

function fileStat(pathName: string, size: number) {
  return { path: pathName, kind: 'file' as const, size, mtimeMs: 1, version: 1, inodeId: 1 };
}

function dirStat(pathName: string) {
  return { path: pathName, kind: 'dir' as const, size: 0, mtimeMs: 1, version: 1, inodeId: 1 };
}
