import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const cjsRequire = createRequire(__filename);

interface VscodeTestConfig {
  launchArgs?: string[];
}

const config = cjsRequire('../../.vscode-test.js') as VscodeTestConfig;

function getLaunchArgValue(name: string): string | undefined {
  const arg = config.launchArgs?.find(value => value.startsWith(`${name}=`));
  return arg?.slice(name.length + 1);
}

describe('VS Code integration test config', () => {
  it('uses short test data dirs so macOS IPC sockets fit under VS Code limits', () => {
    const userDataDir = getLaunchArgValue('--user-data-dir');
    const extensionsDir = getLaunchArgValue('--extensions-dir');

    expect(config.launchArgs).toContain('--disable-extensions');
    expect(userDataDir).toBeDefined();
    expect(extensionsDir).toBeDefined();
    expect(path.isAbsolute(userDataDir!)).toBe(true);
    expect(path.isAbsolute(extensionsDir!)).toBe(true);

    if (process.platform !== 'win32') {
      const socketPath = path.join(userDataDir!, '1.12-main.sock');
      expect(socketPath.length).toBeLessThanOrEqual(103);
    }
  });
});
