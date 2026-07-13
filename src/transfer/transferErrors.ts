import type { TransferError, TransferErrorCode, TransferUri } from './transferTypes';

export function transferError(
  source: TransferUri,
  destination: TransferUri | undefined,
  code: TransferErrorCode,
  message: string
): TransferError {
  return {
    source: redactUri(source),
    ...(destination ? { destination: redactUri(destination) } : {}),
    code,
    message: redactMessage(message)
  };
}

export function classifyTransferError(error: unknown): TransferErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === 'object' && error ? String((error as { code?: unknown }).code ?? '') : '';
  const combined = `${code} ${message}`.toLowerCase();
  if (combined.includes('filenotfound') || combined.includes('not found') || combined.includes('missing')) {
    return 'not_found';
  }
  if (combined.includes('fileexists') || combined.includes('already exists') || combined.includes('exists')) {
    return 'already_exists';
  }
  if (combined.includes('nopermissions') || combined.includes('permission') || combined.includes('unauthorized')) {
    return 'permission_denied';
  }
  if (combined.includes('quota') || combined.includes('413')) {
    return 'quota_exceeded';
  }
  return 'unknown';
}

export function errorMessage(error: unknown): string {
  return redactMessage(error instanceof Error ? error.message : String(error));
}

function redactUri(uri: TransferUri): string {
  try {
    const parsed = new URL(uri.toString());
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return redactMessage(uri.toString());
  }
}

function redactMessage(value: string): string {
  return value
    .replace(/bearer\s+[a-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/token[=:]\s*[^)\]\s,;]+/gi, 'token=[redacted]');
}
