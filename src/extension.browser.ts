import * as vscode from 'vscode';
import { BeginningDbClientResolver } from './beginningdb/clientRegistry';
import { HttpCredentialProvider } from './controlPlane/httpCredentialProvider';
import { ProfileProvider } from './controlPlane/profileProvider';
import { BeginningDbFileSystemProvider } from './filesystem/beginningDbFileSystemProvider';
import { registerWebCommands } from './ui/webCommands';

export function activate(context: vscode.ExtensionContext) {
  try {
    activateBrowser(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`BeginningDB browser activation failed: ${message}`);
    throw new Error(`BeginningDB browser activation failed: ${message}`);
  }
}

function activateBrowser(context: vscode.ExtensionContext) {
  const configuration = vscode.workspace.getConfiguration('beginningdb');
  const configuredEndpoint = configuration.get<string>('credentialsEndpoint');
  const configuredSecret = configuration.get<string>('credentialsSecret');
  const endpoint = configuredEndpoint && configuredEndpoint.length > 0
    ? configuredEndpoint
    : defaultCredentialsEndpoint();
  const profiles = new ProfileProvider(
    new HttpCredentialProvider({
      endpoint,
      ...(configuredSecret ? { secret: configuredSecret } : {})
    })
  );
  const resolver = new BeginningDbClientResolver(profiles);
  const provider = new BeginningDbFileSystemProvider(resolver);

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('bgdbfs', provider, {
      isCaseSensitive: true,
      isReadonly: false
    })
  );

  registerWebCommands(context, profiles);
  void vscode.commands.executeCommand('setContext', 'beginningdb.runtime', 'web');
  void vscode.commands.executeCommand('setContext', 'beginningdb.mirrorSupported', false);
}

export function deactivate() {}

function defaultCredentialsEndpoint(): string {
  const browserGlobal = globalThis as typeof globalThis & {
    location?: { origin?: string };
  };
  if (browserGlobal.location?.origin) {
    return browserGlobal.location.origin;
  }
  return 'http://127.0.0.1';
}
