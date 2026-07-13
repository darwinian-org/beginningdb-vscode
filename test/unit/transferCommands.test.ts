import { describe, expect, it, vi } from 'vitest';
import {
  createTransferCommandHandlers,
  type TransferCommandDeps,
  type TransferCommandUi
} from '../../src/transfer/transferCommandsCore';
import type { TransferSummary, TransferUri } from '../../src/transfer/transferTypes';

describe('transfer command handlers', () => {
  it('uploads selected local resources to the chosen cloud profile root', async () => {
    const transfer = vi.fn(async () => completedSummary());
    const handlers = createTransferCommandHandlers(baseDeps({ transfer }));
    const source = uri('file', '', '/Users/test/project/README.md');

    await handlers.uploadToCloud(source);

    expect(transfer).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [source],
        destination: expect.objectContaining({ scheme: 'bgdbfs', authority: 'team-a', path: '/' }),
        mode: 'copy',
        conflictPolicy: 'ask',
        preserveTree: true
      }),
      expect.anything()
    );
  });

  it('downloads selected cloud resources to a chosen local folder', async () => {
    const transfer = vi.fn(async () => completedSummary());
    const handlers = createTransferCommandHandlers(baseDeps({ transfer }));
    const source = uri('bgdbfs', 'team-a', '/docs/a.txt');

    await handlers.downloadToLocal(source);

    expect(transfer).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [source],
        destination: expect.objectContaining({ scheme: 'file', path: '/Users/test/downloads' }),
        mode: 'copy',
        conflictPolicy: 'ask',
        preserveTree: true
      }),
      expect.anything()
    );
  });

  it('does not start a transfer when destination selection is cancelled', async () => {
    const transfer = vi.fn();
    const handlers = createTransferCommandHandlers(
      baseDeps({
        transfer,
        showOpenDialog: vi.fn(async () => undefined)
      })
    );

    await handlers.downloadToLocal(uri('bgdbfs', 'team-a', '/docs/a.txt'));

    expect(transfer).not.toHaveBeenCalled();
  });
});

function baseDeps(overrides: {
  transfer?: TransferCommandDeps['transfer'];
  showOpenDialog?: TransferCommandUi['showOpenDialog'];
} = {}): TransferCommandDeps {
  return {
    profiles: {
      listProfiles: vi.fn(async () => [
        {
          id: 'team-a',
          label: 'Team A',
          mode: 'beginningdb.gateway' as const,
          gatewayUrl: 'https://gateway.example.com',
          filesystemId: 'fs-1',
          pathPrefix: '/'
        }
      ])
    },
    transfer: overrides.transfer ?? vi.fn(async () => completedSummary()),
    settings: {
      defaultConflictPolicy: 'ask' as const,
      maxFileSizeBytes: 100_000_000
    },
    ui: {
      showOpenDialog: overrides.showOpenDialog ?? vi.fn(async () => [uri('file', '', '/Users/test/downloads')]),
      showQuickPick: vi.fn(async items => items[0]),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      withProgress: vi.fn(async (_options, task) => task({ isCancellationRequested: false }))
    },
    workspaceApi: {
      uriFromParts: ({ scheme, authority, path }: { scheme: string; authority: string; path: string }) =>
        uri(scheme, authority, path),
      fileUri: (path: string) => uri('file', '', path)
    },
    logger: {
      info: vi.fn(),
      error: vi.fn()
    }
  };
}

function completedSummary(): TransferSummary {
  return {
    jobId: 'test-transfer',
    status: 'completed',
    copied: 1,
    moved: 0,
    skipped: 0,
    overwritten: 0,
    renamed: 0,
    failed: 0,
    errors: []
  };
}

function uri(scheme: string, authority: string, path: string): TransferUri {
  return {
    scheme,
    authority,
    path,
    fsPath: scheme === 'file' ? path : undefined,
    toString: () => `${scheme}://${authority}${path}`
  };
}
