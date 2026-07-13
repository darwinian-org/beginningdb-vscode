import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('BeginningDB Cloud Files extension', () => {
  test('contributes commands', async () => {
    const extension = vscode.extensions.getExtension('beginningdb.beginningdb-cloudfs');
    assert.ok(extension, 'extension should be discoverable by publisher and name');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes('beginningdb.addServer'));
    assert.ok(commands.includes('beginningdb.openCloudFolder'));
    assert.ok(commands.includes('beginningdb.openMirror'));
    assert.ok(commands.includes('beginningdb.uploadToCloud'));
    assert.ok(commands.includes('beginningdb.downloadToLocal'));
    assert.ok(commands.includes('beginningdb.copyTo'));
    assert.ok(commands.includes('beginningdb.moveTo'));
    assert.ok(commands.includes('beginningdb.showTransfers'));
  });

  test('registers the bgdbfs filesystem provider', async () => {
    const extension = vscode.extensions.getExtension('beginningdb.beginningdb-cloudfs');
    assert.ok(extension, 'extension should be discoverable by publisher and name');
    await extension.activate();

    await assert.rejects(async () =>
      vscode.workspace.fs.stat(vscode.Uri.parse('bgdbfs://missing/docs/a.txt'))
    );
  });
});
