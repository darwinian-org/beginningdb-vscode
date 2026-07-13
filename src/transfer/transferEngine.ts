import { classifyTransferError, errorMessage, transferError } from './transferErrors';
import type {
  TransferCancellationToken,
  TransferCapabilityProvider,
  TransferConflictPolicy,
  TransferConflictResolver,
  TransferEntry,
  TransferFileSystem,
  TransferFileType,
  TransferRequest,
  TransferSummary,
  TransferUri
} from './transferTypes';

export interface TransferEngineOptions {
  fs: TransferFileSystem;
  capabilities?: TransferCapabilityProvider;
  maxFileSizeBytes: number;
  conflictResolver?: TransferConflictResolver;
  jobIdFactory?: () => string;
}

export class TransferEngine {
  constructor(private readonly options: TransferEngineOptions) {}

  async run(
    request: TransferRequest,
    token: TransferCancellationToken = { isCancellationRequested: false }
  ): Promise<TransferSummary> {
    const summary = emptySummary(this.options.jobIdFactory?.() ?? `transfer-${Date.now()}`);
    for (const source of request.sources) {
      if (token.isCancellationRequested) {
        summary.status = 'cancelled';
        summary.errors.push(transferError(source, undefined, 'cancelled', 'Transfer cancelled'));
        return summary;
      }
      const destination = request.preserveTree
        ? this.options.fs.joinPath(request.destination, this.options.fs.basename(source))
        : request.destination;
      await this.copyEntry(source, destination, request, summary, token);
    }
    if (summary.status !== 'cancelled') {
      summary.status = summary.failed > 0 ? 'failed' : 'completed';
    }
    return summary;
  }

  private async copyEntry(
    source: TransferUri,
    destination: TransferUri,
    request: TransferRequest,
    summary: TransferSummary,
    token: TransferCancellationToken
  ): Promise<void> {
    if (token.isCancellationRequested) {
      summary.status = 'cancelled';
      summary.errors.push(transferError(source, destination, 'cancelled', 'Transfer cancelled'));
      return;
    }

    let stat: { type: TransferFileType; size: number };
    try {
      stat = await this.options.fs.stat(source);
    } catch (error) {
      this.recordFailure(summary, source, destination, error);
      return;
    }

    if (stat.type === 'directory') {
      await this.copyDirectory(source, destination, request, summary, token);
      return;
    }
    if (stat.type !== 'file') {
      summary.skipped += 1;
      summary.errors.push(
        transferError(source, destination, 'unsupported_type', `Unsupported file type: ${stat.type}`)
      );
      return;
    }
    await this.copyFile(source, destination, stat.size, request, summary, token);
  }

  private async copyDirectory(
    source: TransferUri,
    destination: TransferUri,
    request: TransferRequest,
    summary: TransferSummary,
    token: TransferCancellationToken
  ): Promise<void> {
    if (request.dryRun) {
      return;
    }
    try {
      await this.ensureDirectory(destination);
      const entries = await this.options.fs.readDirectory(source);
      for (const [name] of entries) {
        if (token.isCancellationRequested) {
          summary.status = 'cancelled';
          summary.errors.push(transferError(source, destination, 'cancelled', 'Transfer cancelled'));
          return;
        }
        await this.copyEntry(
          this.options.fs.joinPath(source, name),
          this.options.fs.joinPath(destination, name),
          request,
          summary,
          token
        );
      }
    } catch (error) {
      this.recordFailure(summary, source, destination, error);
    }
  }

