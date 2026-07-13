import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { VfsBackendClient } from '../backend/vfsBackendClient';
import type { ChangeSet } from '../beginningdb/types';
import {
  absoluteRemotePathFromMirror,
  safeMirrorPathForRemote
} from './pathSafety';

export interface MirrorManifest {
  rootRemotePath: string;
  profileId?: string;
  cursor?: number;
  files: Record<string, { hash: string; mtimeMs: number }>;
}

export interface LocalSyncResult {
  uploaded: number;
  deleted: number;
}

export interface RemoteSyncResult {
  downloaded: number;
  deleted: number;
  conflicts: number;
}

type RemoteDeltaEntry = {
  entry: { mtimeMs: number };
  bytes: Uint8Array;
  deleted?: boolean;
};

export class MirrorManager {
  constructor(private readonly client: VfsBackendClient) {}

  async materialize(remoteRoot: string, localRoot: string, profileId?: string): Promise<void> {
    const manifest: MirrorManifest = {
      rootRemotePath: remoteRoot,
      cursor: 0,
      files: {},
      ...(profileId ? { profileId } : {})
    };
    await this.materializeDirectory(remoteRoot, localRoot, manifest);
    await writeManifest(localRoot, manifest);
  }

  async syncLocalChanges(localRoot: string): Promise<LocalSyncResult> {
    const manifest = await readMirrorManifest(localRoot);
    const files = await listLocalFiles(localRoot);
    const currentRemotePaths = new Set(
      files.map(file => absoluteRemotePathFromMirror(localRoot, manifest.rootRemotePath, file))
    );
    let uploaded = 0;
    let deleted = 0;

    for (const file of files) {
      const remotePath = absoluteRemotePathFromMirror(localRoot, manifest.rootRemotePath, file);
      const bytes = await readFile(file);
      const hash = await sha256(bytes);
      if (manifest.files[remotePath]?.hash === hash) {
        continue;
      }
      await this.client.writeFile(remotePath, bytes, { create: true, overwrite: true });
      manifest.files[remotePath] = { hash, mtimeMs: Date.now() };
      uploaded += 1;
    }

    for (const remotePath of Object.keys(manifest.files)) {
      if (currentRemotePaths.has(remotePath)) {
        continue;
      }
      await this.client.delete(remotePath, { recursive: false });
      delete manifest.files[remotePath];
      deleted += 1;
    }

    await writeManifest(localRoot, manifest);
    return { uploaded, deleted };
  }

  async syncRemoteChanges(localRoot: string): Promise<RemoteSyncResult> {
    const manifest = await readMirrorManifest(localRoot);
    const delta:
      | { cursor: number | undefined; files: Map<string, RemoteDeltaEntry> }
      = 
      this.client.listChanges && manifest.cursor !== undefined
        ? await collectChangedRemoteFiles(
            this.client,
            manifest.rootRemotePath,
            manifest.cursor
          )
        : { cursor: manifest.cursor, files: await collectRemoteFiles(this.client, manifest.rootRemotePath) };
    const remoteFiles = delta.files;
    let downloaded = 0;
    let deleted = 0;
    let conflicts = 0;

    for (const [remotePath, remote] of remoteFiles.entries()) {
      if (remote.deleted) {
        const localPath = safeMirrorPathForRemote(localRoot, manifest.rootRemotePath, remotePath);
        if ((await exists(localPath)) && (await sha256(await readFile(localPath))) === manifest.files[remotePath]?.hash) {
          await rm(localPath, { force: true });
          deleted += 1;
        }
        delete manifest.files[remotePath];
        continue;
      }
      const localPath = safeMirrorPathForRemote(localRoot, manifest.rootRemotePath, remotePath);
      const localExists = await exists(localPath);
      if (!localExists) {
        await mkdir(path.dirname(localPath), { recursive: true });
        await writeFile(localPath, remote.bytes);
        manifest.files[remotePath] = {
          hash: await sha256(remote.bytes),
          mtimeMs: remote.entry.mtimeMs
        };
        downloaded += 1;
        continue;
      }

      const localBytes = await readFile(localPath);
      const localHash = await sha256(localBytes);
      const recordedHash = manifest.files[remotePath]?.hash;
      const remoteHash = await sha256(remote.bytes);

      if (recordedHash === remoteHash) {
        continue;
      }
      if (recordedHash && localHash !== recordedHash) {
        await writeConflictFile(localPath, remote.bytes);
        conflicts += 1;
        continue;
      }

      await writeFile(localPath, remote.bytes);
      manifest.files[remotePath] = { hash: remoteHash, mtimeMs: remote.entry.mtimeMs };
      downloaded += 1;
    }

    for (const remotePath of Object.keys(manifest.files)) {
      if (remoteFiles.has(remotePath)) {
        continue;
      }
      const localPath = safeMirrorPathForRemote(localRoot, manifest.rootRemotePath, remotePath);
      if (!(await exists(localPath))) {
        delete manifest.files[remotePath];
        continue;
      }
      const localHash = await sha256(await readFile(localPath));
      if (localHash === manifest.files[remotePath]?.hash) {
        await rm(localPath, { force: true });
        delete manifest.files[remotePath];
        deleted += 1;
      }
    }

    if (delta.cursor !== undefined) {
      manifest.cursor = delta.cursor;
    }
    await writeManifest(localRoot, manifest);
    return { downloaded, deleted, conflicts };
  }

