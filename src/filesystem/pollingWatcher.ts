import type { VfsBackendClient } from '../backend/vfsBackendClient';

type WatchEvent = { path: string; type: 'created' | 'changed' | 'deleted' };

export class PollingWatcher {
  constructor(
    private readonly client: VfsBackendClient,
    private readonly pollIntervalMs: number
  ) {}

  watch(path: string, onEvents: (events: WatchEvent[]) => void): { dispose(): void } {
    let disposed = false;
    let previous = new Map<string, string>();

    const poll = async () => {
      if (disposed) return;
      const next = new Map<string, string>();
      const entries = await this.client.readDirectory(path);
      const events: WatchEvent[] = [];
      for (const entry of entries) {
        const key = `${entry.kind}:${entry.size}:${entry.mtimeMs}:${entry.version}`;
        next.set(entry.path, key);
        const before = previous.get(entry.path);
        if (!before) {
          events.push({ path: entry.path, type: 'created' });
        } else if (before !== key) {
          events.push({ path: entry.path, type: 'changed' });
        }
      }
      for (const oldPath of previous.keys()) {
        if (!next.has(oldPath)) {
          events.push({ path: oldPath, type: 'deleted' });
        }
      }
      previous = next;
      if (events.length > 0) {
        onEvents(events);
      }
      if (!disposed) {
        setTimeout(() => void poll(), this.pollIntervalMs);
      }
    };

    void poll();

    return {
      dispose() {
        disposed = true;
      }
    };
  }
}
