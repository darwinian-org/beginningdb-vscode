export interface BeginningDbResource {
  workspaceId: string;
  logicalPath: string;
}

export function parseBgdbUri(value: string): BeginningDbResource {
  if (/(^|\/)\.\.(\/|$)/.test(value)) {
    throw new Error('path traversal is not allowed');
  }
  const uri = new URL(value);
  if (uri.protocol !== 'bgdbfs:') {
    throw new Error(`unsupported scheme: ${uri.protocol}`);
  }

  return {
    workspaceId: uri.hostname,
    logicalPath: decodeBgdbUriPath(uri.pathname || '/')
  };
}

export function decodeBgdbUriPath(pathname: string): string {
  if (/%2f|%5c/i.test(pathname)) {
    throw new Error('encoded path separators are not allowed');
  }

  const decodedSegments = pathname
    .split('/')
    .filter(Boolean)
    .map(segment => decodeURIComponent(segment));

  return normalizeLogicalPath(`/${decodedSegments.join('/')}`);
}

export function toBeginningDbPath(
  workspace: { pathPrefix: string },
  logicalPath: string
): string {
  const normalized = normalizeLogicalPath(logicalPath);
  return `${workspace.pathPrefix}${normalized === '/' ? '' : normalized}`;
}

export function normalizeLogicalPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const parts = normalized.split('/').filter(Boolean);

  for (const part of parts) {
    if (part === '..') {
      throw new Error('path traversal is not allowed');
    }
    if (part === '.') {
      throw new Error('relative path segments are not allowed');
    }
  }

  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}
