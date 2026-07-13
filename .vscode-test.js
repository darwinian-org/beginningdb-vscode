const { defineConfig } = require('@vscode/test-cli');
const os = require('node:os');
const path = require('node:path');

const tempRoot = process.platform === 'win32'
  ? path.join(os.tmpdir(), 'bgdb-cloudfs-vscode-test')
  : '/tmp/bgdb-cloudfs-vscode-test';

module.exports = defineConfig({
  files: 'out/test/integration/suite/**/*.test.js',
  workspaceFolder: './sample-workspace',
  mocha: {
    timeout: 20000
  },
  launchArgs: [
    '--disable-extensions',
    `--user-data-dir=${path.join(tempRoot, 'user-data')}`,
    `--extensions-dir=${path.join(tempRoot, 'extensions')}`
  ]
});
