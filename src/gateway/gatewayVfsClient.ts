import { BeginningDbError } from '../beginningdb/errors';
import type {
  BeginningDbDirEntry,
  BeginningDbSearchFileResult,
  BeginningDbSearchMode,
  BeginningDbSearchOptions,
  BeginningDbSearchResponse,
  BeginningDbStat,
  ChangeSet,
  DeleteOptions,
  RenameOptions,
  WriteOptions
} from '../beginningdb/types';
import type { VfsBackendCapabilities, VfsBackendClient } from '../backend/vfsBackendClient';
import { normalizeLogicalPath } from '../filesystem/uri';
import { bytesFromBase64, bytesToBase64 } from '../shared/base64';

export interface GatewayVfsClientOptions {
  gatewayUrl: string;
  workspaceId?: string;
  filesystemId: string;
  getDelegatedAuth: () => Promise<{ token: string; canRefresh: boolean }>;
  refreshDelegatedAuth?: () => Promise<{ token: string; canRefresh: boolean }>;
}

interface GatewayCapabilities extends VfsBackendCapabilities {
  surface: 'gateway-worker' | 'legacy-paths';
  legacyPaths: boolean;
  changes: boolean;
  search: boolean;
}

export class GatewayVfsClient implements VfsBackendClient {
  private capabilitiesPromise?: Promise<GatewayCapabilities>;

  constructor(private readonly options: GatewayVfsClientOptions) {}

  async stat(path: string): Promise<BeginningDbStat> {
    const normalizedPath = normalizeLogicalPath(path);
    const json = await this.requestJson(
      '/v1/storage/stat',
      { path: normalizedPath },
      '/v1/paths/stat',
      { path: normalizedPath }
    );
    return statFromGateway(json);
  }

  async readDirectory(path: string): Promise<BeginningDbDirEntry[]> {
    const normalizedPath = normalizeLogicalPath(path);
    const json = await this.requestJson(
      '/v1/storage/list',
      { path: normalizedPath },
      '/v1/paths/ls',
      { path: normalizedPath }
    );
    const record = asRecord(json);
    const entries: unknown[] | undefined = Array.isArray(json)
      ? json
      : Array.isArray(record.entries)
        ? record.entries
        : undefined;
    if (!entries) {
      throw new BeginningDbError('unknown', 'Gateway list response was malformed');
    }
    return entries.map(entry => entryFromGateway(entry, normalizedPath));
  }

  async readFile(path: string): Promise<Uint8Array> {
    const normalizedPath = normalizeLogicalPath(path);
    const capabilities = await this.capabilities();
    if (capabilities.legacyPaths) {
      return bytesFromGatewayContent(
        await this.requestJson('/v1/paths/cat', { path: normalizedPath })
      );
    }
    return bytesFromGatewayContent(
      await this.requestJson(
        '/v1/storage/read',
        { path: normalizedPath },
        '/v1/paths/cat',
        { path: normalizedPath }
      )
    );
  }

  async writeFile(
    path: string,
    content: Uint8Array,
    _options: WriteOptions
  ): Promise<BeginningDbStat | undefined> {
    const normalizedPath = normalizeLogicalPath(path);
    if (isUtf8(content)) {
      const text = new TextDecoder().decode(content);
      await this.requestJson(
        '/v1/storage/write',
        { path: normalizedPath, content: text },
        '/v1/paths/write',
        { path: normalizedPath, content: text }
      );
      return undefined;
    }

    const capabilities = await this.capabilities();
    if (!capabilities.binaryWrite) {
      throw new BeginningDbError(
        'bad_request',
        'Gateway mode currently supports UTF-8 text writes only'
      );
    }

    const base64Content = bytesToBase64(content);
    await this.requestJson(
      '/v1/storage/write',
      { path: normalizedPath, content: base64Content, contentEncoding: 'base64' },
      '/v1/paths/write',
      { path: normalizedPath, content: base64Content, contentEncoding: 'base64' }
    );
    return undefined;
  }

  async createDirectory(path: string): Promise<void> {
    const normalizedPath = normalizeLogicalPath(path);
    await this.requestJson(
      '/v1/storage/mkdir',
      { path: normalizedPath },
      '/v1/paths/mkdir',
      { path: normalizedPath }
    );
  }

  async delete(path: string, _options: DeleteOptions): Promise<void> {
    const normalizedPath = normalizeLogicalPath(path);
    await this.requestJson(
      '/v1/storage/delete',
      { path: normalizedPath },
      '/v1/paths/rm',
      { path: normalizedPath }
    );
  }

