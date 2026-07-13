import { describe, expect, it, vi } from 'vitest';
import { TransferEngine } from '../../src/transfer/transferEngine';
import type {
  TransferCapabilityProvider,
  TransferFileSystem,
  TransferFileType,
  TransferStat,
  TransferUri
} from '../../src/transfer/transferTypes';

describe('TransferEngine', () => {
  it('recursively copies a local folder into bgdbfs while preserving the selected folder name', async () => {
    const fs = new InMemoryTransferFs();
    fs.addDirectory(uri('file', '', '/project'));
    fs.addDirectory(uri('file', '', '/project/src'));
    fs.addDirectory(uri('file', '', '/project/empty'));
    fs.addFile(uri('file', '', '/project/README.md'), 'hello');
    fs.addFile(uri('file', '', '/project/src/index.ts'), 'console.log("ok");');
    fs.addDirectory(uri('bgdbfs', 'team-a', '/workspace'));
    const engine = new TransferEngine({
      fs,
      capabilities: allowBinaryCapabilities(),
      maxFileSizeBytes: 10_000
    });

    const summary = await engine.run({
      sources: [uri('file', '', '/project')],
      destination: uri('bgdbfs', 'team-a', '/workspace'),
      mode: 'copy',
      conflictPolicy: 'overwrite',
      preserveTree: true
    });

    expect(summary).toMatchObject({
      status: 'completed',
      copied: 2,
      failed: 0,
      skipped: 0
    });
    expect(text(fs.readStored(uri('bgdbfs', 'team-a', '/workspace/project/README.md')))).toBe('hello');
    expect(text(fs.readStored(uri('bgdbfs', 'team-a', '/workspace/project/src/index.ts')))).toBe('console.log("ok");');
    expect(await fs.stat(uri('bgdbfs', 'team-a', '/workspace/project/empty'))).toMatchObject({
      type: 'directory'
    });
  });

  it('renames conflicts deterministically without overwriting existing destination bytes', async () => {
    const fs = new InMemoryTransferFs();
    fs.addFile(uri('file', '', '/draft.txt'), 'new');
    fs.addDirectory(uri('bgdbfs', 'team-a', '/docs'));
    fs.addFile(uri('bgdbfs', 'team-a', '/docs/draft.txt'), 'existing');
    const engine = new TransferEngine({
      fs,
      capabilities: allowBinaryCapabilities(),
      maxFileSizeBytes: 10_000
    });

    const summary = await engine.run({
      sources: [uri('file', '', '/draft.txt')],
      destination: uri('bgdbfs', 'team-a', '/docs'),
      mode: 'copy',
      conflictPolicy: 'rename',
      preserveTree: true
    });

    expect(summary).toMatchObject({
      status: 'completed',
      copied: 1,
      renamed: 1,
      overwritten: 0
    });
    expect(text(fs.readStored(uri('bgdbfs', 'team-a', '/docs/draft.txt')))).toBe('existing');
    expect(text(fs.readStored(uri('bgdbfs', 'team-a', '/docs/draft copy.txt')))).toBe('new');
  });

  it('does not delete a moved source when the destination write fails', async () => {
    const fs = new InMemoryTransferFs();
    fs.addFile(uri('file', '', '/source.txt'), 'keep-me');
    fs.addDirectory(uri('bgdbfs', 'team-a', '/docs'));
    fs.failWritesTo.add('bgdbfs://team-a/docs/source.txt');
    const engine = new TransferEngine({
      fs,
      capabilities: allowBinaryCapabilities(),
      maxFileSizeBytes: 10_000
    });

    const summary = await engine.run({
      sources: [uri('file', '', '/source.txt')],
      destination: uri('bgdbfs', 'team-a', '/docs'),
      mode: 'move',
      conflictPolicy: 'overwrite',
      preserveTree: true
    });

    expect(summary.status).toBe('failed');
    expect(summary.failed).toBe(1);
    expect(text(fs.readStored(uri('file', '', '/source.txt')))).toBe('keep-me');
    expect(fs.deletes).toEqual([]);
  });

  it('blocks oversized files before reading bytes', async () => {
    const fs = new InMemoryTransferFs();
    fs.addFile(uri('file', '', '/large.bin'), new Uint8Array([1, 2, 3]), 5000);
    fs.addDirectory(uri('bgdbfs', 'team-a', '/uploads'));
    const engine = new TransferEngine({
      fs,
      capabilities: allowBinaryCapabilities(),
      maxFileSizeBytes: 100
    });

    const summary = await engine.run({
      sources: [uri('file', '', '/large.bin')],
      destination: uri('bgdbfs', 'team-a', '/uploads'),
      mode: 'copy',
      conflictPolicy: 'overwrite',
      preserveTree: true
    });

    expect(summary.status).toBe('failed');
    expect(summary.errors[0]).toMatchObject({ code: 'file_too_large' });
    expect(fs.reads).toEqual([]);
  });

  it('blocks non-UTF-8 uploads when the bgdbfs destination lacks binary-write support', async () => {
    const fs = new InMemoryTransferFs();
    fs.addFile(uri('file', '', '/asset.bin'), new Uint8Array([0, 255, 10]));
    fs.addDirectory(uri('bgdbfs', 'team-a', '/uploads'));
    const capabilities: TransferCapabilityProvider = {
      capabilitiesFor: vi.fn(async () => ({
        binaryWrite: false,
        rename: true,
        streamingUpload: false,
        streamingDownload: false
      }))
    };
    const engine = new TransferEngine({
      fs,
      capabilities,
      maxFileSizeBytes: 10_000
    });

    const summary = await engine.run({
      sources: [uri('file', '', '/asset.bin')],
      destination: uri('bgdbfs', 'team-a', '/uploads'),
      mode: 'copy',
      conflictPolicy: 'overwrite',
      preserveTree: true
    });

    expect(summary.status).toBe('failed');
    expect(summary.errors[0]).toMatchObject({ code: 'unsupported_binary' });
    expect(fs.writes).toEqual([]);
  });
});

