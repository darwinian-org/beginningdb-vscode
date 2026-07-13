import type * as vscode from 'vscode';

export interface SyncStatusBarView {
  setSynced(): void;
  setSyncing(count: number): void;
  setOffline(): void;
  setAuthRequired(): void;
  setConflicts(count: number): void;
  setPaused(reason: string): void;
}

export class SyncStatusBar implements SyncStatusBarView {
  constructor(private readonly item: vscode.StatusBarItem) {
    this.item.show();
    this.setSynced();
  }

  setSynced(): void {
    this.item.text = 'BeginningDB: Synced';
    this.item.tooltip = 'BeginningDB mirror is up to date';
  }

  setSyncing(count: number): void {
    this.item.text = `BeginningDB: Syncing ${count} file${count === 1 ? '' : 's'}`;
    this.item.tooltip = 'BeginningDB mirror sync is running';
  }

  setOffline(): void {
    this.item.text = 'BeginningDB: Offline';
    this.item.tooltip = 'BeginningDB backend is unavailable';
  }

  setAuthRequired(): void {
    this.item.text = 'BeginningDB: Auth required';
    this.item.tooltip = 'Sign in again to access BeginningDB';
  }

  setConflicts(count: number): void {
    this.item.text = `BeginningDB: ${count} conflict${count === 1 ? '' : 's'}`;
    this.item.tooltip = 'Resolve mirror conflicts';
  }

  setPaused(reason: string): void {
    this.item.text = 'BeginningDB: Paused';
    this.item.tooltip = reason;
  }

  dispose(): void {
    this.item.dispose();
  }
}
