import type { BeginningDbClientResolver } from '../beginningdb/clientRegistry';
import { BeginningDbError } from '../beginningdb/errors';
import { readMirrorManifest, MirrorManager } from './mirrorManager';
import type { SyncStatusBarView } from '../ui/statusBar';
import type { SyncLogSink } from '../ui/syncLog';
import { ControlPlaneError } from '../controlPlane/types';

interface MirrorSyncServiceOptions {
  resolver: BeginningDbClientResolver;
  statusBar: SyncStatusBarView;
  syncLog: SyncLogSink;
  workspacePath: () => string | undefined;
  managerFactory?: (
    client: any
  ) => Pick<MirrorManager, 'syncLocalChanges' | 'syncRemoteChanges'>;
}

export class MirrorSyncService {
  private timer: NodeJS.Timeout | undefined;
  private syncing = false;
  activeProfileId?: string;

  constructor(private readonly options: MirrorSyncServiceOptions) {}

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.syncNow(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async syncNow(): Promise<void> {
    if (this.syncing) return;
    const workspacePath = this.options.workspacePath();
    if (!workspacePath) return;

    let manifest;
    try {
      manifest = await readMirrorManifest(workspacePath);
    } catch {
      return;
    }
    if (!manifest.profileId) return;
    this.activeProfileId = manifest.profileId;

    this.syncing = true;
    this.options.statusBar.setSyncing(1);
    let resolvedAuth:
      | {
          kind: 'delegated-vfs';
          canRefresh: boolean;
          strategy?: 'manual-token' | 'managed-session' | 'dispatch-session';
        }
      | undefined;
    try {
      const resolved = await this.options.resolver.resolve({
        scheme: 'bgdbfs',
        authority: manifest.profileId,
        path: '/'
      } as any);
      resolvedAuth = resolved.auth;
      const manager =
        this.options.managerFactory?.(resolved.client) ?? new MirrorManager(resolved.client);
      const local = await manager.syncLocalChanges(workspacePath);
      const remote = await manager.syncRemoteChanges(workspacePath);
      if (remote.conflicts > 0) {
        this.options.statusBar.setConflicts(remote.conflicts);
      } else {
        this.options.statusBar.setSynced();
      }
      this.options.syncLog.info(
        `Synced mirror ${manifest.profileId} (uploaded ${local.uploaded}, deleted ${local.deleted}, downloaded ${remote.downloaded}, conflicts ${remote.conflicts})`
      );
    } catch (error) {
      if (error instanceof ControlPlaneError) {
        this.options.statusBar.setPaused(error.details.kind);
      } else if (error instanceof BeginningDbError && error.kind === 'unauthorized') {
        this.options.statusBar.setAuthRequired();
        if (
          resolvedAuth?.kind === 'delegated-vfs' &&
          resolvedAuth.canRefresh === false &&
          resolvedAuth.strategy === 'manual-token'
        ) {
          this.options.syncLog.error(
            `Imported delegated token expired for mirror ${manifest.profileId}. Re-run bgng ide login for this gateway profile.`
          );
        }
      } else {
        this.options.statusBar.setOffline();
      }
      this.options.syncLog.error(error instanceof Error ? error.message : String(error));
    } finally {
      this.syncing = false;
    }
  }

  dispose(): void {
    this.stop();
  }
}
