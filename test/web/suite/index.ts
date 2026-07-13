import * as vscode from 'vscode';

export async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const files = new Map<string, string>([['/docs/a.txt', 'hello from web']]);

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    const body =
      init?.body && String(init.body).length > 0
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};

    if (!url.includes('/fs/credentials/') && !url.startsWith('https://gateway.example.com/')) {
      return originalFetch(input, init);
    }

    calls.push({ url, body });

    if (url.endsWith('/fs/credentials/team-a')) {
      return json({
        id: 'team-a',
        label: 'Team A',
        mode: 'beginningdb.gateway',
        gatewayUrl: 'https://gateway.example.com',
        filesystemId: 'fs-1',
        pathPrefix: '/',
        auth: {
          kind: 'delegated-vfs',
          token: 'delegated-token',
          canRefresh: true
        }
      });
    }

    if (url.endsWith('/v1/capabilities')) {
      return json({
        contractVersion: 1,
        features: {
          storage: true,
          binaryWrite: true,
          rename: true,
          changes: true,
          search: true
        }
      });
    }
    if (url.endsWith('/v1/storage/stat')) {
      const path = String(body.path);
      if (path === '/docs') {
        return json({ path, kind: 'dir', size: 0 });
      }
      if (!files.has(path)) {
        return json({ error: 'missing' }, 404);
      }
      return json({ path, kind: 'file', size: files.get(path)!.length });
    }
    if (url.endsWith('/v1/storage/list')) {
      return json({ entries: [{ name: 'a.txt', path: '/docs/a.txt', kind: 'file' }] });
    }
    if (url.endsWith('/v1/storage/read')) {
      return json({ content: files.get(String(body.path)) ?? '' });
    }
    if (url.endsWith('/v1/storage/write')) {
      files.set(String(body.path), String(body.content));
      return json({ ok: true });
    }

    return json({ error: `unexpected ${url}` }, 500);
  }) as typeof fetch;

  try {
    const extension = vscode.extensions.getExtension('beginningdb.beginningdb-cloudfs');
    assert(extension, 'extension should be discoverable by publisher and name');
    await extension.activate();

    const fileUri = vscode.Uri.parse('bgdbfs://team-a/docs/a.txt');
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    assert(new TextDecoder().decode(bytes) === 'hello from web', 'web host should read bgdbfs file');

    await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode('updated from web'));
    assert(files.get('/docs/a.txt') === 'updated from web', 'web host should write bgdbfs file');

    assert(
      calls.some(call => call.url.endsWith('/fs/credentials/team-a')),
      'web host should resolve credentials through /fs/credentials'
    );
    assert(
      calls.some(call => call.url === 'https://gateway.example.com/v1/storage/read'),
      'web host should read through the gateway worker surface'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