  private async materializeDirectory(
    remotePath: string,
    localRoot: string,
    manifest: MirrorManifest
  ): Promise<void> {
    const entries = await this.client.readDirectory(remotePath);
    for (const entry of entries) {
      const childRemotePath =
        remotePath === '/' ? `/${entry.name}` : `${remotePath}/${entry.name}`;
      if (entry.kind === 'dir') {
        await mkdir(safeMirrorPathForRemote(localRoot, manifest.rootRemotePath, childRemotePath), { recursive: true });
        await this.materializeDirectory(childRemotePath, localRoot, manifest);
      } else if (entry.kind === 'file') {
        const target = safeMirrorPathForRemote(localRoot, manifest.rootRemotePath, childRemotePath);
        await mkdir(path.dirname(target), { recursive: true });
        const bytes = await this.client.readFile(childRemotePath);
        await writeFile(target, bytes);
        manifest.files[childRemotePath] = {
          hash: await sha256(bytes),
          mtimeMs: entry.mtimeMs
        };
      }
    }
  }
}

async function writeManifest(localRoot: string, manifest: MirrorManifest): Promise<void> {
  const dir = path.join(localRoot, '.beginningdb');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'mirror.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function readMirrorManifest(localRoot: string): Promise<MirrorManifest> {
  return JSON.parse(await readFile(path.join(localRoot, '.beginningdb/mirror.json'), 'utf8'));
}

async function listLocalFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir)) {
      if (shouldIgnoreLocalEntry(entry)) {
        continue;
      }
      const fullPath = path.join(dir, entry);
      const fileStat = await stat(fullPath);
      if (fileStat.isDirectory()) {
        await visit(fullPath);
      } else if (fileStat.isFile()) {
        files.push(fullPath);
      }
    }
  }
  await visit(root);
  return files;
}

function shouldIgnoreLocalEntry(name: string): boolean {
  return (
    name === '.beginningdb' ||
    name === '.git' ||
    name === '.DS_Store' ||
    name.startsWith('.#') ||
    (name.startsWith('#') && name.endsWith('#')) ||
    name.endsWith('~') ||
    name.endsWith('.swp') ||
    name.endsWith('.tmp') ||
    name.endsWith('.temp')
  );
}

async function collectRemoteFiles(
  client: VfsBackendClient,
  remoteRoot: string
): Promise<Map<string, RemoteDeltaEntry>> {
  const results = new Map<string, RemoteDeltaEntry>();

  async function visit(remotePath: string): Promise<void> {
    for (const entry of await client.readDirectory(remotePath)) {
      const childRemotePath =
        remotePath === '/' ? `/${entry.name}` : `${remotePath}/${entry.name}`;
      if (entry.kind === 'dir') {
        await visit(childRemotePath);
      } else if (entry.kind === 'file') {
        results.set(childRemotePath, {
          entry: { mtimeMs: entry.mtimeMs },
          bytes: await client.readFile(childRemotePath)
        });
      }
    }
  }

  await visit(remoteRoot);
  return results;
}

async function collectChangedRemoteFiles(
  client: VfsBackendClient,
  remoteRoot: string,
  cursor: number
): Promise<{ cursor: number; files: Map<string, RemoteDeltaEntry> }> {
  const results = new Map<string, RemoteDeltaEntry>();
  const changeSet = await client.listChanges?.(remoteRoot, cursor);
  if (!changeSet) {
    return { cursor, files: await collectRemoteFiles(client, remoteRoot) };
  }
  const latestFileChanges = new Map<string, ChangeSet['changes'][number]>();
  for (const change of changeSet.changes) {
    if (change.kind === 'dir') {
      continue;
    }
    latestFileChanges.set(change.path, change);
  }
  const changes = [...latestFileChanges.values()].sort((left, right) => left.seq - right.seq);
  for (const change of changes) {
    if (change.type === 'deleted') {
      results.set(change.path, { entry: { mtimeMs: Date.now() }, bytes: new Uint8Array(), deleted: true });
      continue;
    }
    const stat = await client.stat(change.path);
    if (stat.kind === 'dir') {
      continue;
    }
    results.set(change.path, {
      entry: { mtimeMs: stat.mtimeMs },
      bytes: await client.readFile(change.path)
    });
  }
  return { cursor: changeSet.cursor, files: results };
}

async function exists(pathName: string): Promise<boolean> {
  try {
    await stat(pathName);
    return true;
  } catch {
    return false;
  }
}

async function writeConflictFile(localPath: string, remoteBytes: Uint8Array): Promise<void> {
  const { dir, ext, name } = path.parse(localPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const conflictPath = path.join(dir, `${name}.beginningdb-remote-conflict-${timestamp}${ext}`);
  await writeFile(conflictPath, remoteBytes);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