function allowBinaryCapabilities(): TransferCapabilityProvider {
  return {
    capabilitiesFor: async () => ({
      binaryWrite: true,
      rename: true,
      streamingUpload: false,
      streamingDownload: false
    })
  };
}

type Node =
  | { type: 'directory'; children: Set<string>; size: 0 }
  | { type: 'file'; bytes: Uint8Array; size: number }
  | { type: 'symlink'; size: 0 };

class InMemoryTransferFs implements TransferFileSystem {
  private readonly nodes = new Map<string, Node>();
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  readonly deletes: string[] = [];
  readonly failWritesTo = new Set<string>();

  addDirectory(value: TransferUri): void {
    const key = value.toString();
    this.nodes.set(key, { type: 'directory', children: new Set(), size: 0 });
    this.linkParent(value);
  }

  addFile(value: TransferUri, content: string | Uint8Array, statSize?: number): void {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    this.nodes.set(value.toString(), { type: 'file', bytes, size: statSize ?? bytes.byteLength });
    this.linkParent(value);
  }

  readStored(value: TransferUri): Uint8Array {
    const node = this.nodes.get(value.toString());
    if (!node || node.type !== 'file') {
      throw new Error(`missing stored file ${value.toString()}`);
    }
    return node.bytes;
  }

  async stat(value: TransferUri): Promise<TransferStat> {
    const node = this.nodes.get(value.toString());
    if (!node) {
      throw Object.assign(new Error(`missing ${value.toString()}`), { code: 'FileNotFound' });
    }
    return { type: node.type, size: node.size };
  }

  async readDirectory(value: TransferUri): Promise<readonly [string, TransferFileType][]> {
    const node = this.nodes.get(value.toString());
    if (!node || node.type !== 'directory') {
      throw Object.assign(new Error(`not a directory ${value.toString()}`), { code: 'FileNotFound' });
    }
    return [...node.children].map(name => {
      const child = this.nodes.get(joinUri(value, name).toString());
      return [name, child?.type ?? 'unknown'] as const;
    });
  }

  async readFile(value: TransferUri): Promise<Uint8Array> {
    this.reads.push(value.toString());
    return this.readStored(value);
  }

  async writeFile(value: TransferUri, bytes: Uint8Array): Promise<void> {
    this.writes.push(value.toString());
    if (this.failWritesTo.has(value.toString())) {
      throw new Error(`write failed ${value.toString()}`);
    }
    this.addFile(value, bytes);
  }

  async createDirectory(value: TransferUri): Promise<void> {
    if (!this.nodes.has(value.toString())) {
      this.addDirectory(value);
    }
  }

  async delete(value: TransferUri): Promise<void> {
    this.deletes.push(value.toString());
    this.nodes.delete(value.toString());
  }

  joinPath(base: TransferUri, ...segments: string[]): TransferUri {
    return segments.reduce((current, segment) => joinUri(current, segment), base);
  }

  basename(value: TransferUri): string {
    return value.path.split('/').filter(Boolean).at(-1) ?? '';
  }

  dirname(value: TransferUri): TransferUri {
    const parts = value.path.split('/').filter(Boolean);
    if (parts.length === 0) {
      return value;
    }
    return uri(value.scheme, value.authority, `/${parts.slice(0, -1).join('/')}`);
  }

  private linkParent(value: TransferUri): void {
    const parentPath = value.path.split('/').slice(0, -1).join('/') || '/';
    if (parentPath === value.path) return;
    const parent = uri(value.scheme, value.authority, parentPath);
    const parentNode = this.nodes.get(parent.toString());
    if (parentNode?.type === 'directory') {
      parentNode.children.add(this.basename(value));
    }
  }
}

function joinUri(base: TransferUri, segment: string): TransferUri {
  const prefix = base.path.endsWith('/') ? base.path.slice(0, -1) : base.path;
  return uri(base.scheme, base.authority, `${prefix}/${segment}`);
}

function uri(scheme: string, authority: string, path: string): TransferUri {
  return {
    scheme,
    authority,
    path,
    toString: () => `${scheme}://${authority}${path}`
  };
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
