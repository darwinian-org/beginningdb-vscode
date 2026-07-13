import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PollingWatcher } from '../../src/filesystem/pollingWatcher';
import type { VfsBackendClient } from '../../src/backend/vfsBackendClient';

describe('PollingWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits created and changed events for directory deltas', async () => {
    const client = new WatchClient([
      [{ name: 'a.txt', path: '/docs/a.txt', kind: 'file', size: 1, mtimeMs: 1, version: 1, inodeId: 1 }],
      [{ name: 'a.txt', path: '/docs/a.txt', kind: 'file', size: 2, mtimeMs: 2, version: 2, inodeId: 1 }],
      [{ name: 'a.txt', path: '/docs/a.txt', kind: 'file', size: 2, mtimeMs: 2, version: 2, inodeId: 1 }, { name: 'b.txt', path: '/docs/b.txt', kind: 'file', size: 1, mtimeMs: 3, version: 1, inodeId: 2 }]
    ]);
    const events: Array<Array<{ path: string; type: 'created' | 'changed' | 'deleted' }>> = [];
    const watcher = new PollingWatcher(client, 10);

    const disposable = watcher.watch('/docs', batch => events.push(batch));
    await vi.advanceTimersByTimeAsync(35);
    disposable.dispose();

    expect(events.some(batch => batch.some(event => event.path === '/docs/a.txt' && event.type === 'changed'))).toBe(true);
    expect(events.some(batch => batch.some(event => event.path === '/docs/b.txt' && event.type === 'created'))).toBe(true);
  });

  it('stops polling after disposal', async () => {
    const client = new WatchClient([[], []]);
    const watcher = new PollingWatcher(client, 10);
    const disposable = watcher.watch('/docs', () => {});
    disposable.dispose();
    await vi.advanceTimersByTimeAsync(30);
    expect(client.calls).toBeLessThanOrEqual(1);
  });
});

class WatchClient implements VfsBackendClient {
  calls = 0;
  constructor(private readonly snapshots: Array<any[]>) {}
  async readDirectory() {
    const value = this.snapshots[Math.min(this.calls, this.snapshots.length - 1)] ?? [];
    this.calls += 1;
    return value;
  }
  async stat(path: string) { return { path, kind: 'dir' as const, size: 0, mtimeMs: 0, version: 0, inodeId: 0 }; }
  async readFile() { return new Uint8Array(); }
  async writeFile() { return undefined; }
  async createDirectory() {}
  async delete() {}
  async rename() {}
  async search() { return []; }
}
