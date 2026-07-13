#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { EXPECTED_ENTRIES } from './verify-vsix.mjs';

export function prepareOutput(root, version) {
  const distPath = path.join(root, 'dist');
  const outputPath = path.join(distPath, `beginningdb-cloudfs-${version}.vsix`);
  rmSync(distPath, { recursive: true, force: true });
  mkdirSync(distPath, { recursive: true });
  return outputPath;
}

export function normalizePackageInputs(root, timestamp = new Date('1980-01-01T00:00:00.000Z')) {
  const targets = ['LICENSE', 'NOTICE', 'README.md', 'package.json', 'dist'];
  for (const target of targets) {
    normalizePath(path.join(root, target), timestamp);
  }
}

function normalizePath(target, timestamp) {
  const stat = lstatSync(target);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(target).sort()) {
      normalizePath(path.join(target, entry), timestamp);
    }
  }
  utimesSync(target, timestamp, timestamp);
}

export function normalizeVsix(outputPath) {
  const stagingRoot = mkdtempSync(path.join(os.tmpdir(), 'beginningdb-vsix-normalize-'));
  try {
    execFileSync('unzip', ['-q', outputPath, '-d', stagingRoot]);
    normalizePath(stagingRoot, new Date('1980-01-01T00:00:00.000Z'));
    rmSync(outputPath, { force: true });
    execFileSync(
      'zip',
      ['-X', '-q', outputPath, ...EXPECTED_ENTRIES],
      { cwd: stagingRoot },
    );
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

export function packageVsix(root = process.cwd()) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const outputPath = prepareOutput(root, manifest.version);
  const options = { cwd: root, stdio: 'inherit' };

  execFileSync('pnpm', ['run', 'build'], options);
  normalizePackageInputs(root);
  execFileSync(
    'pnpm',
    ['exec', 'vsce', 'package', '--no-dependencies', '--out', outputPath],
    options,
  );
  normalizeVsix(outputPath);
  return outputPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    packageVsix();
  } catch (error) {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
