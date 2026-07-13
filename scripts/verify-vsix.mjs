#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const EXPECTED_ENTRIES = new Set([
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
]);

export function validateEntries(entries) {
  const seen = new Set();
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/');
    const canonical = normalized.toLowerCase();
    const segments = normalized.split('/');
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || segments.includes('..')) {
      throw new Error(`Unsafe VSIX path: ${entry}`);
    }
    if (seen.has(canonical)) {
      throw new Error(`Duplicate VSIX entry: ${entry}`);
    }
    seen.add(canonical);

    const lowerSegments = segments.map(segment => segment.toLowerCase());
    if (
      lowerSegments.some(segment => segment === '.env' || segment.startsWith('.env.') || segment === '.npmrc') ||
      lowerSegments.includes('.git') ||
      /\.(?:key|pem|p12|pfx)$/i.test(normalized)
    ) {
      throw new Error(`Sensitive VSIX entry: ${entry}`);
    }
    if (/\.(?:exe|dll|so|dylib|node)$/i.test(normalized)) {
      throw new Error(`Unexpected executable VSIX entry: ${entry}`);
    }
    if (!EXPECTED_ENTRIES.has(normalized)) {
      throw new Error(
        normalized.startsWith('extension/')
          ? `Unexpected VSIX entry: ${entry}`
          : `Unexpected VSIX root: ${entry}`,
      );
    }
  }

  for (const required of EXPECTED_ENTRIES) {
    if (!seen.has(required.toLowerCase())) {
      throw new Error(`Missing required VSIX entry: ${required}`);
    }
  }
}

export function validateContent(entry, content) {
  if (/\/(?:Users|home)\/[^\s"']+|[A-Za-z]:\\Users\\/i.test(content)) {
    throw new Error(`Private path in VSIX entry: ${entry}`);
  }
  if (
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(content) ||
    /\b(?:ghp|github_pat|npm)_[A-Za-z0-9_]{20,}\b/.test(content) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(content) ||
    /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(content)
  ) {
    throw new Error(`Credential-shaped content in VSIX entry: ${entry}`);
  }
  if (/\b(?:beginning-tools|source-export|apps\/ide)\b/.test(content)) {
    throw new Error(`Private repository reference in VSIX entry: ${entry}`);
  }
}

export function validateManifest(manifest) {
  const expected = {
    name: 'beginningdb-cloudfs',
    displayName: 'BeginningDB Cloud Files',
    publisher: 'beginningdb',
    version: '0.1.0',
    license: 'Apache-2.0',
    main: './dist/extension.js',
    browser: 'dist/extension.browser.js',
  };

  for (const [field, value] of Object.entries(expected)) {
    if (manifest?.[field] !== value) {
      throw new Error(`Unexpected VSIX manifest ${field}: ${String(manifest?.[field])}`);
    }
  }
}

export function verifyVsix(vsixPath) {
  if (!existsSync(vsixPath)) {
    throw new Error(`VSIX not found: ${vsixPath}`);
  }

  const entries = execFileSync('unzip', ['-Z1', vsixPath], { encoding: 'utf8' })
    .split('\n')
    .map(entry => entry.trim())
    .filter(Boolean);
  validateEntries(entries);

  const rawManifest = execFileSync('unzip', ['-p', vsixPath, 'extension/package.json'], {
    encoding: 'utf8',
  });
  validateManifest(JSON.parse(rawManifest));
  for (const entry of entries) {
    const unzipPattern = entry.replaceAll('[', '[[]');
    const content = execFileSync('unzip', ['-p', vsixPath, unzipPattern], { encoding: 'utf8' });
    validateContent(entry, content);
  }

  const sha256 = createHash('sha256').update(readFileSync(vsixPath)).digest('hex');
  return { entryCount: entries.length, sha256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  const [vsixPath] = args;
  if (args.length !== 1) {
    process.stderr.write('Usage: node scripts/verify-vsix.mjs <path-to-vsix>\n');
    process.exitCode = 1;
  } else {
    try {
      const result = verifyVsix(vsixPath);
      process.stdout.write(
        `Verified VSIX: ${result.entryCount} files, sha256 ${result.sha256}\n`,
      );
    } catch (error) {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