  private async copyFile(
    source: TransferUri,
    destination: TransferUri,
    size: number,
    request: TransferRequest,
    summary: TransferSummary,
    token: TransferCancellationToken
  ): Promise<void> {
    if (size > this.options.maxFileSizeBytes) {
      summary.failed += 1;
      summary.errors.push(
        transferError(
          source,
          destination,
          'file_too_large',
          `File is ${size} bytes, which exceeds the configured transfer limit`
        )
      );
      return;
    }

    const conflict = await this.resolveConflict(source, destination, request.conflictPolicy);
    if (conflict.policy === 'cancel') {
      summary.status = 'cancelled';
      summary.errors.push(transferError(source, destination, 'cancelled', 'Transfer cancelled'));
      return;
    }
    if (conflict.policy === 'skip') {
      summary.skipped += 1;
      return;
    }
    const finalDestination = conflict.destination;

    if (request.dryRun) {
      return;
    }
    if (token.isCancellationRequested) {
      summary.status = 'cancelled';
      summary.errors.push(transferError(source, finalDestination, 'cancelled', 'Transfer cancelled'));
      return;
    }

    try {
      const bytes = await this.options.fs.readFile(source);
      if (await this.isUnsupportedBinaryUpload(finalDestination, bytes)) {
        summary.failed += 1;
        summary.errors.push(
          transferError(
            source,
            finalDestination,
            'unsupported_binary',
            'Destination profile does not support binary uploads'
          )
        );
        return;
      }
      await this.ensureDirectory(this.options.fs.dirname(finalDestination));
      await this.options.fs.writeFile(finalDestination, bytes);
      summary.copied += 1;
      summary.bytesCopied = (summary.bytesCopied ?? 0) + bytes.byteLength;
      if (conflict.policy === 'overwrite') {
        summary.overwritten += 1;
      }
      if (conflict.policy === 'rename') {
        summary.renamed += 1;
      }
      if (request.mode === 'move') {
        await this.options.fs.delete(source, { recursive: false });
        summary.moved += 1;
      }
    } catch (error) {
      this.recordFailure(summary, source, finalDestination, error);
    }
  }

  private async resolveConflict(
    source: TransferUri,
    destination: TransferUri,
    policy: TransferConflictPolicy
  ): Promise<{ policy: Exclude<TransferConflictPolicy, 'ask'> | 'copy'; destination: TransferUri }> {
    const exists = await this.exists(destination);
    if (!exists) {
      return { policy: 'copy', destination };
    }
    const resolvedPolicy =
      policy === 'ask'
        ? await this.options.conflictResolver?.({ source, destination }) ?? 'cancel'
        : policy;
    if (resolvedPolicy === 'rename') {
      return { policy: 'rename', destination: await this.nextCopyName(destination) };
    }
    return { policy: resolvedPolicy, destination };
  }

  private async nextCopyName(destination: TransferUri): Promise<TransferUri> {
    const basename = this.options.fs.basename(destination);
    const dotIndex = basename.lastIndexOf('.');
    const hasExtension = dotIndex > 0;
    const stem = hasExtension ? basename.slice(0, dotIndex) : basename;
    const extension = hasExtension ? basename.slice(dotIndex) : '';
    const parent = this.options.fs.dirname(destination);
    for (let index = 1; index < 10_000; index += 1) {
      const suffix = index === 1 ? ' copy' : ` copy ${index}`;
      const candidate = this.options.fs.joinPath(parent, `${stem}${suffix}${extension}`);
      if (!(await this.exists(candidate))) {
        return candidate;
      }
    }
    throw new Error(`Could not find a free copy name for ${destination.toString()}`);
  }

  private async exists(uri: TransferUri): Promise<boolean> {
    try {
      await this.options.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureDirectory(uri: TransferUri): Promise<void> {
    try {
      const stat = await this.options.fs.stat(uri);
      if (stat.type !== 'directory') {
        throw new Error(`${uri.toString()} exists and is not a directory`);
      }
    } catch (error) {
      if (classifyTransferError(error) === 'not_found') {
        const parent = this.options.fs.dirname(uri);
        if (parent.toString() !== uri.toString()) {
          await this.ensureDirectory(parent);
        }
        await this.options.fs.createDirectory(uri);
        return;
      }
      throw error;
    }
  }

  private async isUnsupportedBinaryUpload(destination: TransferUri, bytes: Uint8Array): Promise<boolean> {
    if (destination.scheme !== 'bgdbfs' || !this.options.capabilities) {
      return false;
    }
    const capabilities = await this.options.capabilities.capabilitiesFor(destination);
    return !capabilities.binaryWrite && !isUtf8(bytes);
  }

  private recordFailure(
    summary: TransferSummary,
    source: TransferUri,
    destination: TransferUri,
    error: unknown
  ): void {
    summary.failed += 1;
    summary.errors.push(
      transferError(source, destination, classifyTransferError(error), errorMessage(error))
    );
  }
}

function emptySummary(jobId: string): TransferSummary {
  return {
    jobId,
    status: 'completed',
    copied: 0,
    moved: 0,
    skipped: 0,
    overwritten: 0,
    renamed: 0,
    failed: 0,
    errors: []
  };
}

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
