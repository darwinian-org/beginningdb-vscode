import { BeginningDbError, type BeginningDbErrorKind } from './errors';
import type {
  BeginningDbDirEntry,
  BeginningDbKind,
  BeginningDbSearchFileResult,
  BeginningDbSearchMode,
  BeginningDbSearchOptions,
  BeginningDbSearchResponse,
  BeginningDbStat,
  ChangeSet,
  DeleteOptions,
  RenameOptions,
  WriteOptions
} from './types';
import type { VfsBackendClient } from '../backend/vfsBackendClient';

export interface HttpBeginningDbClientOptions {
  baseUrl: string;
  tenantId: number;
  token?: string;
}

export class HttpBeginningDbClient implements VfsBackendClient {
  constructor(private readonly options: HttpBeginningDbClientOptions) {}

  async stat(path: string): Promise<BeginningDbStat> {
    const response = await this.request('GET', `/v1/stat${path}`);
    return statFromJson(await response.json(), response.headers);
  }

  async readDirectory(path: string): Promise<BeginningDbDirEntry[]> {
    const response = await this.request('PROPFIND', `/v1/fs${path}`);
    const json = asRecord(await response.json());
    const entries = Array.isArray(json.entries) ? json.entries : [];
    return entries.map((entry: unknown) => dirEntryFromJson(entry));
  }