  async rename(source: string, target: string, _options: RenameOptions): Promise<void> {
    const capabilities = await this.capabilities();
    if (!capabilities.rename) {
      throw new BeginningDbError('bad_request', 'Gateway mode does not yet support rename');
    }
    const fromPath = normalizeLogicalPath(source);
    const toPath = normalizeLogicalPath(target);
    await this.requestJson(
      '/v1/storage/rename',
      { fromPath, toPath },
      '/v1/paths/rename',
      { source: fromPath, target: toPath }
    );
  }

  async search(query: string, pathPrefix = '/'): Promise<string[]> {
    const capabilities = await this.capabilities();
    if (!capabilities.search) {
      return [];
    }
    const normalizedPathPrefix = normalizeLogicalPath(pathPrefix);
    const json = await this.requestJson(
      '/v1/search/query',
      { pathPrefix: normalizedPathPrefix, query },
      '/v1/paths/search',
      { path: normalizedPathPrefix, query }
    );
    const record = asRecord(json);
    return Array.isArray(record.results)
      ? record.results
        .filter((value): value is string => typeof value === 'string')
        .map(path => this.toLogicalPath(path))
      : [];
  }

  async searchFiles(
    query: string,
    pathPrefix = '/',
    options: BeginningDbSearchOptions = {}
  ): Promise<BeginningDbSearchResponse> {
    const capabilities = await this.capabilities();
    if (!capabilities.search) {
      return { results: [] };
    }
    const normalizedPathPrefix = normalizeLogicalPath(pathPrefix);
    const json = await this.requestJson(
      '/v1/search/query',
      {
        pathPrefix: normalizedPathPrefix,
        query,
        ...(options.mode ? { mode: options.mode } : {}),
        resultShape: options.resultShape ?? 'files',
        ...(typeof options.limit === 'number' ? { limit: options.limit } : {}),
        ...(typeof options.offset === 'number' ? { offset: options.offset } : {}),
        ...(typeof options.includeSnippets === 'boolean' ? { includeSnippets: options.includeSnippets } : {})
      },
      '/v1/paths/search',
      { path: normalizedPathPrefix, query }
    );
    return this.searchResponseFromGateway(json);
  }

  async listChanges(pathPrefix: string, cursor: number): Promise<ChangeSet> {
    const capabilities = await this.capabilities();
    if (!capabilities.changes) {
      return {
        cursor,
        changes: []
      };
    }
    const normalizedPathPrefix = normalizeLogicalPath(pathPrefix);
    const json = await this.requestJson(
      '/v1/changes/list',
      { pathPrefix: normalizedPathPrefix, cursor },
      '/v1/paths/changes',
      { path: normalizedPathPrefix, cursor }
    );
    const changeSet = changeSetFromGateway(json);
    return {
      ...changeSet,
      changes: changeSet.changes.map(change => ({
        ...change,
        path: this.toLogicalPath(change.path)
      }))
    };
  }

  private async requestJson(
    route: string,
    body: Record<string, unknown>,
    legacyRoute?: string,
    legacyBody?: Record<string, unknown>
  ): Promise<unknown> {
    const delegatedAuth = await this.options.getDelegatedAuth();
    try {
      return await this.requestJsonWithFallback(route, body, legacyRoute, legacyBody, delegatedAuth.token);
    } catch (error) {
      if (
        error instanceof BeginningDbError &&
        error.kind === 'unauthorized' &&
        delegatedAuth.canRefresh &&
        this.options.refreshDelegatedAuth
      ) {
        const refreshedAuth = await this.options.refreshDelegatedAuth();
        return this.requestJsonWithFallback(route, body, legacyRoute, legacyBody, refreshedAuth.token);
      }
      throw error;
    }
  }

  private async requestJsonWithFallback(
    route: string,
    body: Record<string, unknown>,
    legacyRoute: string | undefined,
    legacyBody: Record<string, unknown> | undefined,
    token: string
  ): Promise<unknown> {
    try {
      return await this.requestJsonWithToken(route, body, token);
    } catch (error) {
      if (legacyRoute && error instanceof BeginningDbError && error.status === 404) {
        const capabilities = await this.capabilities();
        if (capabilities.surface === 'legacy-paths') {
          return this.requestJsonWithToken(legacyRoute, legacyBody ?? body, token);
        }
      }
      throw error;
    }
  }

  capabilities(): Promise<GatewayCapabilities> {
    if (!this.capabilitiesPromise) {
      this.capabilitiesPromise = fetchGatewayCapabilities(this.options.gatewayUrl);
    }
    return this.capabilitiesPromise;
  }

