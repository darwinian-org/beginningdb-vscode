import { describe, expect, it } from 'vitest';
import {
  parseUriList,
  routeTransferDrop,
  TRANSFER_TREE_MIME
} from '../../src/transfer/transferDnd';
import type { TransferUri } from '../../src/transfer/transferTypes';

describe('transfer drag/drop routing', () => {
  it('uses the canonical transfer tree MIME type', () => {
    expect(TRANSFER_TREE_MIME).toBe('application/vnd.code.tree.beginningdb.transfer');
  });

  it('parses text/uri-list data while ignoring comments and blank lines', () => {
    expect(parseUriList('file:///tmp/a.txt\r\n# comment\n\nbgdbfs://team-a/docs/b.txt', parseUri)).toEqual([
      expect.objectContaining({ scheme: 'file', path: '/tmp/a.txt' }),
      expect.objectContaining({ scheme: 'bgdbfs', authority: 'team-a', path: '/docs/b.txt' })
    ]);
  });

  it('routes local drops onto cloud targets to upload', () => {
    const target = uri('bgdbfs', 'team-a', '/uploads');
    const source = uri('file', '', '/Users/test/a.txt');

    expect(routeTransferDrop(target, [source])).toEqual({
      kind: 'command',
      command: 'beginningdb.uploadToCloud',
      sources: [source],
      destination: target
    });
  });

  it('routes cloud drops onto local targets to download', () => {
    const target = uri('file', '', '/Users/test/downloads');
    const source = uri('bgdbfs', 'team-a', '/docs/a.txt');

    expect(routeTransferDrop(target, [source])).toEqual({
      kind: 'command',
      command: 'beginningdb.downloadToLocal',
      sources: [source],
      destination: target
    });
  });

  it('rejects missing targets, empty sources, and unsupported mixed drops', () => {
    expect(routeTransferDrop(undefined, [uri('file', '', '/tmp/a.txt')])).toMatchObject({
      kind: 'error'
    });
    expect(routeTransferDrop(uri('bgdbfs', 'team-a', '/'), [])).toMatchObject({
      kind: 'error'
    });
    expect(routeTransferDrop(uri('bgdbfs', 'team-a', '/'), [
      uri('file', '', '/tmp/a.txt'),
      uri('bgdbfs', 'team-a', '/docs/b.txt')
    ])).toMatchObject({
      kind: 'error'
    });
  });
});

function parseUri(value: string): TransferUri {
  const parsed = new URL(value);
  return uri(parsed.protocol.replace(/:$/, ''), parsed.hostname, parsed.pathname || '/');
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
