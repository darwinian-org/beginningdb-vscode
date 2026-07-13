import type * as vscode from 'vscode';

export class SecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  get(key: string): Thenable<string | undefined> {
    return this.secrets.get(key);
  }

  store(key: string, value: string): Thenable<void> {
    return this.secrets.store(key, value);
  }

  delete(key: string): Thenable<void> {
    return this.secrets.delete(key);
  }
}
