import { describe, expect, it } from 'vitest';
import {
  decodeBgdbUriPath,
  parseBgdbUri,
  toBeginningDbPath
} from '../../src/filesystem/uri';
import type { BeginningDbWorkspace } from '../../src/beginningdb/workspace';

const WORKSPACE: BeginningDbWorkspace = {
  id: 'workspace-1',
  label: 'Workspace 1',
  baseUrl: 'http://127.0.0.1:8080',
  tenantId: 1,
  filesystemId: 'fs-1',
  pathPrefix: '/.bgdb-vfs/filesystems/fs-1'
};

describe('bgdbfs URI mapping', () => {
  it('parses workspace id and logical path from bgdbfs URIs', () => {
    expect(parseBgdbUri('bgdbfs://workspace-1/docs/a.txt')).toEqual({
      workspaceId: 'workspace-1',
      logicalPath: '/docs/a.txt'
    });
  });

  it('maps empty paths to root', () => {
    expect(parseBgdbUri('bgdbfs://workspace-1').logicalPath).toBe('/');
    expect(decodeBgdbUriPath('/')).toBe('/');
  });

  it('rejects traversal and encoded path separators', () => {
    expect(() => parseBgdbUri('bgdbfs://workspace-1/docs/../secret.txt')).toThrow(
      /traversal/
    );
    expect(() => parseBgdbUri('bgdbfs://workspace-1/docs%2fsecret.txt')).toThrow(
      /encoded path separators/
    );
  });

  it('decodes safe path segments', () => {
    expect(parseBgdbUri('bgdbfs://workspace-1/docs/hello%20world.md')).toEqual({
      workspaceId: 'workspace-1',
      logicalPath: '/docs/hello world.md'
    });
  });

  it('maps logical paths into the BeginningDB filesystem namespace', () => {
    expect(toBeginningDbPath(WORKSPACE, '/docs/a.txt')).toBe(
      '/.bgdb-vfs/filesystems/fs-1/docs/a.txt'
    );
    expect(toBeginningDbPath(WORKSPACE, '/')).toBe('/.bgdb-vfs/filesystems/fs-1');
  });

  it('never uses tokens when constructing remote paths', () => {
    expect(toBeginningDbPath(WORKSPACE, '/token.txt')).not.toContain('Bearer');
    expect(toBeginningDbPath(WORKSPACE, '/token.txt')).not.toContain('secret');
  });
});
