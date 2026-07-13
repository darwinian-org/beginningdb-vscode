import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { GatewayVfsClient } from '../../../src/gateway/gatewayVfsClient';
import {
  BeginningDbFileSystemProvider,
  type VfsBackendClientRegistry
} from '../../../src/filesystem/beginningDbFileSystemProvider';

suite('Gateway-worker-backed BeginningDbFileSystemProvider', () => {
  test('uses the provider-neutral gateway-worker surface for filesystem operations', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const files = new Set(['/docs/a.txt']);
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      const body =
        init?.body && String(init.body).length > 0
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : {};
      calls.push({ url, body });

      if (url.endsWith('/v1/capabilities')) {
        return json({
          contractVersion: 1,
          minClientContractVersion: 1,
          auth: {
            sessionKinds: ['managed-session'],
            refresh: { supported: true, route: '/v1/auth/refresh' }
          },
          features: {
            storage: true,
            binaryWrite: false,
            rename: true,
            changes: true,
            search: true,
            legacyPaths: false
          },
          compatibility: { legacyPaths: { enabled: false, deprecated: true, sunsetAfter: null } },
          routing: { mode: 'single-cluster' },
          runtime: { adapter: 'hono' }
        });
      }
      if (url.endsWith('/v1/storage/stat')) {
        if (body.path === '/docs') {
          return json({ path: '/docs', kind: 'dir', size: 0 });
        }
        if (typeof body.path !== 'string' || !files.has(body.path)) {
          return json({ error: 'not found' }, 404);
        }
        return json({ path: body.path, kind: 'file', size: 5 });
      }
      if (url.endsWith('/v1/storage/read')) {
        return json({ content: 'gateway-worker-ok' });
      }
      if (url.endsWith('/v1/storage/write') && typeof body.path === 'string') {
        files.add(body.path);
        return json({ ok: true });
      }
      if (url.endsWith('/v1/storage/delete') && typeof body.path === 'string') {
        files.delete(body.path);
        return json({ ok: true });
      }
      if (
        url.endsWith('/v1/storage/rename') &&
        typeof body.fromPath === 'string' &&
        typeof body.toPath === 'string'
      ) {
        files.delete(body.fromPath);
        files.add(body.toPath);
        return json({ ok: true });
      }
      if (url.endsWith('/v1/search/query')) {
        return json({ results: ['/docs/a.txt'] });
      }
      if (url.endsWith('/v1/changes/list')) {
        return json({ cursor: 1, changes: [] });
      }

      if (url.includes('/v1/storage/')) {
        return json({ ok: true });
      }

      return new Response(`unexpected ${url}`, { status: 500 });
    }) as typeof fetch;

    const client = new GatewayVfsClient({
      gatewayUrl: 'https://gateway-worker.example.com',
      filesystemId: 'fs-1',
      getDelegatedAuth: async () => ({ token: 'managed-token', canRefresh: true })
    });
    const provider = new BeginningDbFileSystemProvider(registryFor(client));
    const scheme = `bgdbfsgatewayworker-${Date.now()}`;
    const registration = vscode.workspace.registerFileSystemProvider(scheme, provider);
    const fileUri = vscode.Uri.parse(`${scheme}://workspace/docs/a.txt`);

    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      assert.equal(new TextDecoder().decode(bytes), 'gateway-worker-ok');

      await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode('gateway-worker-write'));
      await vscode.workspace.fs.rename(
        fileUri,
        vscode.Uri.parse(`${scheme}://workspace/docs/b.txt`),
        { overwrite: true }
      );

      assert.deepEqual(await client.search('gateway-worker', '/docs'), ['/docs/a.txt']);
      assert.deepEqual(await client.listChanges('/docs', 0), { cursor: 1, changes: [] });

      assert.ok(calls.some(call => call.url === 'https://gateway-worker.example.com/v1/capabilities'));
      assert.ok(calls.some(call => call.url === 'https://gateway-worker.example.com/v1/storage/read'));
      assert.ok(calls.some(call => call.url === 'https://gateway-worker.example.com/v1/search/query'));
      assert.ok(calls.every(call => !call.url.includes('/v1/paths/')));
    } finally {
      registration.dispose();
      globalThis.fetch = originalFetch;
    }
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

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
