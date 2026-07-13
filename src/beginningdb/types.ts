export type BeginningDbKind = 'file' | 'dir' | 'symlink';

export interface BeginningDbStat {
  path: string;
  kind: BeginningDbKind;
  size: number;
  mtimeMs: number;
  version: number;
  inodeId: number;
  etag?: string;
}

export interface BeginningDbDirEntry extends BeginningDbStat {
  name: string;
}

export interface WriteOptions {
  create: boolean;
  overwrite: boolean;
  ifMatch?: string;
}

export interface DeleteOptions {
  recursive: boolean;
  ifMatch?: string;
}

export interface RenameOptions {
  overwrite: boolean;
  ifMatch?: string;
}

export interface ChangeEntry {
  seq: number;
  path: string;
  kind: BeginningDbKind;
  type: 'changed' | 'deleted' | 'created';
}

export interface ChangeSet {
  cursor: number;
  changes: ChangeEntry[];
}

export type BeginningDbSearchMode = 'keyword' | 'vector' | 'hybrid';
export type BeginningDbSearchResultShape = 'paths' | 'files';

export interface BeginningDbSearchOptions {
  mode?: BeginningDbSearchMode;
  resultShape?: BeginningDbSearchResultShape;
  limit?: number;
  offset?: number;
  includeSnippets?: boolean;
}

export interface BeginningDbSearchSnippet {
  text: string;
  matchRanges?: Array<{ start: number; end: number }>;
}

export interface BeginningDbSearchFileResult {
  path: string;
  kind?: BeginningDbKind;
  inodeId?: number;
  resource?: string;
  placements?: string[];
  mode?: BeginningDbSearchMode;
  score?: number;
  scoreKind?: string;
  scoreBreakdown?: Record<string, unknown>;
  snippet?: BeginningDbSearchSnippet;
}

export interface BeginningDbSearchIndexFreshness {
  ready?: boolean;
  pendingWalEntries?: number;
  indexedDocs?: number;
}

export interface BeginningDbSearchResponse {
  results: BeginningDbSearchFileResult[];
  indexFreshness?: BeginningDbSearchIndexFreshness;
}
