import { describe, expect, it, vi } from 'vitest';
import { SyncStatusBar } from '../../src/ui/statusBar';

describe('SyncStatusBar', () => {
  it('renders sync states as human-readable text', () => {
    const item = { text: '', tooltip: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
    const bar = new SyncStatusBar(item as any);

    bar.setSynced();
    expect(item.text).toContain('Synced');

    bar.setSyncing(3);
    expect(item.text).toContain('Syncing 3');

    bar.setOffline();
    expect(item.text).toContain('Offline');
  });
});
