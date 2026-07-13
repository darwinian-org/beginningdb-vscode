import type { TransferUri } from './transferTypes';

export const TRANSFER_TREE_MIME = 'application/vnd.code.tree.beginningdb.transfer';

export type TransferDropRoute =
  | {
      kind: 'command';
      command: 'beginningdb.uploadToCloud' | 'beginningdb.downloadToLocal';
      sources: TransferUri[];
      destination: TransferUri;
    }
  | {
      kind: 'error';
      message: string;
    };

export function parseUriList<TUri extends TransferUri>(
  value: string,
  parseUri: (value: string) => TUri
): TUri[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(parseUri);
}

export function routeTransferDrop(
  target: TransferUri | undefined,
  sources: TransferUri[]
): TransferDropRoute {
  if (!target) {
    return { kind: 'error', message: 'Drop files onto a local or BeginningDB root.' };
  }
  if (sources.length === 0) {
    return { kind: 'error', message: 'No supported file URIs were found in the drop.' };
  }
  if (target.scheme === 'bgdbfs' && sources.every(source => source.scheme === 'file')) {
    return {
      kind: 'command',
      command: 'beginningdb.uploadToCloud',
      sources,
      destination: target
    };
  }
  if (target.scheme === 'file' && sources.every(source => source.scheme === 'bgdbfs')) {
    return {
      kind: 'command',
      command: 'beginningdb.downloadToLocal',
      sources,
      destination: target
    };
  }
  return {
    kind: 'error',
    message: 'Drop local files onto BeginningDB roots, or BeginningDB files onto local roots.'
  };
}