  async readFile(path: string): Promise<Uint8Array> {
    const response = await this.request('GET', `/v1/fs${path}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async writeFile(
    path: string,
    content: Uint8Array,
    options: WriteOptions
  ): Promise<BeginningDbStat | undefined> {
    const headers = new Headers();
    applyWriteHeaders(headers, options);

    const response = await this.request('PUT', `/v1/fs${path}`, {
      body: content,
      headers
    });

    if (response.headers.get('content-type')?.includes('application/json')) {
      return statFromJson(await response.json(), response.headers);
    }
    return undefined;
  }

  async createDirectory(path: string): Promise<void> {
    await this.request('MKCOL', `/v1/fs${path}`);
  }

  async delete(path: string, options: DeleteOptions): Promise<void> {
    const headers = new Headers();
    if (options.ifMatch) {
      headers.set('if-match', options.ifMatch);
    }
    await this.request('DELETE', `/v1/fs${path}`, { headers });
  }

  async rename(source: string, target: string, options: RenameOptions): Promise<void> {
    const headers = new Headers();
    headers.set('destination', `/v1/fs${target}`);
    if (options.ifMatch) {
      headers.set('if-match', options.ifMatch);
    }
    await this.request('MOVE', `/v1/fs${source}`, { headers });
  }

  async search(query: string, pathPrefix?: string): Promise<string[]> {
    const params = new URLSearchParams({ q: query });
    if (pathPrefix) {
      params.set('path_prefix', pathPrefix);
    }
    const response = await this.request('POST', `/v1/search?${params.toString()}`);
    const json = asRecord(await response.json());
    return Array.isArray(json.results)
      ? json.results.filter((result): result is string => typeof result === 'string')
      : [];
  }

  async searchFiles(
    query: string,
    pathPrefix?: string,
    options: BeginningDbSearchOptions = {}
  ): Promise<BeginningDbSearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (pathPrefix) {
      params.set('path_prefix', pathPrefix);
    }
    if (options.mode) {
      params.set('mode', options.mode);
    }
    params.set('result_shape', options.resultShape ?? 'files');
    if (typeof options.limit === 'number') {
      params.set('limit', String(options.limit));
    }
    if (typeof options.offset === 'number') {
      params.set('offset', String(options.offset));
    }
    if (typeof options.includeSnippets === 'boolean') {
      params.set('include_snippets', String(options.includeSnippets));
    }
    const response = await this.request('POST', `/v1/search?${params.toString()}`);
    return searchResponseFromJson(await response.json());
  }

  async listChanges(pathPrefix: string, cursor: number): Promise<ChangeSet> {
    const params = new URLSearchParams({
      path_prefix: pathPrefix,
      cursor: String(cursor)
    });
    const response = await this.request('GET', `/v1/changes?${params.toString()}`);
    const json = asRecord(await response.json());
    return {
      cursor: requiredNumber(json.cursor, 'cursor'),
      changes: Array.isArray(json.changes)
        ? json.changes.map(change => {
            const record = asRecord(change);
            const type = stringValue(record.type);
            if (type !== 'changed' && type !== 'deleted' && type !== 'created') {
              throw new Error('BeginningDB response missing valid change type');
            }
            return {
              seq: requiredNumber(record.seq, 'seq'),
              path: requiredString(record.path, 'path'),
              kind: requiredKind(record.kind),
              type
            };
          })
        : []
    };
  }

  async capabilities() {
    return {
      binaryWrite: true,
      rename: true,
      streamingUpload: false,
      streamingDownload: false
    };
  }

  private async request(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('x-tenant-id', String(this.options.tenantId));
    if (this.options.token) {
      headers.set('authorization', `Bearer ${this.options.token}`);
    }

    const response = await fetch(new URL(path, this.options.baseUrl), {
      ...init,
      method,
      headers
    });

    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    return response;
  }
}

function applyWriteHeaders(headers: Headers, options: WriteOptions): void {
  if (options.ifMatch) {
    headers.set('if-match', options.ifMatch);
  }
  if (options.create && !options.overwrite) {
    headers.set('if-none-match', '*');
  }
}

function statFromJson(json: unknown, headers: Headers): BeginningDbStat {
  const record = asRecord(json);
  const etag = stringValue(record.etag) ?? headers.get('etag') ?? undefined;
  const stat: BeginningDbStat = {
    path: requiredString(record.path, 'path'),
    kind: requiredKind(record.kind),
    size: requiredNumber(record.size, 'size'),
    mtimeMs: requiredNumber(record.mtime_ms, 'mtime_ms'),
    version: requiredNumber(record.version, 'version'),
    inodeId: requiredNumber(record.inode_id, 'inode_id')
  };
  if (etag) {
    stat.etag = etag;
  }
  return stat;
}

function dirEntryFromJson(json: unknown): BeginningDbDirEntry {
  const record = asRecord(json);
  const stat = statFromJson(
    {
      ...record,
      path: stringValue(record.path) ?? stringValue(record.name) ?? '',
    },
    new Headers()
  );
  return {
    ...stat,
    name: requiredString(record.name, 'name')
  };
}

function searchResponseFromJson(json: unknown): BeginningDbSearchResponse {
  const record = asRecord(json);
  const results = Array.isArray(record.results)
    ? record.results.map(searchResultFromJson)
    : [];
  const indexFreshness = indexFreshnessFromJson(record.index_freshness);
  return {
    results,
    ...(indexFreshness ? { indexFreshness } : {})
  };
}

function searchResultFromJson(json: unknown): BeginningDbSearchFileResult {
  if (typeof json === 'string') {
    return { path: json };
  }
  const record = asRecord(json);
  const kind = optionalKind(record.kind);
  const mode = optionalSearchMode(record.mode);
  const placements = Array.isArray(record.placements)
    ? record.placements.filter((placement): placement is string => typeof placement === 'string')
    : undefined;
  const snippet = snippetFromJson(record.snippet);
  return {
    path: requiredString(record.path, 'path'),
    ...(kind ? { kind } : {}),
    ...(typeof record.inode_id === 'number' ? { inodeId: record.inode_id } : {}),
    ...(typeof record.resource === 'string' ? { resource: record.resource } : {}),
    ...(placements ? { placements } : {}),
    ...(mode ? { mode } : {}),
    ...(typeof record.score === 'number' ? { score: record.score } : {}),
    ...(typeof record.score_kind === 'string' ? { scoreKind: record.score_kind } : {}),
    ...(isObjectRecord(record.score_breakdown) ? { scoreBreakdown: record.score_breakdown } : {}),
    ...(snippet ? { snippet } : {})
  };
}

function indexFreshnessFromJson(value: unknown): BeginningDbSearchResponse['indexFreshness'] {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  return {
    ...(typeof record.ready === 'boolean' ? { ready: record.ready } : {}),
    ...(typeof record.pending_wal_entries === 'number' ? { pendingWalEntries: record.pending_wal_entries } : {}),
    ...(typeof record.indexed_docs === 'number' ? { indexedDocs: record.indexed_docs } : {})
  };
}

function snippetFromJson(value: unknown): BeginningDbSearchFileResult['snippet'] {
  const record = asRecord(value);
  const text = stringValue(record.text);
  if (!text) {
    return undefined;
  }
  const matchRanges = Array.isArray(record.match_ranges)
    ? record.match_ranges
        .map(range => {
          const rangeRecord = asRecord(range);
          return typeof rangeRecord.start === 'number' && typeof rangeRecord.end === 'number'
            ? { start: rangeRecord.start, end: rangeRecord.end }
            : undefined;
        })
        .filter((range): range is { start: number; end: number } => Boolean(range))
    : undefined;
  return {
    text,
    ...(matchRanges ? { matchRanges } : {})
  };
}

function optionalKind(value: unknown): BeginningDbKind | undefined {
  return value === 'file' || value === 'dir' || value === 'symlink' ? value : undefined;
}

function optionalSearchMode(value: unknown): BeginningDbSearchMode | undefined {
  return value === 'keyword' || value === 'vector' || value === 'hybrid' ? value : undefined;
}

async function errorFromResponse(response: Response): Promise<BeginningDbError> {
  const retryAfterMs = retryAfterToMs(response.headers.get('retry-after'));
  let code: BeginningDbErrorKind = kindFromStatus(response.status);
  let message = response.statusText || 'BeginningDB request failed';

  try {
    const json = await response.json();
    const error = asRecord(asRecord(json).error ?? json);
    code = normalizeErrorKind(stringValue(error.code) ?? code);
    message = stringValue(error.message) ?? message;
  } catch {
    // Non-JSON error bodies still map by HTTP status.
  }

  return new BeginningDbError(code, message, response.status, retryAfterMs);
}

function kindFromStatus(status: number): BeginningDbErrorKind {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'permission_denied';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 412:
      return 'precondition_failed';
    case 413:
      return 'quota_exceeded';
    case 429:
      return 'rate_limited';
    case 503:
      return 'unavailable';
    default:
      return 'unknown';
  }
}

function normalizeErrorKind(value: string): BeginningDbErrorKind {
  const allowed = new Set<BeginningDbErrorKind>([
    'not_found',
    'already_exists',
    'permission_denied',
    'conflict',
    'precondition_failed',
    'quota_exceeded',
    'rate_limited',
    'unavailable',
    'unauthorized',
    'bad_request',
    'unknown'
  ]);
  return allowed.has(value as BeginningDbErrorKind) ? (value as BeginningDbErrorKind) : 'unknown';
}

function retryAfterToMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`BeginningDB response missing string field: ${field}`);
  }
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') {
    throw new Error(`BeginningDB response missing number field: ${field}`);
  }
  return value;
}

function requiredKind(value: unknown): BeginningDbKind {
  if (value === 'file' || value === 'dir' || value === 'symlink') {
    return value;
  }
  throw new Error('BeginningDB response missing valid kind field');
}
