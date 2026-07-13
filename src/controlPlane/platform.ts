import path from 'node:path';

export interface BgngLaunchSpec {
  file: string;
  args: string[];
}

export function resolveBgngLaunchSpec(input: {
  overridePath?: string;
  bundledPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): BgngLaunchSpec {
  const env = input.env ?? process.env;
  const configured =
    input.overridePath ??
    env['BEGINNINGDB_BGNG_PATH'] ??
    env['BGNG_IDE_CLI_PATH'] ??
    input.bundledPath ??
    'bgng';

  if (looksLikeNodeScript(configured)) {
    return {
      file: process.execPath,
      args: [configured]
    };
  }

  return {
    file: configured,
    args: []
  };
}

function looksLikeNodeScript(value: string): boolean {
  const extension = path.extname(value).toLowerCase();
  return extension === '.js' || extension === '.cjs' || extension === '.mjs';
}