  private async requestJsonWithToken(
    route: string,
    body: Record<string, unknown>,
    token: string
  ): Promise<unknown> {
    const selector = this.workspaceSelector();
    const response = await fetch(new URL(route, this.options.gatewayUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        workspaceId: selector.workspaceId,
        filesystemId: selector.filesystemId,
        ...body
      })
    });

    if (!response.ok) {
      throw await errorFromGateway(response);
    }
    return response.json().catch(() => {
      throw new BeginningDbError('unknown', 'Gateway returned malformed JSON');
    });
  }

  private toLogicalPath(path: string): string {
    const namespace = `/.bgdb-vfs/filesystems/${this.options.filesystemId}`;
    if (path === namespace) {
      return '/';
    }
    if (path.startsWith(`${namespace}/`)) {
      return path.slice(namespace.length);
    }
    return path;
  }

  private searchResponseFromGateway(value: unknown): BeginningDbSearchResponse {
    const record = asRecord(value);
    const results = Array.isArray(record.results)
      ? record.results.map(result => this.searchResultFromGateway(result))
      : [];
    const indexFreshness = indexFreshnessFromGateway(record.index_freshness);
    return {
      results,
      ...(indexFreshness ? { indexFreshness } : {})
    };
  }

  private searchResultFromGateway(value: unknown): BeginningDbSearchFileResult {
    if (typeof value === 'string') {
      return { path: this.toLogicalPath(value) };
    }
    const record = asRecord(value);
    const path = recordString(record, 'path');
    const kind = optionalKind(record.kind);
    const mode = optionalSearchMode(record.mode);
    const placements = Array.isArray(record.placements)
      ? record.placements
          .filter((placement): placement is string => typeof placement === 'string')
          .map(placement => this.toLogicalPath(placement))
      : undefined;
    const snippet = snippetFromGateway(record.snippet);
    return {
      path: this.toLogicalPath(path),
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

  private workspaceSelector(): { workspaceId: string; filesystemId: string } {
    const workspaceId = nonEmpty(this.options.workspaceId);
    const filesystemId = nonEmpty(this.options.filesystemId);
    const canonical = workspaceId ?? filesystemId;
    if (!canonical) {
      throw new BeginningDbError('bad_request', 'workspaceId or filesystemId is required');
    }
    if (workspaceId && filesystemId && workspaceId !== filesystemId) {
      throw new BeginningDbError('bad_request', 'workspaceId and filesystemId must match');
    }
    return { workspaceId: canonical, filesystemId: canonical };
  }
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function fetchGatewayCapabilities(gatewayUrl: string): Promise<GatewayCapabilities> {
  const response = await fetch(new URL('/v1/capabilities', gatewayUrl));
  if (!response.ok) {
    const legacyResponse = await fetch(new URL('/v1/features', gatewayUrl));
    if (!legacyResponse.ok) {
      return defaultCapabilities();
    }
    const legacyJson = await legacyResponse.json().catch(() => undefined);
    return legacyCapabilitiesFromGateway(legacyJson);
  }
  const json = await response.json().catch(() => undefined);
  return capabilitiesFromGateway(json);
}

function statFromGateway(value: unknown): BeginningDbStat {
  return {
    path: recordString(value, 'path'),
    kind: recordKind(value, 'kind'),
    size: recordNumber(value, 'size'),
    mtimeMs: 0,
    version: 0,
    inodeId: 0
  };
}

function entryFromGateway(value: unknown, parentPath = '/'): BeginningDbDirEntry {
  const record = asRecord(value);
  const name = recordString(record, 'name');
  return {
    name,
    path: recordOptionalString(record, 'path') ?? childPath(parentPath, name),
    kind: recordKind(record, 'kind'),
    size: 0,
    mtimeMs: 0,
    version: 0,
    inodeId: 0
  };
}

function childPath(parentPath: string, name: string): string {
  const normalizedParent = normalizeLogicalPath(parentPath);
  return normalizedParent === '/' ? `/${name}` : `${normalizedParent}/${name}`;
}

function changeSetFromGateway(value: unknown): ChangeSet {
  const record = asRecord(value);
  const cursor = typeof record.cursor === 'number' ? record.cursor : 0;
  const changes = Array.isArray(record.changes) ? record.changes.map(changeFromGateway) : [];
  return { cursor, changes };
}

function changeFromGateway(value: unknown): ChangeSet['changes'][number] {
  const record = asRecord(value);
  const type = recordString(record, 'type');
  if (type !== 'changed' && type !== 'deleted' && type !== 'created') {
    throw new BeginningDbError('unknown', `Gateway response had invalid change type: ${type}`);
  }
  return {
    seq: recordNumber(record, 'seq'),
    path: recordString(record, 'path'),
    kind: recordKind(record, 'kind'),
    type
  };
}

function indexFreshnessFromGateway(value: unknown): BeginningDbSearchResponse['indexFreshness'] {
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

function snippetFromGateway(value: unknown): BeginningDbSearchFileResult['snippet'] {
  const record = asRecord(value);
  const text = recordOptionalString(record, 'text');
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

function optionalKind(value: unknown): 'file' | 'dir' | 'symlink' | undefined {
  return value === 'file' || value === 'dir' || value === 'symlink' ? value : undefined;
}

function optionalSearchMode(value: unknown): BeginningDbSearchMode | undefined {
  return value === 'keyword' || value === 'vector' || value === 'hybrid' ? value : undefined;
}

function bytesFromGatewayContent(value: unknown): Uint8Array {
  const content = recordString(value, 'content');
  const encoding = recordOptionalString(value, 'contentEncoding');
  if (encoding === 'base64') {
    return bytesFromBase64(content);
  }
  return new TextEncoder().encode(content);
}

async function errorFromGateway(response: Response): Promise<BeginningDbError> {
  const message = await response.text();
  if (response.status === 401) {
    return new BeginningDbError('unauthorized', message || 'Unauthorized', response.status);
  }
  if (response.status === 403) {
    return new BeginningDbError('permission_denied', message || 'Forbidden', response.status);
  }
  if (response.status === 404) {
    return new BeginningDbError('not_found', message || 'Not found', response.status);
  }
  if (response.status >= 500) {
    return new BeginningDbError('unavailable', message || 'Gateway unavailable', response.status);
  }
  return new BeginningDbError('unknown', message || 'Gateway request failed', response.status);
}

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function recordString(value: unknown, field: string): string {
  const record = asRecord(value);
  if (typeof record[field] !== 'string') {
    throw new BeginningDbError('unknown', `Gateway response missing string field: ${field}`);
  }
  return record[field] as string;
}

function recordOptionalString(value: unknown, field: string): string | undefined {
  const record = asRecord(value);
  return typeof record[field] === 'string' ? (record[field] as string) : undefined;
}

function recordNumber(value: unknown, field: string): number {
  const record = asRecord(value);
  if (typeof record[field] !== 'number') {
    throw new BeginningDbError('unknown', `Gateway response missing number field: ${field}`);
  }
  return record[field] as number;
}

function recordKind(value: unknown, field: string): 'file' | 'dir' | 'symlink' {
  const kind = recordString(value, field);
  if (kind === 'file' || kind === 'dir' || kind === 'symlink') {
    return kind;
  }
  throw new BeginningDbError('unknown', `Gateway response had invalid kind: ${kind}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function capabilitiesFromGateway(value: unknown): GatewayCapabilities {
  const record = asRecord(value);
  const features = asRecord(record.features);
  return {
    surface: 'gateway-worker',
    legacyPaths: asRecord(asRecord(record.compatibility).legacyPaths).enabled === true,
    binaryWrite: Boolean(features.binaryWrite),
    rename: Boolean(features.rename),
    changes: Boolean(features.changes),
    search: Boolean(features.search),
    streamingUpload: Boolean(features.streamingUpload),
    streamingDownload: Boolean(features.streamingDownload),
    ...(typeof features.maxUploadBytes === 'number' ? { maxUploadBytes: features.maxUploadBytes } : {}),
    ...(typeof features.maxDownloadBytes === 'number' ? { maxDownloadBytes: features.maxDownloadBytes } : {})
  };
}

function legacyCapabilitiesFromGateway(value: unknown): GatewayCapabilities {
  const record = asRecord(value);
  const features = asRecord(record.features);
  return {
    surface: 'legacy-paths',
    legacyPaths: true,
    binaryWrite: Boolean(features.binaryWrite),
    rename: Boolean(features.rename),
    changes: Boolean(features.changes),
    search: Boolean(features.search),
    streamingUpload: false,
    streamingDownload: false
  };
}

function defaultCapabilities(): GatewayCapabilities {
  return {
    surface: 'gateway-worker',
    legacyPaths: false,
    binaryWrite: false,
    rename: false,
    changes: false,
    search: false,
    streamingUpload: false,
    streamingDownload: false
  };
}
