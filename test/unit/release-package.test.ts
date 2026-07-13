import { describe, expect, it } from 'vitest';
import manifest from '../../package.json';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('public extension package metadata', () => {
  it('declares the approved Apache-2.0 public repository identity', () => {
    expect(manifest).toMatchObject({
      name: 'beginningdb-cloudfs',
      displayName: 'BeginningDB Cloud Files',
      publisher: 'beginningdb',
      version: '0.1.0',
      license: 'Apache-2.0',
      repository: {
        type: 'git',
        url: 'git+https://github.com/iminds-io/beginningdb-vscode.git',
      },
      bugs: {
        url: 'https://github.com/iminds-io/beginningdb-vscode/issues',
      },
      homepage: 'https://github.com/iminds-io/beginningdb-vscode#readme',
    });
    expect(JSON.stringify(manifest)).not.toMatch(/\/Users\/|beginning-tools|source-export/);
  });

  it('declares deterministic VSIX packaging commands', () => {
    expect(manifest.scripts).toMatchObject({
      'package:vsix': 'node scripts/package-vsix.mjs',
      'verify:vsix': 'node scripts/verify-vsix.mjs',
    });
  });

  it('removes a stale VSIX before packaging into dist', async () => {
    // @ts-expect-error The release packager is intentionally plain ESM for direct Node execution.
    const { prepareOutput } = await import('../../scripts/package-vsix.mjs');
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'beginningdb-package-test-'));
    const staleVsix = path.join(fixtureRoot, 'dist', 'beginningdb-cloudfs-0.1.0.vsix');
    const staleBundle = path.join(fixtureRoot, 'dist', 'stale.js');
    try {
      mkdirSync(path.dirname(staleVsix), { recursive: true });
      writeFileSync(staleVsix, 'stale artifact');
      writeFileSync(staleBundle, 'stale bundle');

      expect(prepareOutput(fixtureRoot, '0.1.0')).toBe(staleVsix);
      expect(existsSync(staleVsix)).toBe(false);
      expect(existsSync(staleBundle)).toBe(false);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('ships the approved license and attribution notice', () => {
    expect(existsSync('LICENSE')).toBe(true);
    expect(existsSync('NOTICE')).toBe(true);
    expect(readFileSync('LICENSE', 'utf8')).toContain('Apache License');
    expect(readFileSync('LICENSE', 'utf8')).toContain('Version 2.0, January 2004');
    expect(readFileSync('NOTICE', 'utf8')).toContain('BeginningDB Cloud Files');
    expect(readFileSync('NOTICE', 'utf8')).toContain('BeginningDB contributors');
    expect(manifest.files).toEqual(['dist/**', 'LICENSE', 'NOTICE', 'README.md']);
  });

  it('exposes a stable verifier usage contract', () => {
    const result = spawnSync(process.execPath, [path.resolve('scripts/verify-vsix.mjs')], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(
      'Usage: node scripts/verify-vsix.mjs <path-to-vsix>',
    );
  });

  it('requires exactly one VSIX path argument', () => {
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/verify-vsix.mjs'), 'one.vsix', 'two.vsix'],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(
      'Usage: node scripts/verify-vsix.mjs <path-to-vsix>',
    );
  });

  it('fails clearly when the VSIX path does not exist', () => {
    const missingPath = path.resolve('test/fixtures/does-not-exist.vsix');
    const result = spawnSync(process.execPath, [path.resolve('scripts/verify-vsix.mjs'), missingPath], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(`error: VSIX not found: ${missingPath}`);
  });

  it('rejects archive entries that escape the extension root', async () => {
    // @ts-expect-error The release verifier is intentionally plain ESM for direct Node execution.
    const { validateEntries } = await import('../../scripts/verify-vsix.mjs');

    expect(() =>
      validateEntries([
        '[Content_Types].xml',
        'extension/package.json',
        'extension/dist/extension.js',
        'extension/../escape.txt',
      ]),
    ).toThrow('Unsafe VSIX path: extension/../escape.txt');
  });

  it('rejects duplicate archive entries', async () => {
    // @ts-expect-error The release verifier is intentionally plain ESM for direct Node execution.
    const { validateEntries } = await import('../../scripts/verify-vsix.mjs');
    const entries = [
      '[Content_Types].xml',
      'extension/package.json',
      'extension/dist/extension.js',
      'extension/dist/extension.js',
    ];

    expect(() => validateEntries(entries)).toThrow(
      'Duplicate VSIX entry: extension/dist/extension.js',
    );
    expect(() =>
      validateEntries([
        '[Content_Types].xml',
        'extension/package.json',
        'Extension/package.json',
      ]),
    ).toThrow('Duplicate VSIX entry: Extension/package.json');
  });

  it('rejects Windows absolute archive paths', async () => {
    // @ts-expect-error The release verifier is intentionally plain ESM for direct Node execution.
    const { validateEntries } = await import('../../scripts/verify-vsix.mjs');

    expect(() => validateEntries(['C:\\Users\\private\\secret.txt'])).toThrow(
      'Unsafe VSIX path: C:\\Users\\private\\secret.txt',
    );
  });

  it('rejects sensitive and unexpected archive entries', async () => {
    // @ts-expect-error The release verifier is intentionally plain ESM for direct Node execution.
    const { validateEntries } = await import('../../scripts/verify-vsix.mjs');

    expect(() =>
      validateEntries([
        '[Content_Types].xml',
        'extension/package.json',
        'extension/dist/extension.js',
        'extension/.env',
      ]),
    ).toThrow('Sensitive VSIX entry: extension/.env');
    expect(() =>
      validateEntries([
        '[Content_Types].xml',
        'extension/package.json',
        'extension/dist/extension.js',
        'private/internal.txt',
      ]),
    ).toThrow('Unexpected VSIX root: private/internal.txt');
  });

  it('rejects unexpected native executables in the extension payload', async () => {
    // @ts-expect-error The release verifier is intentionally plain ESM for direct Node execution.
    const { validateEntries } = await import('../../scripts/verify-vsix.mjs');

    expect(() =>
      validateEntries([
        '[Content_Types].xml',
        'extension/package.json',
        'extension/dist/extension.js',
        'extension/dist/unexpected.node',
      ]),
    ).toThrow('Unexpected executable VSIX entry: extension/dist/unexpected.node');
  });

  it('enforces the closed public VSIX file allowlist', async () => {
    // @ts-expect-error The release verifier is intentionally plain ESM for direct Node execution.
    const { validateEntries } = await import('../../scripts/verify-vsix.mjs');

    expect(() =>
      validateEntries([
        '[Content_Types].xml',
        'extension.vsixmanifest',
        'extension/package.json',
        'extension/readme.md',
        'extension/NOTICE',
        'extension/LICENSE.txt',
        'extension/dist/extension.js',
        'extension/dist/extension.js.map',
        'extension/dist/extension.browser.js',
        'extension/dist/extension.browser.js.map',
        'extension/private-notes.txt',
      ]),
    ).toThrow('Unexpected VSIX entry: extension/private-notes.txt');
  });

  it('rejects private paths and credential shapes in packaged text', async () => {
    // @ts-expect-error The release verifier is intentionally plain ESM for direct Node execution.
    const { validateContent } = await import('../../scripts/verify-vsix.mjs');

    expect(() =>
      validateContent('extension/dist/extension.js', 'const p = "/Users/private/project";'),
    ).toThrow('Private path in VSIX entry: extension/dist/extension.js');
    expect(() =>
      validateContent('extension/readme.md', '-----BEGIN PRIVATE KEY-----'),
    ).toThrow('Credential-shaped content in VSIX entry: extension/readme.md');
  });

  it('requires the packaged extension manifest and runtime entry point', async () => {
    // @ts-expect-error The release verifier is intentionally plain ESM for direct Node execution.
    const { EXPECTED_ENTRIES, validateEntries } = await import('../../scripts/verify-vsix.mjs');

    expect(() =>
      validateEntries([...EXPECTED_ENTRIES].filter(entry => entry !== 'extension/dist/extension.js')),
    ).toThrow(
      'Missing required VSIX entry: extension/dist/extension.js',
    );
  });

  it('rejects a packaged manifest with the wrong public identity', async () => {
    // @ts-expect-error The release verifier is intentionally plain ESM for direct Node execution.
    const { validateManifest } = await import('../../scripts/verify-vsix.mjs');

    expect(() =>
      validateManifest({
        name: 'beginningdb-cloudfs',
        displayName: 'BeginningDB Cloud Files',
        publisher: 'other',
        version: '0.1.0',
        license: 'Apache-2.0',
        main: './dist/extension.js',
        browser: 'dist/extension.browser.js',
      }),
    ).toThrow('Unexpected VSIX manifest publisher: other');
  });

  it('verifies real VSIX contents and reports their SHA-256 digest', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'beginningdb-vsix-test-'));
    const vsixPath = path.join(fixtureRoot, 'beginningdb-cloudfs-0.1.0.vsix');
    try {
      mkdirSync(path.join(fixtureRoot, 'extension', 'dist'), { recursive: true });
      writeFileSync(path.join(fixtureRoot, '[Content_Types].xml'), '<Types />\n');
      writeFileSync(path.join(fixtureRoot, 'extension.vsixmanifest'), '<PackageManifest />\n');
      writeFileSync(
        path.join(fixtureRoot, 'extension', 'package.json'),
        `${JSON.stringify({
          name: 'beginningdb-cloudfs',
          displayName: 'BeginningDB Cloud Files',
          publisher: 'beginningdb',
          version: '0.1.0',
          license: 'Apache-2.0',
          main: './dist/extension.js',
          browser: 'dist/extension.browser.js',
        })}\n`,
      );
      writeFileSync(path.join(fixtureRoot, 'extension', 'readme.md'), '# Fixture\n');
      writeFileSync(path.join(fixtureRoot, 'extension', 'NOTICE'), 'Fixture notice\n');
      writeFileSync(path.join(fixtureRoot, 'extension', 'LICENSE.txt'), 'Fixture license\n');
      writeFileSync(path.join(fixtureRoot, 'extension', 'dist', 'extension.js'), 'module.exports = {};\n');
      writeFileSync(path.join(fixtureRoot, 'extension', 'dist', 'extension.js.map'), '{}\n');
      writeFileSync(
        path.join(fixtureRoot, 'extension', 'dist', 'extension.browser.js'),
        'module.exports = {};\n',
      );
      writeFileSync(path.join(fixtureRoot, 'extension', 'dist', 'extension.browser.js.map'), '{}\n');
      execFileSync(
        'zip',
        [
          '-q',
          vsixPath,
          '[Content_Types].xml',
          'extension.vsixmanifest',
          'extension/package.json',
          'extension/readme.md',
          'extension/NOTICE',
          'extension/LICENSE.txt',
          'extension/dist/extension.js',
          'extension/dist/extension.js.map',
          'extension/dist/extension.browser.js',
          'extension/dist/extension.browser.js.map',
        ],
        { cwd: fixtureRoot },
      );

      const result = spawnSync(
        process.execPath,
        [path.resolve('scripts/verify-vsix.mjs'), '--', vsixPath],
        { encoding: 'utf8' },
      );

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toMatch(/^Verified VSIX: 10 files, sha256 [a-f0-9]{64}$/);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
