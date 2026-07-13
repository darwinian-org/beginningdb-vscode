import path from 'node:path';

export function safeMirrorPath(root: string, remotePath: string): string {
  const parts = remotePath.split('/').filter(Boolean);
  if (parts.some(part => part === '..' || part === '.')) {
    throw new Error(`unsafe mirror path: ${remotePath}`);
  }
  const target = path.resolve(root, ...parts);
  const rootPath = path.resolve(root);
  if (target !== rootPath && !target.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error(`unsafe mirror path: ${remotePath}`);
  }
  return target;
}

export function remotePathFromMirror(root: string, filePath: string): string {
  const rootPath = path.resolve(root);
  const target = path.resolve(filePath);
  if (target === rootPath || !target.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error(`unsafe local path: ${filePath}`);
  }
  const relative = path.relative(rootPath, target);
  if (relative.startsWith('.beginningdb')) {
    throw new Error('mirror metadata must not be synced');
  }
  return `/${relative.split(path.sep).join('/')}`;
}

export function absoluteRemotePathFromMirror(
  root: string,
  rootRemotePath: string,
  filePath: string
): string {
  const relativeRemotePath = remotePathFromMirror(root, filePath);
  const normalizedRoot = normalizeRemoteRoot(rootRemotePath);
  return normalizedRoot === '/'
    ? relativeRemotePath
    : `${normalizedRoot}${relativeRemotePath === '/' ? '' : relativeRemotePath}`;
}

export function safeMirrorPathForRemote(
  root: string,
  rootRemotePath: string,
  remotePath: string
): string {
  return safeMirrorPath(root, relativeRemotePath(rootRemotePath, remotePath));
}

function relativeRemotePath(rootRemotePath: string, remotePath: string): string {
  const normalizedRoot = normalizeRemoteRoot(rootRemotePath);
  if (normalizedRoot === '/') {
    return remotePath;
  }
  if (remotePath === normalizedRoot) {
    return '/';
  }
  if (remotePath.startsWith(`${normalizedRoot}/`)) {
    return remotePath.slice(normalizedRoot.length);
  }
  throw new Error(`remote path ${remotePath} is outside mirror root ${normalizedRoot}`);
}

function normalizeRemoteRoot(rootRemotePath: string): string {
  if (!rootRemotePath.startsWith('/')) {
    throw new Error(`unsafe remote root: ${rootRemotePath}`);
  }
  return rootRemotePath.length > 1 ? rootRemotePath.replace(/\/+$/, '') : '/';
}
