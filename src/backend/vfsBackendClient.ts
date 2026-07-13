import type {
  BeginningDbDirEntry,
  BeginningDbSearchOptions,
  BeginningDbSearchResponse,
  BeginningDbStat,
  ChangeSet,
  DeleteOptions,
  RenameOptions,
  WriteOptions
} from '../beginningdb/types';

export interface VfsBackendClient {
  stat(path: string): Promise<BeginningDbStat>;
  readDirectory(path: string): Promise<BeginningDbDirEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(
    path: string,
    content: Uint8Array,
    options: WriteOptions
  ): Promise<BeginningDbStat | undefined>;
  createDirectory(path: string): Promise<void>;
  delete(path: string, options: DeleteOptions): Promise<void>;
  rename(source: string, target: string, options: RenameOptions): Promise<void>;
  search(query: string, pathPrefix?: string): Promise<string[]>;
  searchFiles?(
    query: string,
    pathPrefix?: string,
    options?: BeginningDbSearchOptions
  ): Promise<BeginningDbSearchResponse>;
  listChanges?(pathPrefix: string, cursor: number): Promise<ChangeSet>;
  capabilities?(): Promise<VfsBackendCapabilities>;
}

export interface VfsBackendCapabilities {
  binaryWrite: boolean;
  rename: boolean;
  maxUploadBytes?: number;
  maxDownloadBytes?: number;
  streamingUpload: boolean;
  streamingDownload: boolean;
}

export interface VfsBackendClientResolution {
  client: VfsBackendClient;
  remotePath: string;
  auth?: {
    kind: 'delegated-vfs';
    canRefresh: boolean;
    strategy?: 'manual-token' | 'managed-session' | 'dispatch-session';
  };
}
