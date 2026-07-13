import type * as vscode from 'vscode';

export interface SyncLogSink {
  info(message: string): void;
  error(message: string): void;
}

export class SyncLog implements SyncLogSink {
  constructor(private readonly output: vscode.OutputChannel) {}

  info(message: string): void {
    this.output.appendLine(`[info] ${message}`);
  }

  error(message: string): void {
    this.output.appendLine(`[error] ${message}`);
  }

  show(): void {
    this.output.show(true);
  }

  dispose(): void {
    this.output.dispose();
  }
}
