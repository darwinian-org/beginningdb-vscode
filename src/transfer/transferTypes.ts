export interface TransferUri {
  scheme: string;
  authority: string;
  path: string;
  fsPath?: string | undefined;
  toString(): string;
}

export type TransferFileType = 'file' | 'directory' | 'symlink' | 'unknown';

export interface TransferStat {
  type: TransferFileType;
  size: number;
}

export interface TransferFileSystem {
  stat(uri: TransferUri): Promise<TransferStat>;
  readDirectory(uri: TransferUri): Promise<readonly [string, TransferFileType][]>;
  readFile(uri: TransferUri): Promise<Uint8Array>;
  writeFile(uri: TransferUri, bytes: Uint8Array): Promise<void>;
  createDirectory(uri: TransferUri): Promise<void>;
  delete(uri: TransferUri, options: { recursive: boolean }): Promise<void>;
  copy?(source: TransferUri, destination: TransferUri, options: { overwrite: boolean }): Promise<void>;
  joinPath(base: TransferUri, ...segments: string[]): TransferUri;
  basename(uri: TransferUri): string;
  dirname(uri: TransferUri): TransferUri;
}

export interface TransferCapabilities {
  binaryWrite: boolean;
  rename: boolean;
  maxUploadBytes?: number;
  maxDownloadBytes?: number;
  streamingUpload: boolean;
  streamingDownload: boolean;
}

export interface TransferCapabilityProvider {
  capabilitiesFor(uri: TransferUri): Promise<TransferCapabilities>;
}

export type TransferMode = 'copy' | 'move';
export type TransferConflictPolicy = 'ask' | 'skip' | 'overwrite' | 'rename' | 'cancel';
export type TransferStatus = 'completed' | 'cancelled' | 'failed';

export interface TransferRequest {
  sources: TransferUri[];
  destination: TransferUri;
  mode: TransferMode;
  conflictPolicy: TransferConflictPolicy;
  preserveTree: boolean;
  dryRun?: boolean;
}

export interface TransferEntry {
  source: TransferUri;
  destination: TransferUri;
  kind: TransferFileType;
  size?: number;
  action: 'copy' | 'mkdir' | 'skip' | 'overwrite' | 'rename' | 'delete-source';
}

export type TransferErrorCode =
  | 'not_found'
  | 'already_exists'
  | 'permission_denied'
  | 'unsupported_type'
  | 'unsupported_binary'
  | 'file_too_large'
  | 'quota_exceeded'
  | 'cancelled'
  | 'unknown';

export interface TransferError {
  source: string;
  destination?: string;
  code: TransferErrorCode;
  message: string;
}

export interface TransferSummary {
  jobId: string;
  status: TransferStatus;
  copied: number;
  moved: number;
  skipped: number;
  overwritten: number;
  renamed: number;
  failed: number;
  bytesCopied?: number;
  errors: TransferError[];
}

export interface TransferCancellationToken {
  isCancellationRequested: boolean;
}

export interface TransferProgress {
  report(value: { message?: string; increment?: number }): void;
}

export type TransferConflictResolver = (input: {
  source: TransferUri;
  destination: TransferUri;
}) => Promise<Exclude<TransferConflictPolicy, 'ask'>>;
