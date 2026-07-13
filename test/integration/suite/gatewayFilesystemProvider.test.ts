import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { GatewayVfsClient } from '../../../src/gateway/gatewayVfsClient';
import {
  BeginningDbFileSystemProvider,
  type VfsBackendClientRegistry
} from '../../../src/filesystem/beginningDbFileSystemProvider';

suite('Gateway-backed BeginningDbFileSystemProvider', () => {
  test('routes filesystem operations through the gateway client contract', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const directories = new Set(['/', '/docs']);
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      const body =
        init?.body && String(init?.body).length > 0
          ? (JSON.parse(String(init?.body)) as Record<string, unknown>)
          : {};
      calls.push({ url, body });

      if (url.endsWith('/v1/capabilities')) {
        return new Response(JSON.stringify({
          contractVersion: 1,
          minClientContractVersion: 1,
          auth: {
            sessionKinds: ['managed-session'],
            refresh: { supported: true, route: '/v1/auth/refresh' }
          },
          features: {
            storage: true,
            binaryWrite: true,
            rename: true,
            changes: false,
            search: false,
            legacyPaths: true
          },
          compatibility: {
            legacyPaths: { enabled: false, deprecated: true, sunsetAfter: null }
          },
          routing: { mode: 'single-cluster' },
          runtime: { adapter: 'hono' }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (url.endsWith('/v1/storage/stat')) {
        const pathValue = body.path;
        if (typeof pathValue === 'string' && directories.has(pathValue)) {
          return new Response(JSON.stringify({ path: pathValue, kind: 'dir', size: 0 }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        if (pathValue === '/new') {
          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ path: '/docs/a.txt', kind: 'file', size: 5 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (url.endsWith('/v1/storage/list')) {
        return new Response(
          JSON.stringify([{ name: 'a.txt', path: '/docs/a.txt', kind: 'file' }]),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        );
      }
      if (url.endsWith('/v1/storage/read')) {
        return new Response(JSON.stringify({ content: 'hello' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (url.endsWith('/v1/storage/mkdir') && typeof body.path === 'string') {
        directories.add(body.path);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (
        url.endsWith('/v1/storage/write') ||
        url.endsWith('/v1/storage/delete') ||
        url.endsWith('/v1/storage/rename')
      ) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      if (url.includes('/v1/storage/')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response(`unexpected ${url}`, { status: 500 });
    }) as typeof fetch;

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'delegated-token', canRefresh: false })
    });
    const provider = new BeginningDbFileSystemProvider(registryFor(client));
    const scheme = `bgdbfsgateway-${Date.now()}`;
    const registration = vscode.workspace.registerFileSystemProvider(scheme, provider);
    const fileUri = vscode.Uri.parse(`${scheme}://workspace/docs/a.txt`);

    try {
      const stat = await vscode.workspace.fs.stat(fileUri);
      assert.equal(stat.type, vscode.FileType.File);

      const entries = await vscode.workspace.fs.readDirectory(
        vscode.Uri.parse(`${scheme}://workspace/docs`)
      );
      assert.deepEqual(entries, [['a.txt', vscode.FileType.File]]);

      const bytes = await vscode.workspace.fs.readFile(fileUri);
      assert.equal(new TextDecoder().decode(bytes), 'hello');

      await vscode.workspace.fs.writeFile(fileUri, new Uint8Array([0, 255, 10]));
      await vscode.workspace.fs.createDirectory(vscode.Uri.parse(`${scheme}://workspace/new`));

      await vscode.workspace.fs.rename(
        fileUri,
        vscode.Uri.parse(`${scheme}://workspace/docs/b.txt`),
        { overwrite: true }
      );
      await vscode.workspace.fs.delete(vscode.Uri.parse(`${scheme}://workspace/docs/b.txt`));

      assert.equal(calls[0]?.url, 'https://gateway.example.com/v1/storage/stat');
      assert.deepEqual(calls[0]?.body, {
        workspaceId: 'fs-1',
        filesystemId: 'fs-1',
        path: '/docs/a.txt'
      });
      assert.equal(calls[1]?.url, 'https://gateway.example.com/v1/storage/list');
      assert.deepEqual(calls[1]?.body, {
        workspaceId: 'fs-1',
        filesystemId: 'fs-1',
        path: '/docs'
      });
      const capabilityCall = calls.find(call => call.url.endsWith('/v1/capabilities'));
      assert.ok(capabilityCall);
      const writeCall = calls.find(call => call.url.endsWith('/v1/storage/write'));
      assert.deepEqual(writeCall?.body, {
        workspaceId: 'fs-1',
        filesystemId: 'fs-1',
        path: '/docs/a.txt',
        content: Buffer.from([0, 255, 10]).toString('base64'),
        contentEncoding: 'base64'
      });
      const renameCall = calls.find(call => call.url.endsWith('/v1/storage/rename'));
      assert.deepEqual(renameCall?.body, {
        workspaceId: 'fs-1',
        filesystemId: 'fs-1',
        fromPath: '/docs/a.txt',
        toPath: '/docs/b.txt'
      });
    } finally {
      registration.dispose();
      globalThis.fetch = originalFetch;
    }
  });

  test('retries one gateway filesystem operation after auth refresh on 401', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      calls.push({
        url,
        auth:
          init?.headers && typeof (init.headers as Record<string, string>)['authorization'] === 'string'
            ? (init.headers as Record<string, string>)['authorization']
            : undefined
      });

      if (url.endsWith('/v1/storage/read') && calls.filter(call => call.url.endsWith('/v1/storage/read')).length === 1) {
        return new Response(JSON.stringify({ error: 'expired' }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (url.endsWith('/v1/storage/read')) {
        return new Response(JSON.stringify({ content: 'hello after refresh' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response('unexpected', { status: 500 });
    }) as typeof fetch;

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'stale-token', canRefresh: true }),
      refreshDelegatedAuth: async () => ({ token: 'fresh-token', canRefresh: true })
    });
    const provider = new BeginningDbFileSystemProvider(registryFor(client));
    const scheme = `bgdbfsgateway-refresh-${Date.now()}`;
    const registration = vscode.workspace.registerFileSystemProvider(scheme, provider);
    const fileUri = vscode.Uri.parse(`${scheme}://workspace/docs/a.txt`);

    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      assert.equal(new TextDecoder().decode(bytes), 'hello after refresh');
      const catCalls = calls.filter(call => call.url.endsWith('/v1/storage/read'));
      assert.equal(catCalls.length, 2);
      assert.equal(catCalls[0]?.auth, 'Bearer stale-token');
      assert.equal(catCalls[1]?.auth, 'Bearer fresh-token');
    } finally {
      registration.dispose();
      globalThis.fetch = originalFetch;
    }
  });
});

function registryFor(client: GatewayVfsClient): VfsBackendClientRegistry {
  return {
    async resolve(uri: vscode.Uri) {
      return {
        client,
        remotePath: uri.path || '/'
      };
    }
  };
}
