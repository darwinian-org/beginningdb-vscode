import { afterEach, describe, expect, it, vi } from 'vitest';
import { BeginningDbError } from '../../src/beginningdb/errors';
import { HttpBeginningDbClient } from '../../src/beginningdb/client';

const BASE_URL = 'http://127.0.0.1:8080';

describe('HttpBeginningDbClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps stat JSON and ETag headers', async () => {
    stubFetch(
      jsonResponse(
        {
          path: '/docs/a.txt',
          kind: 'file',
          size: 5,
          mtime_ms: 123,
          version: 7,
          inode_id: 42
        },
        { etag: '"42:7"' }
      )
    );

    const client = clientWithToken();
    const stat = await client.stat('/docs/a.txt');

    expect(stat).toEqual({
      path: '/docs/a.txt',
      kind: 'file',
      size: 5,
      mtimeMs: 123,
      version: 7,
      inodeId: 42,
      etag: '"42:7"'
    });
  });

  it('maps directory entries', async () => {
    stubFetch(
      jsonResponse({
        entries: [
          {
            name: 'a.txt',
            path: '/docs/a.txt',
            kind: 'file',
            size: 5,
            mtime_ms: 123,
            version: 1,
            inode_id: 2,
            etag: '"2:1"'
          }
        ]
      })
    );

    await expect(clientWithToken().readDirectory('/docs')).resolves.toEqual([
      {
        name: 'a.txt',
        path: '/docs/a.txt',
        kind: 'file',
        size: 5,
        mtimeMs: 123,
        version: 1,
        inodeId: 2,
        etag: '"2:1"'
      }
    ]);
  });

  it('reads file bytes', async () => {
    stubFetch(new Response('hello', { status: 200 }));

    const bytes = await clientWithToken().readFile('/docs/a.txt');

    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });

  it('sends conditional write headers', async () => {
    const fetch = stubFetch(new Response(null, { status: 201 }));

    await clientWithToken().writeFile('/docs/a.txt', new TextEncoder().encode('hello'), {
      create: true,
      overwrite: false,
      ifMatch: '"opaque,validator:with!symbols"'
    });

    const [, init] = fetch.mock.calls[0]!;
    const headers = init?.headers as Headers;
    expect(headers.get('if-match')).toBe('"opaque,validator:with!symbols"');
    expect(headers.get('if-none-match')).toBe('*');
    expect(headers.get('authorization')).toBe('Bearer token');
    expect(headers.get('x-tenant-id')).toBe('7');
  });

  it('maps a full stat-shaped write receipt from BeginningDB', async () => {
    stubFetch(
      jsonResponse(
        {
          path: '/docs/a.txt',
          kind: 'file',
          size: 5,
          mtime_ms: 1770000000123,
          version: 8,
          inode_id: 42,
          etag: '"42:8"'
        },
        { etag: '"42:8"' },
        200
      )
    );

    await expect(
      clientWithToken().writeFile('/docs/a.txt', new TextEncoder().encode('hello'), {
        create: false,
        overwrite: true,
        ifMatch: '"42:7"'
      })
    ).resolves.toEqual({
      path: '/docs/a.txt',
      kind: 'file',
      size: 5,
      mtimeMs: 1770000000123,
      version: 8,
      inodeId: 42,
      etag: '"42:8"'
    });
  });

  it('sends MOVE destination headers', async () => {
    const fetch = stubFetch(new Response(null, { status: 204 }));

    await clientWithToken().rename('/docs/a.txt', '/docs/b.txt', {
      overwrite: true,
      ifMatch: '"2:1"'
    });

    const [, init] = fetch.mock.calls[0]!;
    const headers = init?.headers as Headers;
    expect(init?.method).toBe('MOVE');
    expect(headers.get('destination')).toBe('/v1/fs/docs/b.txt');
    expect(headers.get('if-match')).toBe('"2:1"');
  });

  it('maps HTTP errors into typed BeginningDB errors', async () => {
    stubFetch(
      jsonResponse(
        { error: { code: 'precondition_failed', message: 'resource version does not match' } },
        {},
        412
      )
    );

    await expect(clientWithToken().delete('/docs/a.txt', {
      recursive: false,
      ifMatch: '"2:1"'
    })).rejects.toMatchObject({
      kind: 'precondition_failed',
      status: 412,
      retryable: false
    } satisfies Partial<BeginningDbError>);
  });

  it('marks rate limits and unavailable responses as retryable', async () => {
    stubFetch(jsonResponse({ error: { code: 'rate_limited', message: 'slow down' } }, {}, 429));

    await expect(clientWithToken().stat('/docs/a.txt')).rejects.toMatchObject({
      kind: 'rate_limited',
      retryable: true
    } satisfies Partial<BeginningDbError>);
  });

  it('requests change deltas with path prefix and cursor', async () => {
    const fetch = stubFetch(
      jsonResponse({
        cursor: 5,
        changes: [{ seq: 5, path: '/docs/a.txt', kind: 'file', type: 'changed' }]
      })
    );

    const result = await clientWithToken().listChanges?.('/docs', 2);

    const [url] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/v1/changes?');
    expect(String(url)).toContain('path_prefix=%2Fdocs');
    expect(String(url)).toContain('cursor=2');
    expect(result).toEqual({
      cursor: 5,
      changes: [{ seq: 5, path: '/docs/a.txt', kind: 'file', type: 'changed' }]
    });
  });

  it('requests and normalizes structured file search results', async () => {
    const fetch = stubFetch(
      jsonResponse({
        results: [
          {
            path: '/docs/readme.txt',
            kind: 'file',
            inode_id: 42,
            resource: 'file:7:42',
            placements: ['/docs/readme.txt'],
            mode: 'keyword',
            score: 1.25,
            score_kind: 'bm25',
            score_breakdown: { keyword: { bm25: 1.25 } },
            snippet: {
              text: 'hello needle',
              match_ranges: [{ start: 6, end: 12 }]
            }
          }
        ],
        index_freshness: {
          ready: true,
          pending_wal_entries: 0,
          indexed_docs: 1
        }
      })
    );

    const result = await clientWithToken().searchFiles?.('needle', '/docs', {
      mode: 'keyword',
      resultShape: 'files',
      limit: 5,
      offset: 0,
      includeSnippets: true
    });

    expect(result).toEqual({
      results: [
        {
          path: '/docs/readme.txt',
          kind: 'file',
          inodeId: 42,
          resource: 'file:7:42',
          placements: ['/docs/readme.txt'],
          mode: 'keyword',
          score: 1.25,
          scoreKind: 'bm25',
          scoreBreakdown: { keyword: { bm25: 1.25 } },
          snippet: {
            text: 'hello needle',
            matchRanges: [{ start: 6, end: 12 }]
          }
        }
      ],
      indexFreshness: {
        ready: true,
        pendingWalEntries: 0,
        indexedDocs: 1
      }
    });

    const [url] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('/v1/search?');
    expect(String(url)).toContain('q=needle');
    expect(String(url)).toContain('path_prefix=%2Fdocs');
    expect(String(url)).toContain('mode=keyword');
    expect(String(url)).toContain('result_shape=files');
    expect(String(url)).toContain('limit=5');
    expect(String(url)).toContain('offset=0');
    expect(String(url)).toContain('include_snippets=true');
  });

  it('keeps path-array search compatibility when structured search receives legacy results', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: ['/docs/readme.txt'] }))
      .mockResolvedValueOnce(jsonResponse({ results: ['/docs/readme.txt'] }));
    vi.stubGlobal('fetch', fetch);

    await expect(clientWithToken().searchFiles?.('needle', '/docs')).resolves.toEqual({
      results: [{ path: '/docs/readme.txt' }]
    });
    await expect(clientWithToken().search('needle', '/docs')).resolves.toEqual(['/docs/readme.txt']);
  });
});

function clientWithToken() {
  return new HttpBeginningDbClient({
    baseUrl: BASE_URL,
    tenantId: 7,
    token: 'token'
  });
}

function stubFetch(response: Response) {
  const fetch = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers
    }
  });
}
